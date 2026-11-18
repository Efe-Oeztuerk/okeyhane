// Brett-Anordnung (Istaka, 2 × 16 Plätze): automatisch sortieren und beim Beenden prüfen.

import { arrange, countPairs, toCounts, validateMeld } from './evaluate.ts';
import { COLORS, isRealOkey, type OkeyIdentity, type Tile } from './tiles.ts';

export const RACK_COLS = 16;
export const RACK_SLOTS = RACK_COLS * 2;

/** Gruppen mit Lücke dazwischen aufs Brett legen, Rest in die zweite Reihe */
export function placeGroups(groups: Tile[][], rest: Tile[]): (number | null)[] {
  const slots: (number | null)[] = new Array(RACK_SLOTS).fill(null);
  let pos = 0;
  for (const g of groups) {
    const row = Math.floor(pos / RACK_COLS);
    if ((pos % RACK_COLS) + g.length > RACK_COLS && row === 0) pos = RACK_COLS;
    for (const t of g) if (pos < RACK_SLOTS) slots[pos++] = t.id;
    pos++;
  }
  if (pos < RACK_COLS) pos = RACK_COLS;
  for (const t of rest) {
    while (pos < RACK_SLOTS && slots[pos] !== null) pos++;
    if (pos < RACK_SLOTS) slots[pos++] = t.id;
    else slots[slots.indexOf(null)] = t.id;
  }
  return slots;
}

/** Reihen/Gruppen finden (wie ein Mensch das Brett ordnen würde) */
export function meldGroups(hand: Tile[], okey: OkeyIdentity): { groups: Tile[][]; rest: Tile[] } {
  const { counts, wilds } = toCounts(hand, okey);
  const arr = arrange(counts, wilds, (c) => 10 + c.v, 0);
  const pool = [...hand];
  const take = (pred: (t: Tile) => boolean) => {
    const i = pool.findIndex(pred);
    return i >= 0 ? pool.splice(i, 1)[0] : null;
  };
  const cIdx = (t: Tile) => (t.fake ? COLORS.indexOf(okey.color) : COLORS.indexOf(t.color!));
  const val = (t: Tile) => (t.fake ? okey.value : t.value);
  const groups: Tile[][] = [];
  for (const m of arr.melds) {
    const g: Tile[] = [];
    for (const cell of m.cells) {
      const t = 'wild' in cell ? take((x) => isRealOkey(x, okey)) : take((x) => !isRealOkey(x, okey) && cIdx(x) === cell.real.c && val(x) === cell.real.v);
      if (t) g.push(t);
    }
    groups.push(g);
  }
  pool.sort((a, b) => (isRealOkey(a, okey) ? 1 : 0) - (isRealOkey(b, okey) ? 1 : 0) || cIdx(a) - cIdx(b) || val(a) - val(b));
  return { groups, rest: pool };
}

export function pairGroups(hand: Tile[], okey: OkeyIdentity): { groups: Tile[][]; rest: Tile[] } {
  const key = (t: Tile) => (t.fake ? `${okey.color}-${okey.value}` : `${t.color}-${t.value}`);
  const map = new Map<string, Tile[]>();
  const wild: Tile[] = [];
  for (const t of hand) {
    if (isRealOkey(t, okey)) wild.push(t);
    else map.set(key(t), [...(map.get(key(t)) ?? []), t]);
  }
  const pairs: Tile[][] = [];
  const singles: Tile[] = [];
  for (const list of map.values()) {
    while (list.length >= 2) pairs.push(list.splice(0, 2));
    singles.push(...list);
  }
  singles.sort((a, b) => key(a).localeCompare(key(b)));
  for (const w of wild) {
    const s = singles.shift();
    pairs.push(s ? [s, w] : [w]);
  }
  return { groups: pairs, rest: singles };
}

/** Brett eines Bots: sortiert wie ein Mensch (Paare, wenn das mehr bringt) */
export function autoLayout(hand: Tile[], okey: OkeyIdentity, indicator: Tile | null = null, indicatorPairsAnything = false): (number | null)[] {
  const m = meldGroups(hand, okey);
  const melded = m.groups.reduce((s, g) => s + g.length, 0);
  const { pairs } = countPairs(hand, okey, indicator, indicatorPairsAnything);
  if (pairs * 2 > melded && pairs >= 5) {
    const p = pairGroups(hand, okey);
    return placeGroups(p.groups, p.rest);
  }
  return placeGroups(m.groups, m.rest);
}

/** Zusammenhängende Steine pro Reihe (Lücke = Trennung) */
export function rackGroups(slots: (number | null)[], byId: Map<number, Tile>): Tile[][] {
  const out: Tile[][] = [];
  for (let r = 0; r < 2; r++) {
    let cur: Tile[] = [];
    for (let c = 0; c < RACK_COLS; c++) {
      const id = slots[r * RACK_COLS + c];
      const t = id !== null && id !== undefined ? byId.get(id) : undefined;
      if (t) cur.push(t);
      else if (cur.length) {
        out.push(cur);
        cur = [];
      }
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/** Lässt sich die Gruppe der Reihe nach in gültige Reihen/Gruppen (je ≥ 3) teilen? */
function splitsIntoMelds(g: Tile[], okey: OkeyIdentity): boolean {
  const ok: boolean[] = new Array(g.length + 1).fill(false);
  ok[g.length] = true;
  for (let i = g.length - 3; i >= 0; i--) {
    for (let j = i + 3; j <= g.length; j++) {
      if (ok[j] && validateMeld(g.slice(i, j), okey)) {
        ok[i] = true;
        break;
      }
    }
  }
  return ok[0];
}

/**
 * Beenden nur, wenn das Brett richtig umgestellt ist: alle 14 Steine liegen
 * in sichtbar getrennten, gültigen Reihen/Gruppen – oder als Paare nebeneinander.
 */
export function rackIsFinished(
  slots: (number | null)[] | null | undefined,
  rest: Tile[],
  okey: OkeyIdentity,
  indicator: Tile | null,
  indicatorPairsAnything: boolean,
): 'melds' | 'pairs' | null {
  if (!slots || slots.length !== RACK_SLOTS) return null;
  const byId = new Map(rest.map((t) => [t.id, t]));
  const groups = rackGroups(slots, byId);
  const placed = groups.reduce((s, g) => s + g.length, 0);
  if (placed !== rest.length) return null;
  if (groups.every((g) => splitsIntoMelds(g, okey))) return 'melds';
  const pairOk = groups.every((g) => {
    if (g.length % 2) return false;
    for (let i = 0; i < g.length; i += 2) if (countPairs(g.slice(i, i + 2), okey, indicator, indicatorPairsAnything).pairs !== 1) return false;
    return true;
  });
  return pairOk ? 'pairs' : null;
}
