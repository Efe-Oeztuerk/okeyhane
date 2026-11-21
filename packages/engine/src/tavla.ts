// Tavla (türkisches Backgammon): 2 Spieler (Plätze 0 + 2), je 15 Pullar.
// Spieler 0 (Beyaz, Platz 0) zieht von Punkt 23 → 0 (Heimfeld 0..5),
// Spieler 1 (Siyah, Platz 2) zieht von 0 → 23 (Heimfeld 18..23).
// Brett: board[i] > 0 = Pullar von Spieler 0, < 0 = Pullar von Spieler 1.
// Ein Spiel gewinnt 1 Punkt, „Mars“ (Gegner hat noch keinen Pul rausgespielt) 2 Punkte.
// Gespielt wird bis zur Zielpunktzahl (z. B. 5).

import { Rng } from './rng.ts';

export class TavlaError extends Error {}

export interface TavlaRules {
  /** Punkte bis zum Sieg (Maç) */
  target: number;
  /** Mars zählt doppelt (Standard: ja) */
  mars?: boolean;
}

/** Herkunft: Punkt 0..23 oder 'bar' (geschlagen); Ziel: Punkt oder 'off' (rausgespielt) */
export type TavlaFrom = number | 'bar';
export type TavlaTo = number | 'off';
export interface TavlaStep {
  from: TavlaFrom;
  to: TavlaTo;
  die: number;
}

export type TavlaEvent =
  | { seq: number; kind: 'opening'; seat: number; dice: [number, number] }
  | { seq: number; kind: 'roll'; seat: number; dice: number[] }
  | { seq: number; kind: 'move'; seat: number; from: TavlaFrom; to: TavlaTo; hit: boolean }
  | { seq: number; kind: 'undo'; seat: number; from: TavlaFrom; to: TavlaTo; hit: boolean }
  | { seq: number; kind: 'pass'; seat: number; dice: number[] }
  | { seq: number; kind: 'handEnd'; seat: number; points: number; mars: boolean; before?: TavlaEvent | null };

type DistOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type TavlaEventInput = DistOmit<TavlaEvent, 'seq'>;

export interface TavlaPos {
  board: number[];
  bar: [number, number];
  off: [number, number];
}

export interface TavlaHandResult {
  winner: number; // Platz
  points: number;
  mars: boolean;
}

const clone = (p: TavlaPos): TavlaPos => ({ board: p.board.slice(), bar: [p.bar[0], p.bar[1]], off: [p.off[0], p.off[1]] });
const sign = (pl: number) => (pl === 0 ? 1 : -1);
const own = (v: number, pl: number) => (pl === 0 ? v > 0 : v < 0);
const cnt = (v: number) => Math.abs(v);

function startPos(): TavlaPos {
  const b = new Array(24).fill(0);
  b[23] = 2;
  b[12] = 5;
  b[7] = 3;
  b[5] = 5;
  b[0] = -2;
  b[11] = -5;
  b[16] = -3;
  b[18] = -5;
  return { board: b, bar: [0, 0], off: [0, 0] };
}

/** Entfernung bis zum Rausspielen (1..24) für einen Pul auf Punkt i */
const distHome = (i: number, pl: number) => (pl === 0 ? i + 1 : 24 - i);
const inHome = (i: number, pl: number) => (pl === 0 ? i <= 5 : i >= 18);

function allHome(p: TavlaPos, pl: number): boolean {
  if (p.bar[pl]) return false;
  for (let i = 0; i < 24; i++) if (own(p.board[i], pl) && !inHome(i, pl)) return false;
  return true;
}

/** ein einzelner Schritt mit Würfel d – oder null, wenn nicht erlaubt */
function stepTo(p: TavlaPos, pl: number, from: TavlaFrom, d: number): TavlaTo | null {
  if (p.bar[pl] && from !== 'bar') return null;
  if (from === 'bar') {
    if (!p.bar[pl]) return null;
    const to = pl === 0 ? 24 - d : d - 1;
    const v = p.board[to];
    if (!own(v, pl) && cnt(v) >= 2) return null;
    return to;
  }
  if (!own(p.board[from], pl)) return null;
  const to = from + (pl === 0 ? -d : d);
  if (to < 0 || to > 23) {
    // Rausspielen
    if (!allHome(p, pl)) return null;
    const dist = distHome(from, pl);
    if (dist === d) return 'off';
    if (d < dist) return null;
    // größerer Würfel: nur wenn kein Pul weiter hinten steht
    for (let i = 0; i < 24; i++) if (own(p.board[i], pl) && inHome(i, pl) && distHome(i, pl) > dist) return null;
    return 'off';
  }
  const v = p.board[to];
  if (!own(v, pl) && cnt(v) >= 2) return null;
  return to;
}

function apply(p: TavlaPos, pl: number, s: TavlaStep): boolean {
  const sg = sign(pl);
  if (s.from === 'bar') p.bar[pl]--;
  else p.board[s.from] -= sg;
  if (s.to === 'off') {
    p.off[pl]++;
    return false;
  }
  const v = p.board[s.to];
  let hit = false;
  if (v !== 0 && !own(v, pl)) {
    // einzelner gegnerischer Pul → geschlagen
    p.board[s.to] = 0;
    p.bar[1 - pl]++;
    hit = true;
  }
  p.board[s.to] += sg;
  return hit;
}

function singleSteps(p: TavlaPos, pl: number, d: number): TavlaStep[] {
  const out: TavlaStep[] = [];
  if (p.bar[pl]) {
    const to = stepTo(p, pl, 'bar', d);
    if (to !== null) out.push({ from: 'bar', to, die: d });
    return out;
  }
  for (let i = 0; i < 24; i++) {
    if (!own(p.board[i], pl)) continue;
    const to = stepTo(p, pl, i, d);
    if (to !== null) out.push({ from: i, to, die: d });
  }
  return out;
}

const uniqDice = (dice: number[]) => [...new Set(dice)];
const without = (dice: number[], d: number) => {
  const i = dice.indexOf(d);
  return dice.slice(0, i).concat(dice.slice(i + 1));
};
const keyOf = (p: TavlaPos) => p.board.join(',') + '|' + p.bar.join(',') + '|' + p.off.join(',');

/** alle vollständigen Zugfolgen (für Bot) – doppelte Endstellungen zusammengefasst */
export function tavlaSequences(p0: TavlaPos, pl: number, dice: number[]): { steps: TavlaStep[]; pos: TavlaPos }[] {
  const res = new Map<string, { steps: TavlaStep[]; pos: TavlaPos }>();
  let best = 0;
  const rec = (p: TavlaPos, left: number[], steps: TavlaStep[]) => {
    let moved = false;
    for (const d of uniqDice(left)) {
      for (const s of singleSteps(p, pl, d)) {
        moved = true;
        const q = clone(p);
        apply(q, pl, s);
        rec(q, without(left, d), [...steps, s]);
      }
    }
    if (!moved) {
      if (steps.length < best) return;
      if (steps.length > best) {
        best = steps.length;
        res.clear();
      }
      // pro erstem Schritt + Endstellung eine Folge behalten (sonst fehlen z. B. „erst die 3“-Wege)
      const f = steps[0];
      const k = keyOf(p) + (f ? `#${f.from}>${f.to}>${f.die}` : '');
      if (!res.has(k)) res.set(k, { steps, pos: p });
    }
  };
  rec(p0, dice, []);
  let list = [...res.values()];
  // nur ein Würfel spielbar (verschiedene Würfel): der größere muss gespielt werden, wenn möglich
  if (best === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const hi = Math.max(...dice);
    if (list.some((x) => x.steps[0].die === hi)) list = list.filter((x) => x.steps[0].die === hi);
  }
  return list;
}

export class TavlaGame {
  readonly kind = 'tavla' as const;
  readonly rules: Required<TavlaRules>;
  readonly seats = [0, 2];
  private rng: Rng;
  pos: TavlaPos = startPos();
  phase: 'roll' | 'move' | 'handOver' = 'roll';
  current = 0;
  /** noch übrige Würfel dieses Zugs */
  dice: number[] = [];
  /** der Wurf, wie er gefallen ist (für die Anzeige) */
  rolled: number[] = [];
  /** erlaubte nächste Schritte */
  steps: TavlaStep[] = [];
  /** wohin ein Pul mit einem oder mehreren Würfeln kommen kann (Weg = einzelne Schritte) */
  reach: { from: TavlaFrom; to: TavlaTo; path: TavlaStep[] }[] = [];
  private turnStack: { pos: TavlaPos; dice: number[]; step: TavlaStep; hit: boolean }[] = [];
  scores: [number, number] = [0, 0];
  handNo = 0;
  gameOver = false;
  winnerTeam: number | null = null;
  lastEvent: TavlaEvent | null = null;
  lastResult: TavlaHandResult | null = null;
  history: { points: [number, number]; result: TavlaHandResult }[] = [];
  private seq = 0;

  constructor(rules: TavlaRules, seed = Date.now()) {
    this.rules = { target: Math.max(1, Math.min(31, Math.round(rules.target) || 5)), mars: rules.mars !== false };
    this.rng = new Rng(seed);
    this.startHand();
  }

  get hand() {
    return { phase: this.phase, current: this.current };
  }
  playerOf(seat: number) {
    return seat === 0 ? 0 : 1;
  }
  teamOf(seat: number) {
    return this.playerOf(seat);
  }
  seatOf(pl: number) {
    return pl === 0 ? 0 : 2;
  }
  private other(seat: number) {
    return seat === 0 ? 2 : 0;
  }
  private event(e: TavlaEventInput) {
    this.lastEvent = { ...(e as any), seq: ++this.seq };
  }
  private die() {
    return 1 + this.rng.int(6);
  }

  /** neues Spiel: Eröffnungswurf – wer höher würfelt, beginnt und zieht mit genau diesen beiden Würfeln */
  private startHand() {
    this.pos = startPos();
    this.turnStack = [];
    let a = 0;
    let b = 0;
    while (a === b) {
      a = this.die();
      b = this.die();
    }
    this.current = a > b ? 0 : 2;
    this.rolled = [a, b];
    this.dice = [a, b];
    this.phase = 'move';
    this.event({ kind: 'opening', seat: this.current, dice: [a, b] });
    this.computeSteps();
    if (!this.steps.length) this.endTurn(true);
  }

  private computeSteps() {
    const pl = this.playerOf(this.current);
    const seqs = tavlaSequences(this.pos, pl, this.dice);
    // Ziele pro Pul: derselbe Pul zieht mit 1, 2 … Würfeln weiter
    const reach = new Map<string, { from: TavlaFrom; to: TavlaTo; path: TavlaStep[] }>();
    for (const s of seqs) {
      for (let k = 1; k <= s.steps.length; k++) {
        const path = s.steps.slice(0, k);
        if (k > 1 && path[k - 1].from !== path[k - 2].to) break;
        const key = `${path[0].from}>${path[k - 1].to}`;
        const old = reach.get(key);
        if (!old || old.path.length > path.length) reach.set(key, { from: path[0].from, to: path[k - 1].to, path });
      }
    }
    const seen = new Set<string>();
    this.steps = [];
    for (const s of seqs) {
      const f = s.steps[0];
      if (!f) continue;
      const k = `${f.from}>${f.to}>${f.die}`;
      if (seen.has(k)) continue;
      seen.add(k);
      this.steps.push(f);
    }
    // jeder erlaubte erste Schritt ist auch ein Ziel (gleiche Endstellungen wurden oben zusammengefasst)
    for (const f of this.steps) {
      const key = `${f.from}>${f.to}`;
      const old = reach.get(key);
      if (!old || old.path.length > 1) reach.set(key, { from: f.from, to: f.to, path: [f] });
    }
    this.reach = [...reach.values()];
  }

  private check(seat: number) {
    if (this.gameOver || this.phase === 'handOver') throw new TavlaError('Spiel ist vorbei');
    if (seat !== this.current) throw new TavlaError('Nicht dran');
  }

  roll(seat: number) {
    this.check(seat);
    if (this.phase !== 'roll') throw new TavlaError('Erst ziehen');
    const a = this.die();
    const b = this.die();
    this.rolled = [a, b];
    this.dice = a === b ? [a, a, a, a] : [a, b];
    this.turnStack = [];
    this.phase = 'move';
    this.event({ kind: 'roll', seat, dice: this.rolled });
    this.computeSteps();
    if (!this.steps.length) this.endTurn(true);
  }

  /** einen Pul ziehen; die = welcher Würfel (optional – sonst passend gewählt) */
  move(seat: number, from: TavlaFrom, to: TavlaTo, die?: number) {
    this.check(seat);
    if (this.phase !== 'move') throw new TavlaError('Erst würfeln');
    const cands = this.steps.filter((s) => s.from === from && s.to === to && (die === undefined || s.die === die));
    if (!cands.length) throw new TavlaError('Dieser Zug geht nicht');
    // bei mehreren passenden Würfeln (Rausspielen) den kleinsten nehmen
    const step = cands.sort((x, y) => x.die - y.die)[0];
    const pl = this.playerOf(seat);
    const before = clone(this.pos);
    const dice = this.dice.slice();
    const hit = apply(this.pos, pl, step);
    this.dice = without(this.dice, step.die);
    this.turnStack.push({ pos: before, dice, step, hit });
    this.event({ kind: 'move', seat, from: step.from, to: step.to, hit });
    if (this.pos.off[pl] === 15) return this.endHand(seat);
    this.computeSteps();
    if (!this.dice.length || !this.steps.length) this.endTurn(false);
  }

  /** letzten Zug dieses Wurfs zurücknehmen (solange der Wurf noch nicht fertig ist) */
  undo(seat: number) {
    this.check(seat);
    const last = this.turnStack.pop();
    if (!last || this.phase !== 'move') throw new TavlaError('Nichts zum Zurücknehmen');
    this.pos = last.pos;
    this.dice = last.dice;
    this.event({ kind: 'undo', seat, from: last.step.from, to: last.step.to, hit: last.hit });
    this.computeSteps();
  }

  get canUndo() {
    return this.phase === 'move' && this.turnStack.length > 0;
  }

  private endTurn(pass: boolean) {
    if (pass) this.event({ kind: 'pass', seat: this.current, dice: this.rolled });
    this.current = this.other(this.current);
    this.dice = [];
    this.steps = [];
    this.reach = [];
    this.turnStack = [];
    this.phase = 'roll';
  }

  private endHand(seat: number) {
    const pl = this.playerOf(seat);
    const mars = this.rules.mars && this.pos.off[1 - pl] === 0;
    const points = mars ? 2 : 1;
    const result: TavlaHandResult = { winner: seat, points, mars };
    this.lastResult = result;
    const add: [number, number] = [0, 0];
    add[pl] = points;
    this.scores = [this.scores[0] + add[0], this.scores[1] + add[1]];
    this.history.push({ points: add, result });
    this.phase = 'handOver';
    this.dice = [];
    this.steps = [];
    this.reach = [];
    this.turnStack = [];
    const before = this.lastEvent && this.lastEvent.kind === 'move' ? this.lastEvent : null;
    this.event({ kind: 'handEnd', seat, points, mars, before });
    if (this.scores[pl] >= this.rules.target) {
      this.gameOver = true;
      this.winnerTeam = pl;
    }
  }

  nextHand() {
    if (this.gameOver || this.phase !== 'handOver') return;
    this.handNo++;
    this.startHand();
  }

  pips(pl: number) {
    let s = this.pos.bar[pl] * 25;
    for (let i = 0; i < 24; i++) if (own(this.pos.board[i], pl)) s += cnt(this.pos.board[i]) * distHome(i, pl);
    return s;
  }

  viewFor(seat: number) {
    return {
      kind: 'tavla' as const,
      seat,
      seats: this.seats,
      current: this.current,
      phase: this.gameOver ? ('gameOver' as const) : this.phase,
      handNo: this.handNo,
      board: this.pos.board,
      bar: this.pos.bar,
      off: this.pos.off,
      dice: this.dice,
      rolled: this.rolled,
      steps: this.steps,
      reach: this.reach,
      canUndo: this.canUndo,
      pips: [this.pips(0), this.pips(1)],
      scores: this.scores,
      teamScores: this.scores,
      target: this.rules.target,
      mars: this.rules.mars,
      lastEvent: this.lastEvent,
      lastResult: this.lastResult,
      history: this.history,
      gameOver: this.gameOver,
      winnerTeam: this.winnerTeam,
      myHand: [],
    };
  }
}

// ------------------------------------------------------------------ Bot

function evaluate(p: TavlaPos, pl: number): number {
  const op = 1 - pl;
  const pip = (who: number) => {
    let s = p.bar[who] * 25;
    for (let i = 0; i < 24; i++) if (own(p.board[i], who)) s += cnt(p.board[i]) * distHome(i, who);
    return s;
  };
  let score = pip(op) - pip(pl);
  score += p.off[pl] * 8 + p.bar[op] * 10;
  // gegnerische Pullar, die noch „hinter“ einem stehen (können einen Einzelnen treffen)
  const oppBehind = (i: number) => {
    let n = p.bar[op] ? 1 : 0;
    for (let k = 0; k < 24; k++) {
      if (!own(p.board[k], op)) continue;
      const d = op === 0 ? k - i : i - k; // Gegner zieht in seine Richtung
      if (d >= 1 && d <= 12) n++;
    }
    return n;
  };
  // kein Kontakt mehr → nur noch Rennen
  let maxP0 = -1;
  let minP1 = 24;
  for (let i = 0; i < 24; i++) {
    if (p.board[i] > 0) maxP0 = Math.max(maxP0, i);
    if (p.board[i] < 0) minP1 = Math.min(minP1, i);
  }
  const racing = !p.bar[0] && !p.bar[1] && maxP0 < minP1;
  if (racing) return score + p.off[pl] * 4;
  let prime = 0;
  for (let i = 0; i < 24; i++) {
    const v = p.board[i];
    if (!own(v, pl)) {
      prime = 0;
      continue;
    }
    if (cnt(v) >= 2) {
      score += inHome(i, pl) ? 7 : 4;
      prime++;
      if (prime >= 3) score += prime * 2;
    } else {
      prime = 0;
      const risk = oppBehind(i);
      if (risk) score -= 5 + risk * 1.5 + (pl === 0 ? 23 - i : i) * 0.25;
    }
    if (cnt(v) > 5) score -= (cnt(v) - 5) * 1.5;
  }
  return score;
}

/** ein Schritt für einen Bot (würfeln oder den nächsten Pul der besten Zugfolge ziehen) */
export function tavlaBotTurn(g: TavlaGame, seat: number, rnd: () => number = Math.random) {
  if (g.current !== seat || g.gameOver || g.phase === 'handOver') return;
  if (g.phase === 'roll') return g.roll(seat);
  const pl = g.playerOf(seat);
  const seqs = tavlaSequences(g.pos, pl, g.dice);
  if (!seqs.length || !seqs[0].steps.length) return;
  let best = seqs[0];
  let bestV = -Infinity;
  for (const s of seqs) {
    const v = evaluate(s.pos, pl) + rnd() * 0.5;
    if (v > bestV) {
      bestV = v;
      best = s;
    }
  }
  const f = best.steps[0];
  g.move(seat, f.from, f.to, f.die);
}
