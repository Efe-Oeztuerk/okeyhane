// Wertung pro Hand für Standard-Okey, 101 und Perişan.

import type { TableRules } from './rules.ts';
import { type OkeyIdentity, type Tile, tileValue, isRealOkey } from './tiles.ts';
import { isCompleteMelds, isCompletePairs, looseSum } from './evaluate.ts';

export const teamOf = (seat: number) => seat % 2;

export interface FinishInfo {
  winner: number;
  withOkey: boolean;
  withPairs: boolean;
  /** Perişan: der Gewinner hat Okey bir gemacht */
  winnerDidOkeyBir: boolean;
}

/** Ergebnis einer Hand: Punktänderung pro Team und eine Notiz für den Zettel. */
export interface HandResult {
  teamDelta: [number, number];
  note: string;
  /** 101: Punkte pro Spieler (für Details) */
  playerDelta?: number[];
  caught?: number[];
}

// ---------- Standard ----------

export function scoreStandardFinish(rules: TableRules, f: FinishInfo): HandResult {
  const base = rules.colorful ? 4 : 2;
  let mult = 1;
  if (f.withOkey) mult *= 2;
  if (f.withPairs) mult *= 2;
  const loser = 1 - teamOf(f.winner);
  const delta: [number, number] = [0, 0];
  delta[loser] = -base * mult;
  const parts = [f.withPairs ? 'Çift' : null, f.withOkey ? 'Okey' : null].filter(Boolean).join(' + ');
  return { teamDelta: delta, note: `Bitti${parts ? ' (' + parts + ')' : ''}` };
}

export function scoreStandardIndicator(rules: TableRules, shower: number): HandResult {
  const delta: [number, number] = [0, 0];
  delta[1 - teamOf(shower)] = rules.colorful ? -2 : -1;
  return { teamDelta: delta, note: 'Gösterge' };
}

// ---------- Perişan ----------

export function perisanMultiplier(rules: TableRules, okey: OkeyIdentity): number {
  return rules.colorMultipliers[okey.color];
}

/** Summe aller Steine auf der Hand (für Okey yakalanmak). */
export function handSum(tiles: Tile[], okey: OkeyIdentity): number {
  return tiles.reduce((s, t) => s + tileValue(t, okey), 0);
}

export function scorePerisanFinish(
  rules: TableRules,
  okey: OkeyIdentity,
  indicator: Tile,
  f: FinishInfo,
  hands: Tile[][],
  okeyBirBy: number | null,
): HandResult {
  const M = perisanMultiplier(rules, okey);
  let W = 10;
  let F = 1;
  if (f.withOkey) {
    W = f.winnerDidOkeyBir ? 200 : 100;
    F = f.winnerDidOkeyBir ? 4 : 2;
  }
  if (f.withPairs) {
    W *= 2;
    F *= 2;
  }
  const winTeam = teamOf(f.winner);
  const delta: [number, number] = [0, 0];
  delta[winTeam] = -M * W;
  const caught: number[] = [];
  for (let seat = 0; seat < 4; seat++) {
    if (teamOf(seat) === winTeam) continue;
    const hand = hands[seat];
    const wasReady =
      hand.length === 14 &&
      (isCompleteMelds(hand, okey) || isCompletePairs(hand, okey, indicator, rules.indicatorPairsAnything));
    if (okeyBirBy === seat || wasReady) {
      // Okey yakalanmak: alle Steine × M + M × 100
      caught.push(seat);
      delta[1 - winTeam] += handSum(hand, okey) * M + M * 100;
    } else {
      delta[1 - winTeam] += looseSum(hand, okey) * M * F;
    }
  }
  const parts = [
    f.withPairs ? 'Çift' : null,
    f.winnerDidOkeyBir && f.withOkey ? 'Okey bir' : null,
    f.withOkey ? 'Okey' : null,
  ]
    .filter(Boolean)
    .join(' + ');
  return {
    teamDelta: delta,
    note: `Bitti ×${M}${parts ? ' (' + parts + ')' : ''}${caught.length ? ' · yakalandı' : ''}`,
    caught,
  };
}

export function scorePerisanIndicator(rules: TableRules, okey: OkeyIdentity, shower: number): HandResult {
  const delta: [number, number] = [0, 0];
  delta[teamOf(shower)] = -perisanMultiplier(rules, okey) * 10;
  return { teamDelta: delta, note: 'Gösterge' };
}

// ---------- 101 ----------

export interface Player101 {
  hand: Tile[];
  opened: false | 'melds' | 'pairs';
  penalty: number;
}

export function score101Finish(
  rules: TableRules,
  okey: OkeyIdentity,
  f: FinishInfo & { elden: boolean },
  players: Player101[],
): HandResult {
  const winnerBonus = -101;
  let mult = 1;
  if (rules.doubling101) {
    if (f.withOkey) mult *= 2;
    if (f.withPairs) mult *= 2;
    if (f.elden) mult *= 2;
  }
  const playerDelta = players.map((p, seat) => {
    if (seat === f.winner) return winnerBonus + p.penalty;
    let pts: number;
    if (!p.opened) pts = 202;
    else {
      pts = p.hand.reduce((s, t) => s + (isRealOkey(t, okey) ? 101 : tileValue(t, okey)), 0);
      if (p.opened === 'pairs') pts *= 2;
    }
    return pts * mult + p.penalty;
  });
  const teamDelta: [number, number] = [0, 0];
  playerDelta.forEach((d, seat) => (teamDelta[teamOf(seat)] += d));
  const parts = [f.elden ? 'Elden' : null, f.withPairs ? 'Çift' : null, f.withOkey ? 'Okey' : null]
    .filter(Boolean)
    .join(' + ');
  return { teamDelta, playerDelta, note: `Bitti${parts ? ' (' + parts + ')' : ''}` };
}
