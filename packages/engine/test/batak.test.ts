import { describe, it, expect } from 'vitest';
import { BatakGame, batakBotTurn } from '../src/batak.ts';

function playOut(g: BatakGame, seed = 1) {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  let guard = 0;
  while (!g.gameOver && guard++ < 20000) {
    if (g.phase === 'handOver') g.nextHand();
    else batakBotTurn(g, g.current, rnd);
  }
  return guard;
}

describe('Batak', () => {
  it('teilt 13 Karten an 4 Spieler aus', () => {
    const g = new BatakGame({}, 5);
    for (const s of [0, 1, 2, 3]) expect(g.hands[s].length).toBe(13);
    expect(g.phase).toBe('bid');
  });
  it('alle passen → wer angefangen hat, spielt mit Mindestgebot', () => {
    const g = new BatakGame({ minBid: 5 }, 7);
    const opener = g.current;
    for (let i = 0; i < 4; i++) g.bid(g.current, null);
    expect(g.contract).toEqual({ seat: opener, bid: 5 });
    expect(g.phase).toBe('trump');
  });
  it('Farbe bedienen und höher gehen ist Pflicht', () => {
    const g = new BatakGame({}, 11);
    g.bid(g.current, 5);
    while (g.phase === 'bid') g.bid(g.current, null);
    g.chooseTrump(g.current, 'S');
    const lead = g.legal(g.current)[0];
    g.play(g.current, lead.id);
    const s = g.current;
    const legal = g.legal(s);
    const follow = g.hands[s].filter((c) => c.suit === lead.suit);
    if (follow.length) expect(legal.every((c) => c.suit === lead.suit)).toBe(true);
  });
  it('Farbe fehlt + Koz vorhanden → nur Koz erlaubt', () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = new BatakGame({}, seed);
      g.bid(g.current, 5);
      while (g.phase === 'bid') g.bid(g.current, null);
      g.chooseTrump(g.current, 'H');
      let guard = 0;
      while (g.phase === 'play' && guard++ < 60) {
        const s = g.current;
        if (g.trick.length) {
          const led = g.trick[0].card.suit;
          const has = g.hands[s].some((c) => c.suit === led);
          const trumps = g.hands[s].some((c) => c.suit === 'H');
          if (!has && trumps) expect(g.legal(s).every((c) => c.suit === 'H')).toBe(true);
        }
        g.play(s, g.legal(s)[0].id);
      }
    }
  });
  it('spielt komplette Spiele mit Bots (alle Varianten)', () => {
    for (const mode of ['ihaleli', 'esli', 'gommeli'] as const) {
      const g = new BatakGame({ mode, minBid: mode === 'esli' ? 8 : mode === 'gommeli' ? 4 : 5, target: 31 }, 3);
      const steps = playOut(g);
      expect(g.gameOver).toBe(true);
      expect(steps).toBeLessThan(20000);
      expect(g.winner).not.toBeNull();
    }
  });
  it('Spielende nach Anzahl Hände', () => {
    const g = new BatakGame({ handLimit: 3, target: 9999 }, 21);
    playOut(g);
    expect(g.gameOver).toBe(true);
    expect(g.history.length).toBeGreaterThanOrEqual(3);
  });
  it('Stichzahl pro Hand stimmt', () => {
    const g = new BatakGame({ mode: 'gommeli', minBid: 4 }, 9);
    while (g.phase !== 'handOver') batakBotTurn(g, g.current, () => 0.5);
    expect(g.tricks.reduce((a, b) => a + b, 0)).toBe(16);
    expect(g.kitty.length).toBe(4);
  });
});
