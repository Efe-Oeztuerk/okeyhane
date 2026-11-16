// Lässt 4 Bots ein ganzes Spiel spielen und druckt den Punktezettel.
// Aufruf: npm run simulate -- [standard|okey101|perisan] [seed]

import { OkeyGame, botTurn, defaultRules, type Mode } from '../src/index.ts';

const mode = (process.argv[2] as Mode) ?? 'perisan';
const seed = Number(process.argv[3] ?? 42);
const game = new OkeyGame(defaultRules(mode), seed);

let guard = 0;
while (!game.gameOver && guard++ < 100000) {
  if (game.hand.phase === 'handOver') game.nextHand();
  else botTurn(game, game.hand.current);
}

console.log(`Modus: ${mode}  Seed: ${seed}`);
console.log('Hand | Team A | Team B | Stand A | Stand B | Notiz');
for (const r of game.sheet) {
  console.log(
    `${String(r.hand).padStart(4)} | ${String(r.teamDelta[0]).padStart(6)} | ${String(r.teamDelta[1]).padStart(6)} | ${String(r.totals[0]).padStart(7)} | ${String(r.totals[1]).padStart(7)} | ${r.notes.join(', ')}`,
  );
}
console.log(`Gewinner: ${game.winnerTeam === null ? 'Unentschieden' : game.winnerTeam === 0 ? 'Team A' : 'Team B'}`);
