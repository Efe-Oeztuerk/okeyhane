// Batak (İhaleli, Eşli, Gömmeli) mit 52 Karten.
// Der Server hält diese Klasse; Clients schicken nur Aktionen und bekommen Ansichten.

import { Rng } from './rng.ts';
import { createCardDeck, type Card, type Suit } from './pisti.ts';

export class BatakError extends Error {}

export type BatakMode = 'ihaleli' | 'esli' | 'gommeli';

export interface BatakRules {
  mode: BatakMode;
  /** Spiel bis zu diesen Punkten */
  target: number;
  /** kleinstes Gebot (İhaleli üblich 5, Eşli 8, Gömmeli 4) */
  minBid: number;
  /** (immer an) wer die Farbe nicht hat, muss Koz spielen */
  mustTrump: boolean;
  /** Koz darf erst ausgespielt werden, wenn schon einmal Koz gefallen ist */
  trumpBreak: boolean;
  /** so viele Stiche über dem Gebot zählen auch als „batmak“ (0 = aus) */
  overLimit: number;
  /** wer (außer dem Bieter) keinen Stich macht, ist auch „batık“ */
  zeroBatar: boolean;
}

export const DEFAULT_BATAK: BatakRules = { mode: 'ihaleli', target: 51, minBid: 5, mustTrump: true, trumpBreak: true, overLimit: 0, zeroBatar: true };

/** Wert für den Vergleich: Ass am höchsten */
export const rankValue = (r: number) => (r === 1 ? 14 : r);

export type BatakEvent =
  | { seq: number; kind: 'deal'; seat: number }
  | { seq: number; kind: 'bid'; seat: number; bid: number | null }
  | { seq: number; kind: 'contract'; seat: number; bid: number }
  | { seq: number; kind: 'trump'; seat: number; suit: Suit }
  | { seq: number; kind: 'bury'; seat: number }
  | { seq: number; kind: 'play'; seat: number; card: Card }
  | { seq: number; kind: 'trick'; seat: number; cards: { seat: number; card: Card }[] }
  | { seq: number; kind: 'handEnd'; seat: number };

type DistOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type BatakEventInput = DistOmit<BatakEvent, 'seq'>;

export interface BatakHandResult {
  bidder: number;
  bid: number;
  trump: Suit;
  /** Stiche je Platz */
  tricks: number[];
  /** Punkte je Platz (bei Eşli je Team auf beiden Plätzen gleich) */
  points: number[];
  /** hat der Bieter (bzw. sein Team) es geschafft? */
  made: boolean;
  /** Plätze, die „batık“ sind */
  batik: number[];
}

export class BatakGame {
  readonly kind = 'batak' as const;
  readonly rules: BatakRules;
  private rng: Rng;
  readonly seats: number[];
  dealer: number;
  handNo = 0;
  phase: 'bid' | 'trump' | 'bury' | 'play' | 'handOver' = 'bid';
  current: number;
  hands: Card[][] = [[], [], [], []];
  kitty: Card[] = [];
  /** Gebote dieser Hand: Zahl, null = gepasst, undefined = noch nicht */
  bids: (number | null | undefined)[] = [undefined, undefined, undefined, undefined];
  contract: { seat: number; bid: number } | null = null;
  trump: Suit | null = null;
  trumpBroken = false;
  trick: { seat: number; card: Card }[] = [];
  lastTrick: { winner: number; cards: { seat: number; card: Card }[] } | null = null;
  tricks: number[] = [0, 0, 0, 0];
  scores: number[] = [0, 0, 0, 0];
  history: BatakHandResult[] = [];
  lastResult: BatakHandResult | null = null;
  gameOver = false;
  /** Gewinner: Platz (bei Eşli: Team 0/1) */
  winner: number | null = null;
  lastEvent: BatakEvent | null = null;
  private seq = 0;
  /** gespielte Karten (für Bots) */
  played: Card[] = [];

  constructor(rules: Partial<BatakRules> = {}, seed = Date.now()) {
    this.rules = { ...DEFAULT_BATAK, ...rules };
    this.rng = new Rng(seed);
    this.seats = this.rules.mode === 'gommeli' ? [0, 1, 2] : [0, 1, 2, 3];
    this.dealer = this.seats[this.rng.int(this.seats.length)];
    this.current = this.dealer;
    this.deal();
  }

  /** Kompatibilität mit dem Okey-Server (phase/current) */
  get hand() {
    return { phase: this.phase, current: this.current };
  }
  /** für die Statistik: Eşli = Team, sonst der Platz */
  get winnerTeam() {
    return this.winner;
  }

  get team(): boolean {
    return this.rules.mode === 'esli';
  }
  teamOf(seat: number) {
    return seat % 2;
  }
  next(seat: number): number {
    const i = this.seats.indexOf(seat);
    return this.seats[(i + 1) % this.seats.length];
  }
  private event(e: BatakEventInput) {
    this.lastEvent = { ...e, seq: ++this.seq } as BatakEvent;
  }

  private deal() {
    const deck = this.rng.shuffle(createCardDeck());
    this.hands = [[], [], [], []];
    const per = this.rules.mode === 'gommeli' ? 16 : 13;
    for (const s of this.seats) this.hands[s] = deck.splice(0, per);
    this.kitty = deck; // Gömmeli: 4 Karten, sonst leer
    for (const s of this.seats) sortHand(this.hands[s]);
    this.bids = [undefined, undefined, undefined, undefined];
    this.contract = null;
    this.trump = null;
    this.trumpBroken = false;
    this.trick = [];
    this.lastTrick = null;
    this.tricks = [0, 0, 0, 0];
    this.played = [];
    this.phase = 'bid';
    this.current = this.next(this.dealer);
    this.handNo++;
    this.event({ kind: 'deal', seat: this.dealer });
  }

  private check(seat: number) {
    if (this.gameOver) throw new BatakError('Spiel vorbei');
    if (seat !== this.current) throw new BatakError('Nicht dran');
  }

  /** höchstes Gebot bisher */
  get highBid(): { seat: number; bid: number } | null {
    let best: { seat: number; bid: number } | null = null;
    for (const s of this.seats) {
      const b = this.bids[s];
      if (typeof b === 'number' && (!best || b > best.bid)) best = { seat: s, bid: b };
    }
    return best;
  }
  /** kleinstes erlaubtes Gebot für den nächsten */
  get nextMinBid() {
    const hb = this.highBid;
    return hb ? hb.bid + 1 : this.rules.minBid;
  }
  get maxBid() {
    return this.rules.mode === 'gommeli' ? 16 : 13;
  }

  bid(seat: number, value: number | null) {
    this.check(seat);
    if (this.phase !== 'bid') throw new BatakError('Keine Ihale');
    if (value !== null) {
      if (!Number.isInteger(value) || value < this.nextMinBid || value > this.maxBid) throw new BatakError('Ungültiges Gebot');
    }
    this.bids[seat] = value;
    this.event({ kind: 'bid', seat, bid: value });
    // fertig, wenn alle außer einem gepasst haben (und der eine geboten hat) oder alle gepasst haben
    const passed = this.seats.filter((s) => this.bids[s] === null);
    const open = this.seats.filter((s) => this.bids[s] !== null);
    const allSpoken = this.seats.every((s) => this.bids[s] !== undefined);
    if (passed.length === this.seats.length) {
      // alle gepasst → wer die Runde angefangen hat, bekommt die Ihale mit dem Mindestgebot
      const opener = this.next(this.dealer);
      this.bids[opener] = this.rules.minBid;
      return this.setContract(opener, this.rules.minBid);
    }
    if (open.length === 1 && allSpoken && typeof this.bids[open[0]] === 'number') return this.setContract(open[0], this.bids[open[0]] as number);
    if (value === this.maxBid) return this.setContract(seat, value);
    // nächster, der noch nicht gepasst hat
    let n = this.next(seat);
    for (let i = 0; i < this.seats.length && this.bids[n] === null; i++) n = this.next(n);
    this.current = n;
  }

  private setContract(seat: number, bid: number) {
    this.contract = { seat, bid };
    this.event({ kind: 'contract', seat, bid });
    this.current = seat;
    if (this.rules.mode === 'gommeli') {
      this.hands[seat].push(...this.kitty);
      this.kitty = [];
      sortHand(this.hands[seat]);
      this.phase = 'bury';
    } else this.phase = 'trump';
  }

  /** Gömmeli: Bieter legt 4 Karten verdeckt weg */
  bury(seat: number, cardIds: number[]) {
    this.check(seat);
    if (this.phase !== 'bury') throw new BatakError('Nicht jetzt');
    const ids = [...new Set(cardIds)];
    if (ids.length !== 4) throw new BatakError('Genau 4 Karten');
    const h = this.hands[seat];
    if (!ids.every((id) => h.some((c) => c.id === id))) throw new BatakError('Karte fehlt');
    this.kitty = h.filter((c) => ids.includes(c.id));
    this.hands[seat] = h.filter((c) => !ids.includes(c.id));
    this.event({ kind: 'bury', seat });
    this.phase = 'trump';
  }

  chooseTrump(seat: number, suit: Suit) {
    this.check(seat);
    if (this.phase !== 'trump') throw new BatakError('Nicht jetzt');
    if (!['S', 'H', 'D', 'C'].includes(suit)) throw new BatakError('Farbe?');
    this.trump = suit;
    this.event({ kind: 'trump', seat, suit });
    this.phase = 'play';
    this.current = seat; // Bieter spielt aus
  }

  /** welche Karten darf dieser Platz jetzt spielen? */
  legal(seat: number): Card[] {
    const hand = this.hands[seat];
    if (this.phase !== 'play' || seat !== this.current) return [];
    const trump = this.trump!;
    if (!this.trick.length) {
      // Ausspiel: Koz erst, wenn gebrochen (oder nur noch Koz)
      if (this.rules.trumpBreak && !this.trumpBroken) {
        const nonTrump = hand.filter((c) => c.suit !== trump);
        if (nonTrump.length) return nonTrump;
      }
      return hand;
    }
    const led = this.trick[0].card.suit;
    const follow = hand.filter((c) => c.suit === led);
    const trumped = this.trick.some((t) => t.card.suit === trump) && led !== trump;
    if (follow.length) {
      // Farbe bedienen – und höher, wenn möglich (außer schon gestochen)
      if (trumped) return follow;
      const high = Math.max(...this.trick.filter((t) => t.card.suit === led).map((t) => rankValue(t.card.rank)));
      const higher = follow.filter((c) => rankValue(c.rank) > high);
      return higher.length ? higher : follow;
    }
    const trumps = hand.filter((c) => c.suit === trump);
    if (trumps.length) {
      // liegt schon Koz: wer Koz spielt, muss überstechen, wenn möglich
      const highT = this.trick.filter((t) => t.card.suit === trump).map((t) => rankValue(t.card.rank));
      const over = highT.length ? trumps.filter((c) => rankValue(c.rank) > Math.max(...highT)) : trumps;
      // Farbe fehlt, Koz vorhanden → Koz ist Pflicht (überstechen, wenn möglich)
      return over.length ? over : trumps;
    }
    return hand;
  }

  play(seat: number, cardId: number) {
    this.check(seat);
    if (this.phase !== 'play') throw new BatakError('Nicht jetzt');
    const card = this.hands[seat].find((c) => c.id === cardId);
    if (!card) throw new BatakError('Karte fehlt');
    if (!this.legal(seat).some((c) => c.id === cardId)) throw new BatakError('Regel: diese Karte geht nicht');
    this.hands[seat] = this.hands[seat].filter((c) => c.id !== cardId);
    this.trick.push({ seat, card });
    this.played.push(card);
    if (card.suit === this.trump) this.trumpBroken = true;
    this.event({ kind: 'play', seat, card });
    if (this.trick.length < this.seats.length) {
      this.current = this.next(seat);
      return;
    }
    const winner = this.trickWinner(this.trick);
    this.tricks[winner]++;
    this.lastTrick = { winner, cards: this.trick };
    this.event({ kind: 'trick', seat: winner, cards: this.trick });
    this.trick = [];
    this.current = winner;
    if (this.seats.every((s) => !this.hands[s].length)) this.endHand();
  }

  trickWinner(trick: { seat: number; card: Card }[]): number {
    const trump = this.trump!;
    const led = trick[0].card.suit;
    let best = trick[0];
    for (const t of trick.slice(1)) {
      const bt = best.card.suit === trump;
      const tt = t.card.suit === trump;
      if (tt && !bt) best = t;
      else if (tt === bt && t.card.suit === best.card.suit && rankValue(t.card.rank) > rankValue(best.card.rank)) best = t;
      else if (!tt && !bt && t.card.suit === led && best.card.suit !== led) best = t;
    }
    return best.seat;
  }

  private endHand() {
    const c = this.contract!;
    const points = [0, 0, 0, 0];
    const batik: number[] = [];
    let made: boolean;
    if (this.team) {
      const bt = this.teamOf(c.seat);
      const teamTricks = [0, 1].map((tm) => this.seats.filter((s) => this.teamOf(s) === tm).reduce((a, s) => a + this.tricks[s], 0));
      const got = teamTricks[bt];
      made = got >= c.bid && !(this.rules.overLimit > 0 && got >= c.bid + this.rules.overLimit);
      const pts = [0, 0];
      pts[bt] = made ? got : -c.bid;
      if (!made) batik.push(...this.seats.filter((s) => this.teamOf(s) === bt));
      const ot = 1 - bt;
      if (this.rules.zeroBatar && teamTricks[ot] === 0) {
        pts[ot] = -c.bid;
        batik.push(...this.seats.filter((s) => this.teamOf(s) === ot));
      } else pts[ot] = teamTricks[ot];
      for (const s of this.seats) points[s] = pts[this.teamOf(s)];
    } else {
      const got = this.tricks[c.seat];
      made = got >= c.bid && !(this.rules.overLimit > 0 && got >= c.bid + this.rules.overLimit);
      for (const s of this.seats) {
        if (s === c.seat) {
          points[s] = made ? got : -c.bid;
          if (!made) batik.push(s);
        } else if (this.rules.zeroBatar && this.tricks[s] === 0) {
          points[s] = -c.bid;
          batik.push(s);
        } else points[s] = this.tricks[s];
      }
    }
    for (const s of this.seats) this.scores[s] += points[s];
    const res: BatakHandResult = { bidder: c.seat, bid: c.bid, trump: this.trump!, tricks: [...this.tricks], points, made, batik };
    this.history.push(res);
    this.lastResult = res;
    this.phase = 'handOver';
    this.event({ kind: 'handEnd', seat: c.seat });
    // Spielende: jemand hat das Ziel erreicht und es gibt einen eindeutigen Besten
    const vals = this.team ? [this.scores[0], this.scores[1]] : this.seats.map((s) => this.scores[s]);
    const max = Math.max(...vals);
    if (max >= this.rules.target && vals.filter((v) => v === max).length === 1) {
      this.gameOver = true;
      this.winner = this.team ? vals.indexOf(max) : this.seats[vals.indexOf(max)];
    }
  }

  nextHand() {
    if (this.phase !== 'handOver' || this.gameOver) return;
    this.dealer = this.next(this.dealer);
    this.deal();
  }

  viewFor(seat: number) {
    const mine = this.seats.includes(seat);
    // Eşli: die Karten vom Partner des Bieters liegen offen (ab dem ersten Ausspiel)
    let open: { seat: number; cards: Card[] } | null = null;
    if (this.team && this.contract && this.phase === 'play' && (this.played.length > 0 || this.trick.length > 0)) {
      const p = (this.contract.seat + 2) % 4;
      open = { seat: p, cards: this.hands[p] };
    }
    return {
      kind: 'batak' as const,
      mode: this.rules.mode,
      seats: this.seats,
      current: this.current,
      phase: this.phase,
      dealer: this.dealer,
      handNo: this.handNo,
      myHand: mine ? this.hands[seat] : [],
      legal: mine ? this.legal(seat).map((c) => c.id) : [],
      handCounts: this.hands.map((h) => h.length),
      bids: this.bids.map((b) => (b === undefined ? 'wait' : b)),
      nextMinBid: this.nextMinBid,
      maxBid: this.maxBid,
      contract: this.contract,
      trump: this.trump,
      trumpBroken: this.trumpBroken,
      trick: this.trick,
      lastTrick: this.lastTrick,
      tricks: this.tricks,
      scores: this.scores,
      team: this.team,
      open,
      kittyCount: this.kitty.length,
      rules: this.rules,
      lastEvent: this.lastEvent,
      lastResult: this.lastResult,
      history: this.history,
      gameOver: this.gameOver,
      winner: this.winner,
    };
  }
}

export function sortHand(h: Card[]) {
  const order: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };
  h.sort((a, b) => order[a.suit] - order[b.suit] || rankValue(b.rank) - rankValue(a.rank));
}

// ------------------------------------------------------------------ Bot

/** grobe Einschätzung, wie viele Stiche eine Hand mit diesem Koz macht */
export function estimateTricks(hand: Card[], trump: Suit): number {
  let t = 0;
  for (const s of ['S', 'H', 'D', 'C'] as Suit[]) {
    const cs = hand.filter((c) => c.suit === s).map((c) => rankValue(c.rank)).sort((a, b) => b - a);
    if (s === trump) {
      t += cs.filter((v) => v >= 12).length * 0.9;
      t += Math.max(0, cs.length - 3) * 0.8;
    } else {
      if (cs[0] === 14) t += 0.95;
      if (cs.includes(13) && cs.length >= 2) t += 0.6;
      if (cs.includes(12) && cs.length >= 3) t += 0.25;
      // kurze Farbe = später stechen
      if (cs.length <= 1 && hand.filter((c) => c.suit === trump).length >= 3) t += 0.5;
    }
  }
  return t;
}
export function bestTrump(hand: Card[]): Suit {
  let best: Suit = 'S';
  let v = -1;
  for (const s of ['S', 'H', 'D', 'C'] as Suit[]) {
    const e = estimateTricks(hand, s) + hand.filter((c) => c.suit === s).length * 0.01;
    if (e > v) {
      v = e;
      best = s;
    }
  }
  return best;
}

export function batakBotTurn(g: BatakGame, seat: number, rnd: () => number = Math.random) {
  if (g.current !== seat || g.gameOver || g.phase === 'handOver') return;
  const hand = g.hands[seat];
  if (g.phase === 'bid') {
    let est = estimateTricks(hand, bestTrump(hand));
    if (g.team) est += 2.5; // Partner hilft
    if (g.rules.mode === 'gommeli') est += 1;
    const want = Math.floor(est + rnd() * 0.6);
    const min = g.nextMinBid;
    if (want >= min && min <= g.maxBid) return g.bid(seat, min);
    return g.bid(seat, null);
  }
  if (g.phase === 'bury') {
    // schwächste Karten weg (keine Asse, keine Kozkandidaten)
    const trump = bestTrump(hand);
    const sorted = [...hand].sort((a, b) => (a.suit === trump ? 20 : 0) + rankValue(a.rank) - ((b.suit === trump ? 20 : 0) + rankValue(b.rank)));
    return g.bury(seat, sorted.slice(0, 4).map((c) => c.id));
  }
  if (g.phase === 'trump') return g.chooseTrump(seat, bestTrump(hand));
  const legal = g.legal(seat);
  if (!legal.length) return;
  const trump = g.trump!;
  const val = (c: Card) => rankValue(c.rank) + (c.suit === trump ? 20 : 0);
  const low = (cs: Card[]) => [...cs].sort((a, b) => val(a) - val(b))[0];
  const high = (cs: Card[]) => [...cs].sort((a, b) => val(b) - val(a))[0];
  if (!g.trick.length) {
    // Ausspiel: ein Ass, sonst die niedrigste Karte der längsten Nicht-Koz-Farbe
    const aces = legal.filter((c) => c.rank === 1 && c.suit !== trump);
    if (aces.length) return g.play(seat, aces[0].id);
    const nt = legal.filter((c) => c.suit !== trump);
    return g.play(seat, low(nt.length ? nt : legal).id);
  }
  const winnerNow = g.trickWinner(g.trick);
  const partnerWins = g.team && g.teamOf(winnerNow) === g.teamOf(seat);
  const lastToPlay = g.trick.length === g.seats.length - 1;
  // gewinnende Karten
  const wins = legal.filter((c) => g.trickWinner([...g.trick, { seat, card: c }]) === seat);
  if (partnerWins && (lastToPlay || rankValue(g.trick.find((t) => t.seat === winnerNow)!.card.rank) >= 13)) return g.play(seat, low(legal).id);
  if (wins.length) return g.play(seat, (lastToPlay ? low(wins) : high(wins)).id);
  return g.play(seat, low(legal).id);
}
