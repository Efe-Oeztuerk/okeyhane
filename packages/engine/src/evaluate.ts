// Hand-Auswertung: optimale Aufteilung in Reihen/Gruppen, Paare, einzelne Kombinationen prüfen.

import { type Cell, type OkeyIdentity, type Tile, resolve, isRealOkey } from './tiles.ts';

export type MeldCell = { real: Cell } | { wild: true; as: Cell };
export interface Meld {
  kind: 'run' | 'set';
  cells: MeldCell[];
}
export interface Arrangement {
  cost: number;
  melds: Meld[];
  loose: Cell[];
  looseWilds: number;
}

const idx = (c: number, v: number) => c * 13 + (v - 1);

/** Zählt die Steine einer Hand als Häufigkeitsvektor (52 Felder) + Anzahl Joker. */
export function toCounts(tiles: Tile[], okey: OkeyIdentity): { counts: number[]; wilds: number } {
  const counts = new Array(52).fill(0);
  let wilds = 0;
  for (const t of tiles) {
    const r = resolve(t, okey);
    if (r === 'W') wilds++;
    else counts[idx(r.c, r.v)]++;
  }
  return { counts, wilds };
}

/**
 * Findet die Aufteilung mit den geringsten Kosten für lose Steine.
 * costReal: Kosten eines losen echten Steins, costWild: Kosten eines losen Okeys.
 */
export function arrange(
  countsIn: number[],
  wildsIn: number,
  costReal: (c: Cell) => number,
  costWild: number,
): Arrangement {
  const memo = new Map<string, Arrangement>();
  const cnt = countsIn.slice();

  function rec(W: number): Arrangement {
    const key = cnt.join('') + '|' + W;
    const hit = memo.get(key);
    if (hit) return hit;

    const i = cnt.findIndex((x) => x > 0);
    if (i < 0) {
      const res = { cost: W * costWild, melds: [], loose: [], looseWilds: W };
      memo.set(key, res);
      return res;
    }
    const c = Math.floor(i / 13);
    const v = (i % 13) + 1;

    // Option 1: Stein bleibt lose
    cnt[i]--;
    const r0 = rec(W);
    cnt[i]++;
    let best: Arrangement = {
      cost: r0.cost + costReal({ c, v }),
      melds: r0.melds,
      loose: [{ c, v }, ...r0.loose],
      looseWilds: r0.looseWilds,
    };

    const consider = (meld: Meld, wildsUsed: number) => {
      // reale Zellen abziehen
      for (const cell of meld.cells) if ('real' in cell) cnt[idx(cell.real.c, cell.real.v)]--;
      const r = rec(W - wildsUsed);
      for (const cell of meld.cells) if ('real' in cell) cnt[idx(cell.real.c, cell.real.v)]++;
      if (r.cost < best.cost) {
        best = { cost: r.cost, melds: [meld, ...r.melds], loose: r.loose, looseWilds: r.looseWilds };
      }
    };

    // Option 2: Gruppen (gleiche Zahl, verschiedene Farben). Frühere Farben sind schon abgearbeitet.
    const others: number[] = [];
    for (let c2 = c + 1; c2 < 4; c2++) if (cnt[idx(c2, v)] > 0) others.push(c2);
    for (let mask = 0; mask < 1 << others.length; mask++) {
      const chosen = [c];
      others.forEach((c2, k) => {
        if (mask & (1 << k)) chosen.push(c2);
      });
      for (let w = 0; w <= Math.min(W, 4 - chosen.length); w++) {
        if (chosen.length + w < 3) continue;
        const missing = [0, 1, 2, 3].filter((x) => !chosen.includes(x));
        const cells: MeldCell[] = chosen.map((cc) => ({ real: { c: cc, v } }));
        for (let k = 0; k < w; k++) cells.push({ wild: true, as: { c: missing[k], v } });
        consider({ kind: 'set', cells }, w);
      }
    }

    // Option 3: Reihen in Farbe c. Positionen 1..14 (14 = die 1 hinter der 13).
    const valueAt = (pos: number) => (pos === 14 ? 1 : pos);
    const extend = (p: number, pos: number, cells: MeldCell[], wUsed: number) => {
      if (cells.length >= 3) consider({ kind: 'run', cells: cells.slice() }, wUsed);
      if (pos > 14 || pos - p >= 13) return;
      if (pos === 14 && p === 1) return;
      const vv = valueAt(pos);
      if (cnt[idx(c, vv)] > 0) {
        cnt[idx(c, vv)]--;
        cells.push({ real: { c, v: vv } });
        // vorübergehend wieder hinzufügen, consider zieht selbst ab
        cnt[idx(c, vv)]++;
        extendGuarded(p, pos + 1, cells, wUsed);
        cells.pop();
      }
      if (wUsed < W) {
        cells.push({ wild: true, as: { c, v: vv } });
        extend(p, pos + 1, cells, wUsed + 1);
        cells.pop();
      }
    };
    // Schutz: ein realer Stein darf in einer Reihe nur so oft vorkommen, wie er da ist
    const extendGuarded = (p: number, pos: number, cells: MeldCell[], wUsed: number) => {
      const need = new Map<number, number>();
      for (const cell of cells) if ('real' in cell) {
        const k = idx(cell.real.c, cell.real.v);
        need.set(k, (need.get(k) ?? 0) + 1);
      }
      for (const [k, n] of need) if (cnt[k] < n) return;
      extend(p, pos, cells, wUsed);
    };

    for (let p = v; p >= Math.max(1, v - W); p--) {
      const cells: MeldCell[] = [];
      for (let q = p; q < v; q++) cells.push({ wild: true, as: { c, v: q } });
      cells.push({ real: { c, v } });
      extend(p, v + 1, cells, v - p);
    }
    // Die 1 als Ende einer Reihe ...12-13-1
    if (v === 1) {
      for (let p = 12; p >= 2; p--) {
        const build = (pos: number, cells: MeldCell[], wUsed: number) => {
          if (pos === 14) {
            const full = [...cells, { real: { c, v: 1 } } as MeldCell];
            const need = new Map<number, number>();
            for (const cell of full) if ('real' in cell) {
              const k = idx(cell.real.c, cell.real.v);
              need.set(k, (need.get(k) ?? 0) + 1);
            }
            for (const [k, n] of need) if (cnt[k] < n) return;
            consider({ kind: 'run', cells: full }, wUsed);
            return;
          }
          if (cnt[idx(c, pos)] > 0) {
            cells.push({ real: { c, v: pos } });
            build(pos + 1, cells, wUsed);
            cells.pop();
          }
          if (wUsed < W) {
            cells.push({ wild: true, as: { c, v: pos } });
            build(pos + 1, cells, wUsed + 1);
            cells.pop();
          }
        };
        build(p, [], 0);
      }
    }

    memo.set(key, best);
    return best;
  }

  return rec(wildsIn);
}

/** Alle Steine passen in Reihen/Gruppen (keiner bleibt übrig). */
export function isCompleteMelds(tiles: Tile[], okey: OkeyIdentity): boolean {
  const { counts, wilds } = toCounts(tiles, okey);
  return arrange(counts, wilds, () => 1, 1).cost === 0;
}

/** Anzahl Paare (Çift). Echter Okey paart mit allem; optional auch die Gösterge-Kopie. */
export function countPairs(
  tiles: Tile[],
  okey: OkeyIdentity,
  indicator: Tile | null,
  indicatorPairsAnything: boolean,
): { pairs: number; singles: number } {
  const groups = new Map<string, number>();
  let wilds = 0;
  for (const t of tiles) {
    if (isRealOkey(t, okey)) {
      wilds++;
      continue;
    }
    if (
      indicatorPairsAnything &&
      indicator &&
      !t.fake &&
      t.color === indicator.color &&
      t.value === indicator.value
    ) {
      wilds++;
      continue;
    }
    const r = resolve(t, okey) as Cell;
    const k = `${r.c}-${r.v}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  let pairs = 0;
  let singles = 0;
  for (const n of groups.values()) {
    pairs += Math.floor(n / 2);
    singles += n % 2;
  }
  const used = Math.min(wilds, singles);
  pairs += used;
  singles -= used;
  const restW = wilds - used;
  pairs += Math.floor(restW / 2);
  singles += restW % 2;
  return { pairs, singles };
}

export function isCompletePairs(
  tiles: Tile[],
  okey: OkeyIdentity,
  indicator: Tile | null,
  indicatorPairsAnything: boolean,
): boolean {
  if (tiles.length !== 14) return false;
  const { pairs, singles } = countPairs(tiles, okey, indicator, indicatorPairsAnything);
  return pairs === 7 && singles === 0;
}

/** Summe der losen Steine bei bester Aufteilung (loser Okey = 0). */
export function looseSum(tiles: Tile[], okey: OkeyIdentity): number {
  const { counts, wilds } = toCounts(tiles, okey);
  return arrange(counts, wilds, (c) => c.v, 0).cost;
}

export interface ValidMeld {
  kind: 'run' | 'set';
  /** Werte jeder Position (für die 101-Summe), in Reihenfolge */
  values: number[];
  color?: number;
  /** Reihe: Startposition (1..14) */
  start?: number;
}

/** Prüft, ob genau diese Steine eine gültige Reihe oder Gruppe bilden. */
export function validateMeld(tiles: Tile[], okey: OkeyIdentity): ValidMeld | null {
  if (tiles.length < 3) return null;
  const cells = tiles.map((t) => resolve(t, okey));
  const reals = cells.filter((x): x is Cell => x !== 'W');
  const wilds = cells.length - reals.length;
  if (reals.length === 0) return null;

  // Gruppe
  if (tiles.length <= 4 && reals.every((r) => r.v === reals[0].v)) {
    const colors = new Set(reals.map((r) => r.c));
    if (colors.size === reals.length) {
      return { kind: 'set', values: tiles.map(() => reals[0].v) };
    }
  }

  // Reihe
  if (tiles.length > 13) return null;
  if (!reals.every((r) => r.c === reals[0].c)) return null;
  for (const aceHigh of [false, true]) {
    const pos = reals.map((r) => (r.v === 1 && aceHigh ? 14 : r.v)).sort((a, b) => a - b);
    if (new Set(pos).size !== pos.length) continue;
    const span = pos[pos.length - 1] - pos[0] + 1;
    if (span - pos.length > wilds) continue;
    let extra = wilds - (span - pos.length);
    let start = pos[0];
    let end = pos[pos.length - 1];
    while (extra > 0 && end < 14) {
      end++;
      extra--;
    }
    while (extra > 0 && start > 1) {
      start--;
      extra--;
    }
    if (extra > 0) continue;
    if (start === 1 && end === 14) continue;
    if (end - start + 1 > 13) continue;
    const values: number[] = [];
    for (let p = start; p <= end; p++) values.push(p === 14 ? 1 : p);
    return { kind: 'run', values, color: reals[0].c, start };
  }
  return null;
}

export function meldSum(m: ValidMeld): number {
  return m.values.reduce((a, b) => a + b, 0);
}
