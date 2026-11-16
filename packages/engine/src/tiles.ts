// Steine, Deck und Okey-Bestimmung

export type Color = 'red' | 'black' | 'yellow' | 'blue';
export const COLORS: Color[] = ['red', 'black', 'yellow', 'blue'];

export interface Tile {
  id: number;
  /** null bei Sahte Okey */
  color: Color | null;
  /** 1..13, 0 bei Sahte Okey */
  value: number;
  fake: boolean;
}

/** Ein Stein, wie er für die Auswertung zählt (Okey aufgelöst). */
export interface Cell {
  c: number; // Farbindex 0..3
  v: number; // 1..13
}

export interface OkeyIdentity {
  color: Color;
  value: number;
}

export function createDeck(): Tile[] {
  const deck: Tile[] = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const color of COLORS) {
      for (let value = 1; value <= 13; value++) {
        deck.push({ id: id++, color, value, fake: false });
      }
    }
  }
  deck.push({ id: id++, color: null, value: 0, fake: true });
  deck.push({ id: id++, color: null, value: 0, fake: true });
  return deck; // 106 Steine
}

/** Okey = eine Zahl höher als die Gösterge, gleiche Farbe (13 → 1). */
export function okeyFromIndicator(indicator: Tile): OkeyIdentity {
  if (indicator.fake || !indicator.color) throw new Error('Sahte Okey kann keine Gösterge sein');
  return { color: indicator.color, value: (indicator.value % 13) + 1 };
}

export function isRealOkey(t: Tile, okey: OkeyIdentity): boolean {
  return !t.fake && t.color === okey.color && t.value === okey.value;
}

/** Auflösung: echter Okey → Joker, Sahte Okey → zählt als Okey-Stein. */
export function resolve(t: Tile, okey: OkeyIdentity): Cell | 'W' {
  if (isRealOkey(t, okey)) return 'W';
  if (t.fake) return { c: COLORS.indexOf(okey.color), v: okey.value };
  return { c: COLORS.indexOf(t.color!), v: t.value };
}

/** Punktwert eines Steins auf der Hand (loser Okey = 0, Sahte Okey = Wert des Okey-Steins). */
export function tileValue(t: Tile, okey: OkeyIdentity): number {
  const r = resolve(t, okey);
  return r === 'W' ? 0 : r.v;
}

export function tileLabel(t: Tile): string {
  if (t.fake) return 'SO';
  const short = { red: 'R', black: 'S', yellow: 'G', blue: 'B' }[t.color!];
  return `${short}${t.value}`;
}
