// Spielablauf: Tisch mit 2–4 Spielern. Zu viert eşli (Teams gegenüber 0+2, 1+3) oder alle gegen alle.
// Der Server hält diese Klasse; Clients schicken nur Aktionen und bekommen Ansichten.

import { Rng } from './rng.ts';
import { type TableRules, okeySeats, okeyIsTeams } from './rules.ts';
import {
  type OkeyIdentity,
  type Tile,
  createDeck,
  isRealOkey,
  okeyFromIndicator,
  tileValue,
} from './tiles.ts';
import {
  type ValidMeld,
  countPairs,
  isCompleteMelds,
  isCompletePairs,
  meldSum,
  validateMeld,
} from './evaluate.ts';
import {
  type HandResult,
  perisanMultiplier,
  score101Finish,
  scorePerisanFinish,
  scorePerisanIndicator,
  scoreStandardFinish,
  scoreStandardIndicator,
  type Seating,
  sideOf,
  sidesOf,
  zeroDelta,
} from './scoring.ts';

export class GameError extends Error {}

export interface PlayerState {
  hand: Tile[];
  discards: Tile[];
  hasDiscarded: boolean;
  shownIndicator: boolean;
  /** 101 */
  opened: false | 'melds' | 'pairs';
  openedThisTurn: boolean;
  /** 101: Strafpunkte in dieser Hand */
  penalty: number;
  stealsUsed: number;
}

export interface TableMeld {
  owner: number;
  tiles: Tile[];
  kind: 'run' | 'set' | 'pair';
}

export interface SheetRow {
  hand: number;
  teamDelta: number[];
  totals: number[];
  notes: string[];
}

export type Phase = 'draw' | 'discard' | 'handOver' | 'gameOver';

export interface HandState {
  indicator: Tile;
  okey: OkeyIdentity;
  pile: Tile[];
  players: PlayerState[];
  current: number;
  phase: Phase;
  tableMelds: TableMeld[];
  okeyBirBy: number | null;
  okeyBirTile: Tile | null;
  pendingSteal: { seat: number } | null;
  /** Punkte, die während der Hand anfallen (Gösterge, Taş Çalma) */
  runningDelta: number[];
  notes: string[];
  lastResult: HandResult | null;
}

export class OkeyGame {
  readonly rules: TableRules;
  private rng: Rng;
  handNo = 0;
  dealer = 0;
  /** Punkte pro Wertung: Team 0/1 oder (alle gegen alle) pro Platz */
  teamScores: number[];
  sheet: SheetRow[] = [];
  hand!: HandState;
  winnerTeam: number | null = null;
  readonly seating: Seating;
  gameOver = false;

  constructor(rules: TableRules, seed = Date.now()) {
    this.rules = rules;
    this.rng = new Rng(seed);
    this.seating = { seats: okeySeats(rules), team: okeyIsTeams(rules) };
    this.dealer = this.seating.seats[this.seating.seats.length - 1];
    this.teamScores = zeroDelta(this.seating).map(() => (rules.mode === 'standard' ? rules.startPoints : 0));
    this.startHand();
  }

  // ------------------------------------------------------------ Hand-Start

  startHand(): void {
    if (this.gameOver) throw new GameError('Spiel ist vorbei');
    const deck = this.rng.shuffle(createDeck());
    // Gösterge: zufälliger echter Stein
    const indIdx = deck.findIndex((t) => !t.fake);
    const indicator = deck.splice(indIdx, 1)[0];
    const okey = okeyFromIndicator(indicator);
    const big = this.rules.mode === 'okey101';
    const starter = this.nextSeat(this.dealer);
    const players: PlayerState[] = [0, 1, 2, 3].map(() => ({
      hand: [],
      discards: [],
      hasDiscarded: false,
      shownIndicator: false,
      opened: false,
      openedThisTurn: false,
      penalty: 0,
      stealsUsed: 0,
    }));
    for (const seat of this.seating.seats) {
      const n = (big ? 21 : 14) + (seat === starter ? 1 : 0);
      players[seat].hand = deck.splice(0, n);
    }
    this.hand = {
      indicator,
      okey,
      pile: deck,
      players,
      current: starter,
      phase: 'discard',
      tableMelds: [],
      okeyBirBy: null,
      okeyBirTile: null,
      pendingSteal: null,
      runningDelta: zeroDelta(this.seating),
      notes: [],
      lastResult: null,
    };
  }

  nextHand(): void {
    if (this.hand.phase !== 'handOver') throw new GameError('Hand läuft noch');
    this.dealer = this.nextSeat(this.dealer);
    this.startHand();
  }

  // ------------------------------------------------------------ Hilfen

  /** nächster mitspielender Platz (rechts) */
  nextSeat(seat: number): number {
    const a = this.seating.seats;
    for (let i = 1; i <= 4; i++) if (a.includes((seat + i) % 4)) return (seat + i) % 4;
    return seat;
  }
  /** linker Nachbar: von dem man abgeworfene Steine nimmt */
  leftOf(seat: number): number {
    const a = this.seating.seats;
    for (let i = 1; i <= 4; i++) if (a.includes((seat + 4 - i) % 4)) return (seat + 4 - i) % 4;
    return seat;
  }
  /** Wertung (Team oder Platz) */
  sideOf(seat: number): number {
    return sideOf(this.seating, seat);
  }

  private p(seat: number): PlayerState {
    return this.hand.players[seat];
  }

  private requireTurn(seat: number, phase: Phase): void {
    if (this.hand.phase === 'handOver' || this.hand.phase === 'gameOver') throw new GameError('Hand ist vorbei');
    if (this.hand.current !== seat) throw new GameError('Nicht dein Zug');
    if (this.hand.phase !== phase) throw new GameError(phase === 'draw' ? 'Erst ziehen' : 'Erst abwerfen');
  }

  private takeFromHand(seat: number, tileId: number): Tile {
    const hand = this.p(seat).hand;
    const i = hand.findIndex((t) => t.id === tileId);
    if (i < 0) throw new GameError('Stein nicht auf der Hand');
    return hand.splice(i, 1)[0];
  }

  /** Oberster Abwurf des linken Nachbarn (der Spieler vor dir). */
  topDiscardFor(seat: number): Tile | null {
    const d = this.p(this.leftOf(seat)).discards;
    return d.length ? d[d.length - 1] : null;
  }

  private advance(): void {
    const h = this.hand;
    this.p(h.current).openedThisTurn = false;
    if (h.pile.length === 0) {
      this.endHand({ teamDelta: zeroDelta(this.seating), note: 'Ortaya bitti' });
      return;
    }
    h.current = this.nextSeat(h.current);
    h.phase = 'draw';
  }

  // ------------------------------------------------------------ Aktionen

  drawPile(seat: number): Tile {
    this.requireTurn(seat, 'draw');
    const t = this.hand.pile.pop()!;
    this.p(seat).hand.push(t);
    this.hand.phase = 'discard';
    return t;
  }

  drawDiscard(seat: number): Tile {
    this.requireTurn(seat, 'draw');
    if (this.hand.okeyBirBy !== null) throw new GameError('Nach Okey bir nur aus der Mitte ziehen');
    const left = this.p(this.leftOf(seat));
    const t = left.discards.pop();
    if (!t) throw new GameError('Kein Abwurf da');
    this.p(seat).hand.push(t);
    this.hand.phase = 'discard';
    return t;
  }

  discard(seat: number, tileId: number): void {
    this.requireTurn(seat, 'discard');
    const pl = this.p(seat);
    if (this.rules.mode === 'okey101' && pl.hand.length === 1) {
      this.finish(seat, tileId);
      return;
    }
    if (this.rules.mode !== 'okey101' && pl.hand.length !== 15) throw new GameError('Falsche Steinanzahl');
    const tile = pl.hand.find((t) => t.id === tileId);
    if (!tile) throw new GameError('Stein nicht auf der Hand');
    if (this.rules.mode === 'okey101') {
      if (isRealOkey(tile, this.hand.okey)) {
        pl.penalty += 101;
        this.hand.notes.push(`Okey atıldı (Platz ${seat + 1}) +101`);
      } else if (this.isLayable(tile)) {
        pl.penalty += 101;
        this.hand.notes.push(`İşlek taş (Platz ${seat + 1}) +101`);
      }
    }
    this.takeFromHand(seat, tileId);
    pl.discards.push(tile);
    pl.hasDiscarded = true;
    if (this.hand.pendingSteal?.seat === seat) this.hand.pendingSteal = null;
    this.advance();
  }

  /** Beenden: letzten Stein abwerfen, Rest muss komplett sein. */
  finish(seat: number, tileId: number): HandResult {
    this.requireTurn(seat, 'discard');
    const h = this.hand;
    const pl = this.p(seat);
    const tile = pl.hand.find((t) => t.id === tileId);
    if (!tile) throw new GameError('Stein nicht auf der Hand');
    const rest = pl.hand.filter((t) => t.id !== tileId);
    const withOkey = isRealOkey(tile, h.okey);

    let result: HandResult;
    if (this.rules.mode === 'okey101') {
      if (rest.length !== 0) throw new GameError('Noch Steine auf der Hand');
      if (!pl.opened) throw new GameError('Nicht geöffnet');
      const elden = pl.openedThisTurn;
      result = score101Finish(
        this.rules,
        h.okey,
        { winner: seat, withOkey, withPairs: pl.opened === 'pairs', winnerDidOkeyBir: false, elden },
        h.players.map((p, i) => ({ hand: i === seat ? [] : p.hand, opened: p.opened, penalty: p.penalty })),
        this.seating,
      );
    } else {
      if (rest.length !== 14) throw new GameError('Falsche Steinanzahl');
      const melds = isCompleteMelds(rest, h.okey);
      const pairs = !melds && isCompletePairs(rest, h.okey, h.indicator, this.rules.indicatorPairsAnything);
      if (!melds && !pairs) throw new GameError('Hand ist nicht fertig');
      const info = { winner: seat, withOkey, withPairs: pairs, winnerDidOkeyBir: h.okeyBirBy === seat };
      result =
        this.rules.mode === 'standard'
          ? scoreStandardFinish(this.rules, info, this.seating)
          : scorePerisanFinish(
              this.rules,
              h.okey,
              h.indicator,
              info,
              h.players.map((p) => p.hand),
              h.okeyBirBy,
              this.seating,
            );
    }
    this.takeFromHand(seat, tileId);
    pl.discards.push(tile);
    result.finisher = seat;
    result.withOkey = withOkey;
    result.withPairs = this.rules.mode === 'okey101' ? pl.opened === 'pairs' : !isCompleteMelds(rest, h.okey);
    this.endHand(result);
    return result;
  }

  /** Gösterge zeigen: nur vor dem ersten eigenen Abwurf. */
  showIndicator(seat: number): void {
    const h = this.hand;
    if (h.current !== seat || h.phase === 'handOver') throw new GameError('Nicht dein Zug');
    const pl = this.p(seat);
    if (pl.hasDiscarded) throw new GameError('Nur vor dem ersten Abwurf');
    if (pl.shownIndicator) throw new GameError('Schon gezeigt');
    const has = pl.hand.some((t) => !t.fake && t.color === h.indicator.color && t.value === h.indicator.value);
    if (!has) throw new GameError('Du hast die Gösterge nicht');
    pl.shownIndicator = true;
    if (this.rules.mode === 'standard') this.addRunning(scoreStandardIndicator(this.rules, seat, this.seating));
    else if (this.rules.mode === 'perisan') this.addRunning(scorePerisanIndicator(this.rules, h.okey, seat, this.seating));
    else {
      pl.penalty -= 101;
      h.notes.push(`Gösterge (Platz ${seat + 1}) −101`);
    }
  }

  /** Perişan: Okey auf die Gösterge legen. Zählt als Abwurf dieses Zuges. */
  okeyBir(seat: number, tileId: number): void {
    if (this.rules.mode !== 'perisan') throw new GameError('Nur in Perişan');
    this.requireTurn(seat, 'discard');
    const h = this.hand;
    if (h.okeyBirBy !== null) throw new GameError('Okey bir wurde schon gemacht');
    const tile = this.p(seat).hand.find((t) => t.id === tileId);
    if (!tile || !isRealOkey(tile, h.okey)) throw new GameError('Das ist kein Okey');
    this.takeFromHand(seat, tileId);
    h.okeyBirBy = seat;
    h.okeyBirTile = tile;
    this.p(seat).hasDiscarded = true;
    h.notes.push(`Okey bir (Platz ${seat + 1})`);
    this.advance();
  }

  // ------------------------------------------------------------ 101: Açmak / İşlemek

  /** Açmak: Reihen/Gruppen mit Summe ≥ 101, oder genug Paare. */
  open101(seat: number, melds: number[][]): void {
    if (this.rules.mode !== 'okey101') throw new GameError('Nur in 101');
    this.requireTurn(seat, 'discard');
    const h = this.hand;
    const pl = this.p(seat);
    const ids = melds.flat();
    if (pl.opened) {
      // Nach dem Açmak dürfen weitere Kombinationen frei ausgelegt werden (ohne Mindestsumme)
      this.layNewMelds(seat, melds);
      return;
    }
    if (new Set(ids).size !== ids.length) throw new GameError('Stein doppelt');
    const tiles = melds.map((m) =>
      m.map((id) => {
        const t = pl.hand.find((x) => x.id === id);
        if (!t) throw new GameError('Stein nicht auf der Hand');
        return t;
      }),
    );
    if (pl.hand.length - ids.length < 1) throw new GameError('Ein Stein muss zum Abwerfen bleiben');

    const allPairs = tiles.every((m) => m.length === 2);
    if (allPairs) {
      for (const m of tiles) {
        const { pairs } = countPairs(m, h.okey, null, false);
        if (pairs !== 1) throw new GameError('Kein gültiges Paar');
      }
      if (tiles.length < this.rules.pairOpenCount) throw new GameError(`Mindestens ${this.rules.pairOpenCount} Paare`);
      tiles.forEach((m) => h.tableMelds.push({ owner: seat, tiles: m, kind: 'pair' }));
      pl.opened = 'pairs';
    } else {
      let sum = 0;
      const valid: ValidMeld[] = tiles.map((m) => {
        const v = validateMeld(m, h.okey);
        if (!v) throw new GameError('Ungültige Kombination');
        sum += meldSum(v);
        return v;
      });
      if (sum < this.rules.openThreshold) throw new GameError(`Summe ${sum} < ${this.rules.openThreshold}`);
      tiles.forEach((m, i) => h.tableMelds.push({ owner: seat, tiles: m, kind: valid[i].kind }));
      pl.opened = 'melds';
    }
    for (const id of ids) this.takeFromHand(seat, id);
    pl.openedThisTurn = true;
    h.notes.push(`Açtı (Platz ${seat + 1})`);
  }

  private layNewMelds(seat: number, melds: number[][]): void {
    const pl = this.p(seat);
    const h = this.hand;
    const ids = melds.flat();
    if (new Set(ids).size !== ids.length) throw new GameError('Stein doppelt');
    if (pl.hand.length - ids.length < 1) throw new GameError('Ein Stein muss zum Abwerfen bleiben');
    const tiles = melds.map((m) =>
      m.map((id) => {
        const t = pl.hand.find((x) => x.id === id);
        if (!t) throw new GameError('Stein nicht auf der Hand');
        return t;
      }),
    );
    const kinds = tiles.map((m) => {
      if (pl.opened === 'pairs') {
        if (m.length !== 2 || countPairs(m, h.okey, null, false).pairs !== 1) throw new GameError('Kein gültiges Paar');
        return 'pair' as const;
      }
      const v = validateMeld(m, h.okey);
      if (!v) throw new GameError('Ungültige Kombination');
      return v.kind;
    });
    tiles.forEach((m, i) => h.tableMelds.push({ owner: seat, tiles: m, kind: kinds[i] }));
    for (const id of ids) this.takeFromHand(seat, id);
  }

  /** İşlemek: Steine an eine Kombination auf dem Tisch anlegen. */
  layoff(seat: number, meldIndex: number, tileIds: number[]): void {
    if (this.rules.mode !== 'okey101') throw new GameError('Nur in 101');
    this.requireTurn(seat, 'discard');
    const pl = this.p(seat);
    if (!pl.opened) throw new GameError('Erst öffnen');
    const meld = this.hand.tableMelds[meldIndex];
    if (!meld || meld.kind === 'pair') throw new GameError('Hier kann nicht angelegt werden');
    if (pl.hand.length - tileIds.length < 1) throw new GameError('Ein Stein muss zum Abwerfen bleiben');
    const add = tileIds.map((id) => {
      const t = pl.hand.find((x) => x.id === id);
      if (!t) throw new GameError('Stein nicht auf der Hand');
      return t;
    });
    if (!validateMeld([...meld.tiles, ...add], this.hand.okey)) throw new GameError('Passt nicht');
    for (const id of tileIds) this.takeFromHand(seat, id);
    meld.tiles.push(...add);
  }

  /** Kann der Stein an irgendeine Tischkombination angelegt werden? (işlek) */
  isLayable(tile: Tile): boolean {
    return this.hand.tableMelds.some(
      (m) => m.kind !== 'pair' && validateMeld([...m.tiles, tile], this.hand.okey) !== null,
    );
  }

  // ------------------------------------------------------------ Taş Çalma

  /** Stein aus der Mitte klauen, dafür einen eigenen zurücklegen. */
  steal(seat: number, giveBackTileId: number): Tile {
    if (!this.rules.stealing.enabled) throw new GameError('Taş Çalma ist aus');
    this.requireTurn(seat, 'discard');
    const pl = this.p(seat);
    if (pl.stealsUsed >= this.rules.stealing.maxPerHand) throw new GameError('Keine Versuche mehr');
    const h = this.hand;
    if (h.pile.length === 0) throw new GameError('Mitte ist leer');
    const give = this.takeFromHand(seat, giveBackTileId);
    const taken = h.pile.pop()!;
    pl.hand.push(taken);
    h.pile.splice(this.rng.int(h.pile.length + 1), 0, give);
    pl.stealsUsed++;
    h.pendingSteal = { seat };
    return taken;
  }

  /** „Hırsız!“ — jemand beschuldigt einen Spieler. */
  accuse(accuser: number, target: number): boolean {
    if (!this.rules.stealing.enabled) throw new GameError('Taş Çalma ist aus');
    const h = this.hand;
    if (accuser === target) throw new GameError('Ungültig');
    if (!this.seating.seats.includes(target)) throw new GameError('Ungültig');
    const caught = h.pendingSteal?.seat === target;
    const mode = this.rules.mode;
    const delta = zeroDelta(this.seating);
    if (caught) {
      h.pendingSteal = null;
      if (mode === 'okey101') this.p(target).penalty += 101;
      else if (mode === 'standard') delta[this.sideOf(target)] = -2;
      else delta[this.sideOf(target)] = perisanMultiplier(this.rules, h.okey) * 10;
      h.notes.push(`Hırsız yakalandı (Platz ${target + 1})`);
    } else {
      if (mode === 'okey101') this.p(accuser).penalty += 50;
      else if (mode === 'standard') delta[this.sideOf(accuser)] = -1;
      else delta[this.sideOf(accuser)] = perisanMultiplier(this.rules, h.okey) * 5;
      h.notes.push(`Haksız suçlama (Platz ${accuser + 1})`);
    }
    if (mode !== 'okey101') this.addRunning({ teamDelta: delta, note: '' });
    return caught;
  }

  // ------------------------------------------------------------ Hand-Ende

  private addRunning(r: HandResult): void {
    r.teamDelta.forEach((d, i) => (this.hand.runningDelta[i] += d));
    if (r.note) this.hand.notes.push(r.note);
  }

  private endHand(result: HandResult): void {
    const h = this.hand;
    // 101: Mitte leer ohne Gewinner → jeder zählt seine Hand (ohne Verdopplung) + Strafen
    if (this.rules.mode === 'okey101' && result.note === 'Ortaya bitti') {
      h.players.forEach((p, seat) => {
        if (!this.seating.seats.includes(seat)) return;
        let pts = 202;
        if (p.opened) {
          pts = p.hand.reduce((s, t) => s + (isRealOkey(t, h.okey) ? 101 : tileValue(t, h.okey)), 0);
          if (p.opened === 'pairs') pts *= 2;
        }
        result.teamDelta[this.sideOf(seat)] += pts + p.penalty;
      });
    }
    const delta = this.teamScores.map((_, i) => (result.teamDelta[i] ?? 0) + (h.runningDelta[i] ?? 0));
    this.teamScores = this.teamScores.map((v, i) => v + delta[i]);
    this.handNo++;
    this.sheet.push({
      hand: this.handNo,
      teamDelta: delta,
      totals: [...this.teamScores],
      notes: [...h.notes, result.note],
    });
    h.lastResult = result;
    h.phase = 'handOver';
    this.checkGameOver();
  }

  private checkGameOver(): void {
    const sides = sidesOf(this.seating);
    const sc = (i: number) => this.teamScores[i];
    // bester Wert gewinnt (Standard: höchster, sonst niedrigster); Gleichstand → niemand
    const best = (high: boolean) => {
      const v = sides.map(sc);
      const top = high ? Math.max(...v) : Math.min(...v);
      const w = sides.filter((i) => sc(i) === top);
      return w.length === 1 ? w[0] : null;
    };
    if (this.rules.mode === 'standard') {
      if (sides.some((i) => sc(i) <= 0)) {
        this.gameOver = true;
        this.winnerTeam = best(true);
      }
    } else if (this.handNo >= this.rules.handCount) {
      this.gameOver = true;
      this.winnerTeam = best(false);
    }
    if (this.gameOver) this.hand.phase = 'gameOver';
  }

  // ------------------------------------------------------------ Ansicht für einen Platz

  /** Was ein Spieler sehen darf: eigene Steine, sonst nur öffentliche Infos. */
  viewFor(seat: number) {
    const h = this.hand;
    return {
      mode: this.rules.mode,
      seat,
      handNo: this.handNo,
      phase: h.phase,
      current: h.current,
      indicator: h.indicator,
      okeyBirTile: h.okeyBirTile,
      pileCount: h.pile.length,
      myHand: h.players[seat].hand,
      seats: this.seating.seats,
      team: this.seating.team,
      teamOfSeat: [0, 1, 2, 3].map((s) => this.sideOf(s)),
      leftOf: [0, 1, 2, 3].map((s) => this.leftOf(s)),
      players: h.players.map((p, i) => ({
        seat: i,
        team: this.sideOf(i),
        tileCount: p.hand.length,
        discards: p.discards,
        opened: p.opened,
      })),
      tableMelds: h.tableMelds,
      teamScores: this.teamScores,
      sheet: this.sheet,
      gameOver: this.gameOver,
      winnerTeam: this.winnerTeam,
      // am Hand-Ende werden alle Hände aufgedeckt
      revealedHands: h.phase === 'handOver' || h.phase === 'gameOver' ? h.players.map((p) => p.hand) : null,
    };
  }

  /** Punktwert eines Steins in dieser Hand (für UI). */
  valueOf(tile: Tile): number {
    return tileValue(tile, this.hand.okey);
  }
}
