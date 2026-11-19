// Tisch-Regeln (Hausregeln). Alles, was der Tischbesitzer einstellen kann.

import type { Color } from './tiles.ts';

export type Mode = 'standard' | 'okey101' | 'perisan' | 'pisti' | 'batak';

export interface TableRules {
  mode: Mode;
  /** Standard: renkli (doppelte Abzüge) */
  colorful: boolean;
  /** Standard: Startpunkte pro Team */
  startPoints: number;
  /** 101 / Perişan: Anzahl Hände */
  handCount: number;
  /** Perişan: Multiplikator pro Gösterge-Farbe */
  colorMultipliers: Record<Color, number>;
  /** 101: Mindestsumme zum Açmak */
  openThreshold: number;
  /** 101: Anzahl Paare zum Açmak mit Çift */
  pairOpenCount: number;
  /** 101: Strafen verdoppeln sich bei Okey-/Çift-Ende (katlamalı) */
  doubling101: boolean;
  /** Çift: Gösterge-Kopie auf der Hand zählt als Partner für jeden Stein */
  indicatorPairsAnything: boolean;
  stealing: { enabled: boolean; maxPerHand: number };
  /** Schwer-Modus: kein Auto-Sortieren, keine Hinweise (nur Client) */
  hardMode: boolean;
  /** Zug-Timer in Sekunden, null = aus (nur Client/Server-Timer) */
  turnTimerSec: number | null;
  /** Bots dürfen leere Plätze füllen */
  allowBots: boolean;
  /** Pişti: 2 oder 4 Spieler, Zielpunkte, Bluff (Kapalı Pişti) */
  pistiPlayers: 2 | 4;
  pistiTarget: number;
  pistiBluff: boolean;
  /** Batak-Variante */
  batakMode: 'ihaleli' | 'esli' | 'gommeli';
  batakTarget: number;
  /** 0 = nach Punkten, sonst Anzahl Hände */
  batakHands: number;
  batakMinBid: number;
  batakMustTrump: boolean;
  batakTrumpBreak: boolean;
  /** so viele Stiche über dem Gebot = auch batık (0 = aus) */
  batakOverLimit: number;
  batakZeroBatar: boolean;
}

export function defaultRules(mode: Mode): TableRules {
  return {
    mode,
    colorful: false,
    startPoints: 20,
    handCount: mode === 'okey101' ? 9 : 11,
    colorMultipliers: { red: 7, black: 8, yellow: 9, blue: 10 },
    openThreshold: 101,
    pairOpenCount: 5,
    doubling101: true,
    indicatorPairsAnything: true,
    stealing: { enabled: false, maxPerHand: 1 },
    hardMode: false,
    turnTimerSec: null,
    allowBots: true,
    pistiPlayers: 4,
    pistiTarget: 151,
    pistiBluff: false,
    batakMode: 'ihaleli',
    batakTarget: 51,
    batakHands: 0,
    batakMinBid: 5,
    batakMustTrump: true,
    batakTrumpBreak: true,
    batakOverLimit: 0,
    batakZeroBatar: true,
  };
}
