// Pişti: 52 Karten, 2 Spieler (Plätze 0 + 2) oder 4 Spieler im Team (0+2 gegen 1+3).
// Der Server hält diese Klasse; Clients schicken nur Aktionen und bekommen Ansichten.

import { Rng } from './rng.ts';

export class PistiError extends Error {}

export type Suit = 'S' | 'H' | 'D' | 'C'; // Pik, Herz, Karo, Kreuz
export interface Card {
  id: number;
  suit: Suit;
  /** 1 = Ass, 11 = Bube (Vale), 12 = Dame, 13 = König */
  rank: number;
}

export interface PistiRules {
  players: 2 | 4;
  /** Zielpunkte (z. B. 101 oder 151) */
  target: number;
  /** Kapalı Pişti (Bluff) erlaubt */
  bluff: boolean;
}

export const JACK = 11;

export function createCardDeck(): Card[] {
  const out: Card[] = [];
  let id = 0;
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) for (let rank = 1; rank <= 13; rank++) out.push({ id: id++, suit, rank });
  return out;
}

/** Punkte, die eine Karte am Rundenende bringt */
export function cardPoints(c: Card): number {
  if (c.suit === 'D' && c.rank === 10) return 3;
  if (c.suit === 'C' && c.rank === 2) return 2;
  if (c.rank === 1 || c.rank === JACK) return 1;
  return 0;
}

export interface PistiTeamResult {
  cards: number;
  aces: number;
  jacks: number;
  clubs2: number;
  diamonds10: number;
  majority: number;
  pistis: number;
  pistiPoints: number;
  total: number;
}

export interface PistiRoundResult {
  teams: [PistiTeamResult, PistiTeamResult];
  /** wer zuletzt gestochen hat (bekommt den Rest) */
  lastCapture: number | null;
}

export type PistiEvent =
  | { seq: number; kind: 'deal'; seat: number }
  | { seq: number; kind: 'play'; seat: number; card: Card }
  | { seq: number; kind: 'capture'; seat: number; card: Card; count: number }
  | { seq: number; kind: 'pisti'; seat: number; card: Card; count: number; points: number }
  | { seq: number; kind: 'bluff'; seat: number; claimJack: boolean }
  | { seq: number; kind: 'bluffBelieved'; seat: number; by: number; points: number }
  | { seq: number; kind: 'bluffTrue'; seat: number; by: number; card: Card; points: number }
  | { seq: number; kind: 'bluffFalse'; seat: number; by: number; card: Card; points: number }
  | { seq: number; kind: 'roundEnd'; seat: number };

type DistOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type PistiEventInput = DistOmit<PistiEvent, 'seq'>;

export class PistiGame {
  readonly kind = 'pisti' as const;
  readonly rules: PistiRules;
  private rng: Rng;
  /** aktive Plätze in Spielreihenfolge */
  readonly seats: number[];
  dealer: number;
  handNo = 0;
  phase: 'play' | 'bluff' | 'handOver' = 'play';
  current = 0;
  hands: Card[][] = [[], [], [], []];
  stock: Card[] = [];
  /** Karten in der Mitte, unten zuerst; die ersten hiddenInPile liegen verdeckt */
  pile: Card[] = [];
  hiddenInPile = 0;
  captured: [Card[], Card[]] = [[], []];
  pistiCount: [number, number] = [0, 0];
  pistiPoints: [number, number] = [0, 0];
  lastCapture: number | null = null;
  pending: { seat: number; card: Card; claimJack: boolean } | null = null;
  scores: [number, number] = [0, 0];
  history: { points: [number, number]; result: PistiRoundResult }[] = [];
  lastResult: PistiRoundResult | null = null;
  gameOver = false;
  winnerTeam: number | null = null;
  lastEvent: PistiEvent | null = null;
  private seq = 0;
  /** offen gesehene Karten pro Wert (für Bots) */
  seen: number[] = new Array(14).fill(0);

  constructor(rules: PistiRules, seed = Date.now()) {
    this.rules = { ...rules, target: Math.max(10, Math.min(1000, Math.round(rules.target) || 101)) };
    this.rng = new Rng(seed);
    this.seats = rules.players === 2 ? [0, 2] : [0, 1, 2, 3];
    this.dealer = this.seats[this.seats.length - 1];
    this.deal();
  }

  /** Kompatibilität mit dem Server (wie OkeyGame.hand) */
  get hand() {
    return { phase: this.phase, current: this.current };
  }

  teamOf(seat: number): number {
    return this.rules.players === 2 ? (seat === 0 ? 0 : 1) : seat % 2;
  }

  next(seat: number): number {
    const i = this.seats.indexOf(seat);
    return this.seats[(i + 1) % this.seats.length];
  }

  private event(e: PistiEventInput) {
    this.lastEvent = { ...(e as any), seq: ++this.seq };
  }

  private deal() {
    const deck = this.rng.shuffle(createCardDeck());
    this.hands = [[], [], [], []];
    this.captured = [[], []];
    this.pistiCount = [0, 0];
    this.pistiPoints = [0, 0];
    this.lastCapture = null;
    this.pending = null;
    this.seen = new Array(14).fill(0);
    // Mitte: 3 verdeckt + 1 offen; die offene darf keine Vale sein
    this.pile = deck.splice(0, 4);
    if (this.pile[3].rank === JACK) {
      const k = deck.findIndex((c) => c.rank !== JACK);
      const j = this.pile[3];
      this.pile[3] = deck.splice(k, 1)[0];
      deck.splice(this.rng.int(deck.length + 1), 0, j);
    }
    this.hiddenInPile = 3;
    this.seen[this.pile[3].rank]++;
    this.stock = deck;
    this.giveCards();
    this.current = this.next(this.dealer);
    this.phase = 'play';
    this.event({ kind: 'deal', seat: this.dealer });
  }

  /** jedem aktiven Spieler 4 Karten, beginnend links vom Geber */
  private giveCards() {
    let s = this.next(this.dealer);
    for (let n = 0; n < this.seats.length; n++) {
      this.hands[s].push(...this.stock.splice(0, 4));
      s = this.next(s);
    }
  }

  private handsEmpty() {
    return this.seats.every((s) => this.hands[s].length === 0);
  }

  private take(seat: number, cardId: number): Card {
    const h = this.hands[seat];
    const i = h.findIndex((c) => c.id === cardId);
    if (i < 0) throw new PistiError('Karte nicht auf der Hand');
    return h.splice(i, 1)[0];
  }

  private check(seat: number) {
    if (this.gameOver || this.phase === 'handOver') throw new PistiError('Runde ist vorbei');
    if (this.current !== seat) throw new PistiError('Nicht dein Zug');
  }

  /** Karte offen spielen – oder verdeckt als Pişti-Bluff (nur bei genau 1 Karte in der Mitte) */
  play(seat: number, cardId: number, bluff = false) {
    this.check(seat);
    if (this.phase !== 'play') throw new PistiError('Erst Bluff beantworten');
    if (bluff) {
      if (!this.rules.bluff) throw new PistiError('Bluff ist aus');
      if (this.pile.length !== 1 || this.hiddenInPile) throw new PistiError('Bluff nur bei genau einer Karte in der Mitte');
      const lastOfRound = this.stock.length === 0 && this.seats.every((s) => this.hands[s].length === (s === seat ? 1 : 0));
      if (lastOfRound) throw new PistiError('Mit der letzten Karte kein Bluff');
      const card = this.take(seat, cardId);
      this.pending = { seat, card, claimJack: this.pile[0].rank === JACK };
      this.phase = 'bluff';
      this.current = this.next(seat);
      this.event({ kind: 'bluff', seat, claimJack: this.pending.claimJack });
      return;
    }
    const card = this.take(seat, cardId);
    this.resolve(seat, card);
    this.afterTurn(seat);
  }

  private resolve(seat: number, card: Card) {
    const team = this.teamOf(seat);
    const top = this.pile[this.pile.length - 1];
    this.seen[card.rank]++;
    if (top && (card.rank === top.rank || card.rank === JACK)) {
      // Pişti: genau eine Karte in der Mitte, gleicher Wert – nicht mit der allerletzten Karte der Runde
      const lastCard = this.stock.length === 0 && this.handsEmpty();
      const pisti = this.pile.length === 1 && card.rank === top.rank && !lastCard;
      const points = pisti ? (card.rank === JACK ? 20 : 10) : 0;
      const count = this.pile.length + 1;
      this.captured[team].push(...this.pile, card);
      this.pile = [];
      this.hiddenInPile = 0;
      this.lastCapture = team;
      if (pisti) {
        this.pistiCount[team]++;
        this.pistiPoints[team] += points;
        this.event({ kind: 'pisti', seat, card, count, points });
      } else this.event({ kind: 'capture', seat, card, count });
    } else {
      this.pile.push(card);
      this.event({ kind: 'play', seat, card });
    }
  }

  /** Antwort auf einen Bluff: glauben oder aufdecken */
  respond(seat: number, believe: boolean) {
    this.check(seat);
    const p = this.pending;
    if (this.phase !== 'bluff' || !p) throw new PistiError('Kein Bluff offen');
    const team = this.teamOf(p.seat);
    const other = 1 - team;
    const single = this.pile[0];
    this.pending = null;
    this.phase = 'play';
    if (believe) {
      // geglaubt: verdeckt genommen, Karte bleibt geheim
      const points = p.claimJack ? 20 : 10;
      this.captured[team].push(...this.pile, p.card);
      this.pile = [];
      this.lastCapture = team;
      this.pistiCount[team]++;
      this.pistiPoints[team] += points;
      this.event({ kind: 'bluffBelieved', seat: p.seat, by: seat, points });
    } else {
      this.seen[p.card.rank]++;
      if (p.card.rank === single.rank) {
        // war echt → doppelt
        const points = p.claimJack ? 40 : 20;
        this.captured[team].push(...this.pile, p.card);
        this.pile = [];
        this.lastCapture = team;
        this.pistiCount[team]++;
        this.pistiPoints[team] += points;
        this.event({ kind: 'bluffTrue', seat: p.seat, by: seat, card: p.card, points });
      } else {
        // geblufft → Punkte für den, der aufgedeckt hat; Karte bleibt offen liegen
        const points = p.claimJack ? 20 : 10;
        this.pistiPoints[other] += points;
        this.pile.push(p.card);
        this.event({ kind: 'bluffFalse', seat: p.seat, by: seat, card: p.card, points });
      }
    }
    this.afterTurn(p.seat);
  }

  private afterTurn(seat: number) {
    this.current = this.next(seat);
    if (!this.handsEmpty()) return;
    if (this.stock.length) {
      this.giveCards();
      this.current = this.next(this.dealer);
      return;
    }
    this.endRound(seat);
  }

  private endRound(seat: number) {
    // Rest in der Mitte bekommt, wer zuletzt gestochen hat
    if (this.pile.length && this.lastCapture !== null) this.captured[this.lastCapture].push(...this.pile);
    this.pile = [];
    this.hiddenInPile = 0;
    const res = (t: number): PistiTeamResult => {
      const cs = this.captured[t];
      const aces = cs.filter((c) => c.rank === 1).length;
      const jacks = cs.filter((c) => c.rank === JACK).length;
      const clubs2 = cs.some((c) => c.suit === 'C' && c.rank === 2) ? 2 : 0;
      const diamonds10 = cs.some((c) => c.suit === 'D' && c.rank === 10) ? 3 : 0;
      return { cards: cs.length, aces, jacks, clubs2, diamonds10, majority: 0, pistis: this.pistiCount[t], pistiPoints: this.pistiPoints[t], total: 0 };
    };
    const teams: [PistiTeamResult, PistiTeamResult] = [res(0), res(1)];
    if (teams[0].cards > teams[1].cards) teams[0].majority = 3;
    else if (teams[1].cards > teams[0].cards) teams[1].majority = 3;
    for (const r of teams) r.total = r.aces + r.jacks + r.clubs2 + r.diamonds10 + r.majority + r.pistiPoints;
    const result: PistiRoundResult = { teams, lastCapture: this.lastCapture };
    this.lastResult = result;
    this.scores = [this.scores[0] + teams[0].total, this.scores[1] + teams[1].total];
    this.history.push({ points: [teams[0].total, teams[1].total], result });
    this.phase = 'handOver';
    this.event({ kind: 'roundEnd', seat });
    const [a, b] = this.scores;
    if ((a >= this.rules.target || b >= this.rules.target) && a !== b) {
      this.gameOver = true;
      this.winnerTeam = a > b ? 0 : 1;
    }
  }

  nextHand() {
    if (this.gameOver || this.phase !== 'handOver') return;
    this.handNo++;
    this.dealer = this.next(this.dealer);
    this.deal();
  }

  viewFor(seat: number) {
    const visible = this.pile.slice(this.hiddenInPile);
    return {
      kind: 'pisti' as const,
      seat,
      players: this.rules.players,
      seats: this.seats,
      teamOfSeat: [0, 1, 2, 3].map((s) => this.teamOf(s)),
      current: this.current,
      phase: this.gameOver ? ('gameOver' as const) : this.phase,
      dealer: this.dealer,
      handNo: this.handNo,
      myHand: this.seats.includes(seat) ? this.hands[seat] : [],
      handCounts: this.hands.map((h) => h.length),
      stockCount: this.stock.length,
      pile: visible,
      hiddenCount: this.hiddenInPile,
      pileCount: this.pile.length,
      capturedCounts: [this.captured[0].length, this.captured[1].length],
      pistiCount: this.pistiCount,
      pistiPoints: this.pistiPoints,
      scores: this.scores,
      teamScores: this.scores,
      target: this.rules.target,
      bluff: this.rules.bluff,
      pending: this.pending ? { seat: this.pending.seat, claimJack: this.pending.claimJack } : null,
      lastEvent: this.lastEvent,
      lastResult: this.lastResult,
      history: this.history.map((x) => ({ points: x.points, result: x.result })),
      gameOver: this.gameOver,
      winnerTeam: this.winnerTeam,
    };
  }
}

// ------------------------------------------------------------------ Bot

/** ein Zug für einen Bot (oder bei abgelaufener Zeit) */
export function pistiBotTurn(g: PistiGame, seat: number, rnd: () => number = Math.random) {
  if (g.current !== seat || g.gameOver || g.phase === 'handOver') return;
  if (g.phase === 'bluff' && g.pending) {
    // aufdecken, wenn von dem Wert schon viel offen war (dann ist ein Treffer unwahrscheinlich)
    const r = g.pile[0]?.rank ?? 0;
    const seenOthers = g.seen[r] - 1 + g.hands[seat].filter((c) => c.rank === r).length;
    const challenge = seenOthers >= 2 || rnd() < 0.3;
    g.respond(seat, !challenge);
    return;
  }
  const hand = g.hands[seat];
  if (!hand.length) return;
  const top = g.pile[g.pile.length - 1];
  const value = (cs: Card[]) => cs.reduce((s, c) => s + cardPoints(c), 0) + cs.length * 0.15;
  // 1) Pişti möglich?
  if (top && g.pile.length === 1) {
    const same = hand.find((c) => c.rank === top.rank);
    if (same) return g.play(seat, same.id);
    // 2) manchmal bluffen (mit einer unwichtigen Karte)
    if (g.rules.bluff && hand.length > 1 && rnd() < 0.12) {
      const cheap = [...hand].filter((c) => c.rank !== JACK).sort((a, b) => cardPoints(a) - cardPoints(b))[0];
      if (cheap) {
        try {
          return g.play(seat, cheap.id, true);
        } catch {}
      }
    }
  }
  // 3) gleicher Wert → stechen
  if (top) {
    const same = hand.find((c) => c.rank === top.rank);
    if (same) return g.play(seat, same.id);
    // 4) Vale lohnt sich bei großem/wertvollem Stapel
    const jack = hand.find((c) => c.rank === JACK);
    if (jack && (g.pile.length >= 4 || value(g.pile) >= 2 || (g.stock.length === 0 && hand.length === 1))) return g.play(seat, jack.id);
  }
  // 5) sicher abwerfen: Wert, der schon oft offen war, keine Punktkarte, keine Vale
  const safe = [...hand].sort((a, b) => {
    const sa = (a.rank === JACK ? 10 : 0) + cardPoints(a) * 2 - g.seen[a.rank];
    const sb = (b.rank === JACK ? 10 : 0) + cardPoints(b) * 2 - g.seen[b.rank];
    return sa - sb;
  });
  g.play(seat, safe[0].id);
}
