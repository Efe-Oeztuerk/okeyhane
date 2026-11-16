import { describe, expect, it } from 'vitest';
import {
  type Color,
  type Tile,
  OkeyGame,
  botTurn,
  createDeck,
  defaultRules,
  isCompleteMelds,
  isCompletePairs,
  looseSum,
  okeyFromIndicator,
  scorePerisanFinish,
  scoreStandardFinish,
  validateMeld,
  meldSum,
  type Mode,
} from '../src/index.ts';

let nextId = 1000;
const T = (color: Color, value: number): Tile => ({ id: nextId++, color, value, fake: false });
const FAKE = (): Tile => ({ id: nextId++, color: null, value: 0, fake: true });
const R = (v: number) => T('red', v);
const S = (v: number) => T('black', v);
const G = (v: number) => T('yellow', v);
const B = (v: number) => T('blue', v);

// Gösterge Gelb 4 → Okey = Gelb 5
const indicator = G(4);
const okey = okeyFromIndicator(indicator);

describe('Deck und Okey', () => {
  it('hat 106 Steine', () => {
    expect(createDeck()).toHaveLength(106);
  });
  it('Okey ist Gösterge + 1, 13 → 1', () => {
    expect(okeyFromIndicator(R(13))).toEqual({ color: 'red', value: 1 });
    expect(okey).toEqual({ color: 'yellow', value: 5 });
  });
});

describe('Kombinationen', () => {
  it('Reihe und Gruppe', () => {
    expect(validateMeld([R(3), R(4), R(5)], okey)?.kind).toBe('run');
    expect(validateMeld([R(7), S(7), B(7)], okey)?.kind).toBe('set');
    expect(validateMeld([R(7), R(7), B(7)], okey)).toBeNull();
    expect(validateMeld([R(3), S(4), R(5)], okey)).toBeNull();
  });
  it('12-13-1 ist erlaubt, 13-1-2 nicht', () => {
    expect(validateMeld([B(12), B(13), B(1)], okey)).not.toBeNull();
    expect(validateMeld([B(13), B(1), B(2)], okey)).toBeNull();
  });
  it('Okey füllt Lücken, Sahte Okey zählt als Gelb 5', () => {
    expect(validateMeld([R(3), G(5), R(5)], okey)?.kind).toBe('run'); // G5 = Okey
    expect(validateMeld([G(4), FAKE(), G(6)], okey)?.kind).toBe('run'); // SO = G5
  });
  it('101-Summe', () => {
    expect(meldSum(validateMeld([R(11), R(12), R(13)], okey)!)).toBe(36);
  });
});

describe('Hand fertig', () => {
  it('Reihen und Gruppen', () => {
    const hand = [R(1), R(2), R(3), S(7), B(7), R(7), B(9), B(10), B(11), B(12), S(4), B(4), R(4), G(5)];
    expect(isCompleteMelds(hand, okey)).toBe(true);
  });
  it('7 Paare', () => {
    const hand = [R(1), R(1), S(2), S(2), B(3), B(3), R(9), R(9), S(10), S(10), B(11), B(11), R(13), R(13)];
    expect(isCompletePairs(hand, okey, indicator, true)).toBe(true);
  });
  it('Gösterge-Kopie paart mit allem (Çift-Regel)', () => {
    const hand = [R(1), R(1), S(2), S(2), B(3), B(3), R(9), R(9), S(10), S(10), B(11), B(11), R(13), G(4)];
    expect(isCompletePairs(hand, okey, indicator, true)).toBe(true);
    expect(isCompletePairs(hand, okey, indicator, false)).toBe(false);
  });
  it('lose Steine (Okey zählt 0)', () => {
    // 1-2-3 Reihe, 12 und 7 lose, Okey lose
    const hand = [R(1), R(2), R(3), S(12), B(7), G(5)];
    // Okey kann 12 oder 7 zu nichts ergänzen (nur 2 Steine) → 12 + 7 = 19
    expect(looseSum(hand, okey)).toBe(19);
  });
});

describe('Wertung', () => {
  it('Standard renksiz/renkli', () => {
    const r = defaultRules('standard');
    expect(scoreStandardFinish(r, { winner: 0, withOkey: false, withPairs: false, winnerDidOkeyBir: false }).teamDelta).toEqual([0, -2]);
    expect(scoreStandardFinish(r, { winner: 1, withOkey: true, withPairs: false, winnerDidOkeyBir: false }).teamDelta).toEqual([-4, 0]);
    expect(scoreStandardFinish({ ...r, colorful: true }, { winner: 0, withOkey: true, withPairs: false, winnerDidOkeyBir: false }).teamDelta).toEqual([0, -8]);
  });

  const perisanRules = defaultRules('perisan'); // Gelb = 9
  const done = [R(1), R(2), R(3), S(7), B(7), R(7), B(9), B(10), B(11), B(12), S(4), B(4), R(4), G(5)];
  const losing = [R(1), R(2), R(3), S(13), B(7), S(1), S(2), S(3), B(9), B(10), B(11), R(6), R(8), R(10)]; // lose: 13+7+6+8+10 = 44
  const hands = [[], losing, [], losing];

  it('Perişan normal: Gewinner −M×10, Verlierer lose × M', () => {
    const res = scorePerisanFinish(perisanRules, okey, indicator, { winner: 0, withOkey: false, withPairs: false, winnerDidOkeyBir: false }, hands, null);
    expect(res.teamDelta).toEqual([-90, 44 * 9 * 2]);
  });
  it('Perişan mit Okey: −M×100, Verlierer ×2', () => {
    const res = scorePerisanFinish(perisanRules, okey, indicator, { winner: 0, withOkey: true, withPairs: false, winnerDidOkeyBir: false }, hands, null);
    expect(res.teamDelta).toEqual([-900, 44 * 9 * 2 * 2]);
  });
  it('Perişan Okey bir + Okey: −M×200, ×4; Çift dazu verdoppelt', () => {
    const a = scorePerisanFinish(perisanRules, okey, indicator, { winner: 0, withOkey: true, withPairs: false, winnerDidOkeyBir: true }, hands, 0);
    expect(a.teamDelta).toEqual([-1800, 44 * 9 * 4 * 2]);
    const b = scorePerisanFinish(perisanRules, okey, indicator, { winner: 0, withOkey: true, withPairs: true, winnerDidOkeyBir: true }, hands, 0);
    expect(b.teamDelta).toEqual([-3600, 44 * 9 * 8 * 2]);
  });
  it('Okey yakalanmak: alle Steine × M + M × 100', () => {
    // Rot = 7: Gösterge Rot 4 → Okey Rot 5
    const ind = R(4);
    const ok = okeyFromIndicator(ind);
    const hand = [S(1), S(2), S(3), B(9)]; // Summe 15
    const res = scorePerisanFinish(perisanRules, ok, ind, { winner: 0, withOkey: false, withPairs: false, winnerDidOkeyBir: false }, [[], hand, [], []], 1);
    expect(res.teamDelta[1]).toBe(15 * 7 + 700);
  });
  it('fertige Hand des Verlierers = yakalandı', () => {
    const res = scorePerisanFinish(perisanRules, okey, indicator, { winner: 0, withOkey: false, withPairs: false, winnerDidOkeyBir: false }, [[], done, [], []], null);
    expect(res.caught).toEqual([1]);
  });
});

describe('Ganze Spiele mit Bots', () => {
  for (const mode of ['standard', 'okey101', 'perisan'] as Mode[]) {
    for (const seed of [1, 2, 3]) {
      it(`${mode} seed ${seed} läuft ohne Fehler durch`, () => {
        const game = new OkeyGame(defaultRules(mode), seed);
        let guard = 0;
        while (!game.gameOver && guard++ < 50000) {
          if (game.hand.phase === 'handOver') game.nextHand();
          else botTurn(game, game.hand.current);
        }
        expect(game.gameOver).toBe(true);
        expect(game.sheet.length).toBeGreaterThan(0);
        // Steinerhaltung: keine Steine verloren
        const h = game.hand;
        const total =
          h.pile.length +
          h.players.reduce((s, p) => s + p.hand.length + p.discards.length, 0) +
          h.tableMelds.reduce((s, m) => s + m.tiles.length, 0) +
          (h.okeyBirTile ? 1 : 0) +
          1; // Gösterge
        expect(total).toBe(106);
      }, 60000);
    }
  }
});

describe('Regeln im Ablauf', () => {
  it('Nicht am Zug → Fehler', () => {
    const g = new OkeyGame(defaultRules('standard'), 5);
    const other = (g.hand.current + 1) % 4;
    expect(() => g.drawPile(other)).toThrow();
  });
  it('Taş Çalma aus → Fehler', () => {
    const g = new OkeyGame(defaultRules('standard'), 5);
    const s = g.hand.current;
    expect(() => g.steal(s, g.hand.players[s].hand[0].id)).toThrow();
  });
  it('Taş Çalma: erwischt kostet, falsche Beschuldigung kostet', () => {
    const rules = { ...defaultRules('standard'), stealing: { enabled: true, maxPerHand: 1 } };
    const g = new OkeyGame(rules, 5);
    const s = g.hand.current;
    g.steal(s, g.hand.players[s].hand[0].id);
    expect(g.hand.players[s].hand).toHaveLength(15);
    expect(g.accuse((s + 1) % 4, s)).toBe(true);
    expect(g.accuse((s + 1) % 4, (s + 2) % 4)).toBe(false);
  });
});
