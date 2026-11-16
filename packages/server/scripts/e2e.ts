// End-to-End-Test: 2 Menschen + 2 Bots spielen über WebSocket eine Hand nach der anderen.
// Aufruf: (Server läuft auf PORT) tsx scripts/e2e.ts [mode]

import WebSocket from 'ws';

const PORT = process.env.PORT ?? 3000;
const mode = process.argv[2] ?? 'standard';

function client(name: string): Promise<{ ws: WebSocket; msgs: any[]; wait: (type: string, pred?: (m: any) => boolean) => Promise<any> }> {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const msgs: any[] = [];
    const waiters: { type: string; pred?: (m: any) => boolean; r: (m: any) => void }[] = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      msgs.push(m);
      for (const w of [...waiters]) if (w.type === m.type && (!w.pred || w.pred(m))) {
        waiters.splice(waiters.indexOf(w), 1);
        w.r(m);
      }
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', name }));
      res({
        ws,
        msgs,
        wait: (type, pred) =>
          new Promise((r, rej) => {
            waiters.push({ type, pred, r });
            setTimeout(() => rej(new Error('timeout ' + type)), 20000);
          }),
      });
    });
  });
}

const a = await client('Efe');
const b = await client('Burak');
a.ws.send(JSON.stringify({ type: 'createTable', isPublic: false }));
const tbl = await a.wait('table');
const code = tbl.table.code;
console.log('Tisch', code);
b.ws.send(JSON.stringify({ type: 'joinTable', code }));
await b.wait('table');
a.ws.send(JSON.stringify({ type: 'setRules', rules: { mode, handCount: 2, startPoints: 4 } }));
a.ws.send(JSON.stringify({ type: 'addBot', seat: 2 }));
a.ws.send(JSON.stringify({ type: 'addBot', seat: 3 }));
await a.wait('table', (m) => m.table.seats.every(Boolean));
a.ws.send(JSON.stringify({ type: 'chat', text: 'selam' }));
await b.wait('chat');
a.ws.send(JSON.stringify({ type: 'tv', action: 'load', source: { kind: 'youtube', id: 'dQw4w9WgXcQ' } }));
await b.wait('tv');
a.ws.send(JSON.stringify({ type: 'start' }));

let errors = 0;
for (const c of [a, b]) c.ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'error') {
    errors++;
    console.log('Fehler:', m.text);
  }
});

// einfache Spieler: ziehen, ersten Stein abwerfen (bzw. in 101 Hand leerspielen geht nicht → einfach abwerfen)
function autoplay(c: typeof a, seatHint: { seat: number }) {
  c.ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === 'table') seatHint.seat = m.you.seat;
    if (m.type !== 'state') return;
    const v = m.view;
    if (v.gameOver || v.phase === 'handOver' || v.current !== seatHint.seat) return;
    setTimeout(() => {
      if (v.phase === 'draw') c.ws.send(JSON.stringify({ type: 'action', action: 'drawPile' }));
      else c.ws.send(JSON.stringify({ type: 'action', action: 'discard', tileId: v.myHand[v.myHand.length - 1].id }));
    }, 5);
  });
}
autoplay(a, { seat: 0 });
autoplay(b, { seat: 1 });

const end = await a.wait('state', (m) => m.view.gameOver).catch(() => null);
if (!end) {
  // Hände brauchen Zeit (Bots + 9 s Pause zwischen Händen)
  console.log('Noch nicht vorbei, warte weiter...');
}
const fin = end ?? (await new Promise<any>((res) => {
  const iv = setInterval(() => {
    const last = [...a.msgs].reverse().find((m) => m.type === 'state');
    if (last?.view.gameOver) {
      clearInterval(iv);
      res(last);
    }
  }, 500);
}));
console.log('Spiel vorbei. Zettel:');
for (const r of fin.view.sheet) console.log(' ', r.hand, r.teamDelta, r.totals, r.notes.join(', '));
console.log('Gewinner-Team:', fin.view.winnerTeam, 'Fehler:', errors);
a.ws.close();
b.ws.close();
process.exit(0);
