import { describe, expect, test } from 'vitest';
import { TavlaGame, tavlaBotTurn, tavlaSequences } from '../src/tavla.ts';

const empty = () => ({ board: new Array(24).fill(0), bar: [0, 0] as [number, number], off: [0, 0] as [number, number] });

function sumCheckers(g: TavlaGame, pl: number) {
  let n = g.pos.bar[pl] + g.pos.off[pl];
  for (const v of g.pos.board) if (pl === 0 ? v > 0 : v < 0) n += Math.abs(v);
  return n;
}

describe('Tavla', () => {
  test('Aufstellung und Eröffnungswurf', () => {
    const g = new TavlaGame({ target: 5 }, 7);
    expect(sumCheckers(g, 0)).toBe(15);
    expect(sumCheckers(g, 1)).toBe(15);
    expect(g.phase).toBe('move');
    expect(g.rolled[0]).not.toBe(g.rolled[1]);
    expect(g.lastEvent!.kind).toBe('opening');
    expect(g.steps.length).toBeGreaterThan(0);
  });

  test('Pasch = vier Züge', () => {
    const p = empty();
    p.board[23] = 4;
    p.board[0] = -1;
    const seqs = tavlaSequences(p, 0, [3, 3, 3, 3]);
    expect(seqs[0].steps.length).toBe(4);
  });

  test('geschlagener Pul muss zuerst wieder rein', () => {
    const g = new TavlaGame({ target: 5 }, 1);
    g.pos = empty();
    g.pos.bar[0] = 1;
    g.pos.board[10] = 3;
    g.pos.board[0] = -15;
    (g as any).current = 0;
    (g as any).dice = [2, 5];
    (g as any).phase = 'move';
    (g as any).computeSteps();
    expect(g.steps.every((s) => s.from === 'bar')).toBe(true);
  });

  test('Einzelnen Pul schlagen', () => {
    const g = new TavlaGame({ target: 5 }, 1);
    g.pos = empty();
    g.pos.board[10] = 2;
    g.pos.board[7] = -1;
    g.pos.board[20] = -14;
    (g as any).current = 0;
    (g as any).dice = [3, 1];
    (g as any).phase = 'move';
    (g as any).computeSteps();
    g.move(0, 10, 7, 3);
    expect(g.pos.bar[1]).toBe(1);
    expect(g.pos.board[7]).toBe(1);
  });

  test('blockierter Punkt (2+) ist zu', () => {
    const p = empty();
    p.board[10] = 1;
    p.board[7] = -2;
    p.board[4] = -2;
    p.board[20] = -11;
    const seqs = tavlaSequences(p, 0, [3, 3, 3, 3]);
    expect(seqs[0].steps.length).toBe(0);
  });

  test('Rausspielen nur, wenn alle im Heimfeld – und Mars zählt 2', () => {
    const g = new TavlaGame({ target: 5 }, 3);
    g.pos = empty();
    g.pos.board[0] = 1;
    g.pos.off[0] = 14;
    g.pos.board[20] = -15;
    (g as any).current = 0;
    (g as any).dice = [6, 2];
    (g as any).phase = 'move';
    (g as any).computeSteps();
    g.move(0, 0, 'off');
    expect(g.phase).toBe('handOver');
    expect(g.lastResult).toEqual({ winner: 0, points: 2, mars: true });
    expect(g.scores).toEqual([2, 0]);
    expect((g.lastEvent as any).before.kind).toBe('move');
  });

  test('nur ein Würfel spielbar → der größere', () => {
    const p = empty();
    p.board[13] = 1;
    // 6 von 13 → 7 frei, 1 von 13 → 12 frei, aber danach jeweils blockiert
    p.board[12] = 0;
    p.board[6] = -2;
    p.board[11] = -2;
    p.board[1] = -2;
    p.board[22] = -9;
    const seqs = tavlaSequences(p, 0, [6, 1]);
    expect(seqs.every((s) => s.steps.length === 1 && s.steps[0].die === 6)).toBe(true);
  });

  test('Bots spielen ein komplettes Match zu Ende', () => {
    let rs = 11;
    const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    for (const seed of [1, 2, 3]) {
      const g = new TavlaGame({ target: 3 }, seed);
      let guard = 0;
      while (!g.gameOver && guard++ < 20000) {
        if (g.phase === 'handOver') {
          g.nextHand();
          continue;
        }
        tavlaBotTurn(g, g.current, rnd);
        expect(sumCheckers(g, 0)).toBe(15);
        expect(sumCheckers(g, 1)).toBe(15);
      }
      expect(g.gameOver).toBe(true);
      expect(Math.max(...g.scores)).toBeGreaterThanOrEqual(3);
    }
  });

  test('Rückgängig', () => {
    const g = new TavlaGame({ target: 5 }, 5);
    const before = g.pos.board.slice();
    const s = g.steps[0];
    g.move(g.current, s.from, s.to, s.die);
    if (g.phase === 'move') {
      g.undo(g.current);
      expect(g.pos.board).toEqual(before);
    }
  });
});
