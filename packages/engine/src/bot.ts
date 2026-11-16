// Einfacher Bot: hält Okeys, wirft den Stein, der die Hand am wenigsten verschlechtert.

import type { OkeyGame } from './game.ts';
import { type Tile, isRealOkey } from './tiles.ts';
import {
  arrange,
  countPairs,
  isCompleteMelds,
  isCompletePairs,
  toCounts,
  validateMeld,
  meldSum,
} from './evaluate.ts';

/** Bewertung einer Hand: lose Steine kosten (höher = schlechter). Okeys sind wertvoll. */
function handCost(game: OkeyGame, tiles: Tile[]): number {
  const okey = game.hand.okey;
  const { counts, wilds } = toCounts(tiles, okey);
  // Lose Steine kosten 10 + kleiner Wert-Anteil (für Perişan/101 lieber hohe loswerden)
  const melds = arrange(counts, wilds, (c) => 10 + c.v * 0.3, 0).cost;
  const { pairs } = countPairs(tiles, okey, game.hand.indicator, game.rules.indicatorPairsAnything);
  const pairCost = (7 - Math.min(7, pairs)) * 20;
  return Math.min(melds, pairCost + 15);
}

function bestDiscard(game: OkeyGame, hand: Tile[], avoid?: (t: Tile) => boolean): Tile {
  const okey = game.hand.okey;
  let best: Tile | null = null;
  let bestCost = Infinity;
  for (const t of hand) {
    if (isRealOkey(t, okey)) continue;
    const rest = hand.filter((x) => x !== t);
    let cost = handCost(game, rest);
    if (avoid?.(t)) cost += 1000;
    if (cost < bestCost) {
      bestCost = cost;
      best = t;
    }
  }
  return best ?? hand[0];
}

function canFinishWith(game: OkeyGame, hand: Tile[]): Tile | null {
  const h = game.hand;
  // Okey zuerst probieren (mehr Punkte), dann Rest
  const order = [...hand].sort((a, b) => Number(isRealOkey(b, h.okey)) - Number(isRealOkey(a, h.okey)));
  for (const t of order) {
    const rest = hand.filter((x) => x !== t);
    if (
      isCompleteMelds(rest, h.okey) ||
      isCompletePairs(rest, h.okey, h.indicator, game.rules.indicatorPairsAnything)
    )
      return t;
  }
  return null;
}

/** 101: versucht zu öffnen. Gibt true zurück, wenn geöffnet. */
function tryOpen101(game: OkeyGame, seat: number): boolean {
  const h = game.hand;
  const hand = h.players[seat].hand;
  const { counts, wilds } = toCounts(hand, h.okey);
  const arr = arrange(counts, wilds, (c) => c.v, 0);
  // Arrangement-Zellen auf echte Steine abbilden
  const pool = [...hand];
  const melds: Tile[][] = [];
  for (const m of arr.melds) {
    const tiles: Tile[] = [];
    for (const cell of m.cells) {
      const i = pool.findIndex((t) => {
        if ('wild' in cell) return isRealOkey(t, h.okey);
        if (isRealOkey(t, h.okey)) return false;
        const fakeAs = t.fake && h.okey.value === cell.real.v && cell.real.c === colorIdx(h.okey.color);
        return fakeAs || (!t.fake && colorIdx(t.color!) === cell.real.c && t.value === cell.real.v);
      });
      if (i < 0) break;
      tiles.push(pool.splice(i, 1)[0]);
    }
    if (tiles.length === m.cells.length && validateMeld(tiles, h.okey)) melds.push(tiles);
  }
  const sum = melds.reduce((s, m) => s + meldSum(validateMeld(m, h.okey)!), 0);
  // Hand muss einen Stein zum Abwerfen behalten: notfalls letzte Kombination weglassen
  while (melds.length && hand.length - melds.reduce((s, m) => s + m.length, 0) < 1) melds.pop();
  const used = melds.reduce((s, m) => s + m.length, 0);
  const opened = h.players[seat].opened === 'melds';
  if (melds.length && (opened || sum >= game.rules.openThreshold) && hand.length - used >= 1) {
    game.open101(
      seat,
      melds.map((m) => m.map((t) => t.id)),
    );
    return true;
  }
  return false;
}

function colorIdx(c: string): number {
  return ['red', 'black', 'yellow', 'blue'].indexOf(c);
}

function tryLayoffs(game: OkeyGame, seat: number): void {
  const h = game.hand;
  let changed = true;
  while (changed) {
    changed = false;
    const hand = h.players[seat].hand;
    if (hand.length <= 1) return;
    for (const t of [...hand]) {
      if (hand.length <= 1) return;
      const mi = h.tableMelds.findIndex(
        (m) => m.kind !== 'pair' && validateMeld([...m.tiles, t], h.okey) !== null,
      );
      if (mi >= 0) {
        game.layoff(seat, mi, [t.id]);
        changed = true;
        break;
      }
    }
  }
}

/** Führt einen kompletten Zug für den Bot auf Platz `seat` aus. */
export function botTurn(game: OkeyGame, seat: number): void {
  const h = game.hand;
  if (h.current !== seat) return;

  if (h.phase === 'draw') {
    const top = game.topDiscardFor(seat);
    let takeSide = false;
    if (top && h.okeyBirBy === null && game.rules.mode !== 'okey101') {
      const hand = h.players[seat].hand;
      const now = handCost(game, hand);
      const withTop = handCost(game, [...hand, top]);
      takeSide = isRealOkey(top, h.okey) || withTop < now - 8;
    }
    if (takeSide) game.drawDiscard(seat);
    else game.drawPile(seat);
  }

  const pl = h.players[seat];
  if (game.rules.mode === 'okey101') {
    if (!pl.opened || pl.opened === 'melds') tryOpen101(game, seat);
    if (pl.opened) tryLayoffs(game, seat);
    if (pl.hand.length === 1 && pl.opened) {
      game.finish(seat, pl.hand[0].id);
      return;
    }
    const d = bestDiscard(game, pl.hand, (t) => game.isLayable(t));
    game.discard(seat, d.id);
    return;
  }

  const fin = canFinishWith(game, pl.hand);
  if (fin) {
    game.finish(seat, fin.id);
    return;
  }
  game.discard(seat, bestDiscard(game, pl.hand).id);
}
