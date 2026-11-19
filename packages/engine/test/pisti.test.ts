import { describe, expect, test } from 'vitest';
import { PistiGame, pistiBotTurn, JACK, type Card } from '../src/pisti.ts';

const c = (id: number, suit: Card['suit'], rank: number): Card => ({ id, suit, rank });

/** Spielzustand gezielt vorbereiten */
function setup(players: 2 | 4 = 2, bluff = false) {
  const g = new PistiGame({ players, target: 101, bluff }, 42);
  return g;
}

describe('Pişti', () => {
  test('Start: 4 Karten pro Spieler, 4 in der Mitte (3 verdeckt), oben keine Vale', () => {
    for (let seed = 1; seed < 60; seed++) {
      const g = new PistiGame({ players: 4, target: 101, bluff: false }, seed);
      expect(g.seats.every((s) => g.hands[s].length === 4)).toBe(true);
      expect(g.pile.length).toBe(4);
      expect(g.hiddenInPile).toBe(3);
      expect(g.pile[3].rank).not.toBe(JACK);
      expect(g.stock.length).toBe(52 - 4 - 16);
    }
  });

  test('gleicher Wert sticht, Pişti nur bei genau einer Karte, Vale auf Vale = 20', () => {
    const g = setup(2);
    g.pile = [c(100, 'H', 7)];
    g.hiddenInPile = 0;
    g.hands[0] = [c(101, 'S', 7), c(102, 'S', 3)];
    g.hands[2] = [c(103, 'C', 9), c(104, 'C', 4)];
    g.current = 0;
    g.play(0, 101);
    expect(g.pistiPoints[0]).toBe(10);
    expect(g.captured[0].length).toBe(2);
    // Vale auf einzelne Vale
    g.pile = [c(105, 'D', JACK)];
    g.hands[2] = [c(106, 'H', JACK), c(107, 'H', 2)];
    g.current = 2;
    g.play(2, 106);
    expect(g.pistiPoints[1]).toBe(20);
  });

  test('Vale nimmt alles, ist aber auf andere Einzelkarte kein Pişti', () => {
    const g = setup(2);
    g.pile = [c(100, 'H', 5)];
    g.hiddenInPile = 0;
    g.hands[0] = [c(101, 'S', JACK), c(102, 'S', 3)];
    g.current = 0;
    g.play(0, 101);
    expect(g.pistiPoints[0]).toBe(0);
    expect(g.captured[0].length).toBe(2);
    expect(g.pile.length).toBe(0);
  });

  test('Bluff: geglaubt 10, aufgedeckt echt 20, aufgedeckt falsch → 10 für den Gegner', () => {
    const g = setup(2, true);
    const prep = () => {
      g.pile = [c(100, 'H', 8)];
      g.hiddenInPile = 0;
      g.hands[0] = [c(101, 'S', 8), c(102, 'S', 3), c(110, 'C', 6)];
      g.hands[2] = [c(103, 'C', 9), c(104, 'C', 4)];
      g.current = 0;
      g.phase = 'play';
    };
    prep();
    g.play(0, 101, true);
    expect(g.phase).toBe('bluff');
    g.respond(2, true);
    expect(g.pistiPoints[0]).toBe(10);
    prep();
    g.pistiPoints = [0, 0];
    g.play(0, 101, true);
    g.respond(2, false);
    expect(g.pistiPoints[0]).toBe(20);
    prep();
    g.pistiPoints = [0, 0];
    g.play(0, 102, true);
    g.respond(2, false);
    expect(g.pistiPoints).toEqual([0, 10]);
    expect(g.pile.map((x) => x.id)).toEqual([100, 102]);
  });

  test('Rundenwertung: 52 Karten verteilt, Kartenmehrheit 3, Basis 16 Punkte (+ Piştis)', () => {
    for (const players of [2, 4] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const g = new PistiGame({ players, target: 9999, bluff: seed % 2 === 0 }, seed);
        let guard = 0;
        while (g.phase !== 'handOver' && guard++ < 500) pistiBotTurn(g, g.current, () => ((seed * 9301 + guard * 49297) % 233280) / 233280);
        expect(g.phase).toBe('handOver');
        const r = g.lastResult!;
        expect(r.teams[0].cards + r.teams[1].cards).toBe(52);
        const base = r.teams.reduce((s, t) => s + t.aces + t.jacks + t.clubs2 + t.diamonds10 + t.majority, 0);
        expect(base).toBe(r.teams[0].cards === 26 ? 13 : 16);
      }
    }
  });

  test('ganzes Spiel bis zum Ziel', () => {
    const g = new PistiGame({ players: 4, target: 101, bluff: true }, 7);
    let guard = 0;
    while (!g.gameOver && guard++ < 20000) {
      if (g.phase === 'handOver') g.nextHand();
      else pistiBotTurn(g, g.current);
    }
    expect(g.gameOver).toBe(true);
    expect(Math.max(...g.scores)).toBeGreaterThanOrEqual(101);
    expect(g.winnerTeam).toBe(g.scores[0] > g.scores[1] ? 0 : 1);
  });
});
