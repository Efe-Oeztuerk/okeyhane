// Testseite für den Voice-Chat (nicht im Spiel verlinkt): /voicelab.html#create oder #join=CODE
import { connect, send, on } from './net.ts';
import { Voice } from './voice.ts';
const voice = new Voice();
const w = window as any;
w.__v = { voice, table: null, code: '' };
on('welcome', (m) => {
  voice.setMe(m.id);
  const h = location.hash.slice(1);
  if (h === 'create') send({ type: 'createTable', isPublic: false });
  else if (h.startsWith('join=')) send({ type: 'joinTable', code: h.slice(5) });
});
on('table', (m) => {
  w.__v.table = m.table;
  w.__v.code = m.table.code;
  voice.syncMembers([...m.table.seats.map((s: any) => s?.id ?? ''), ...m.table.spectators.map((s: any) => s.id)]);
});
connect(() => send({ type: 'hello', name: 'T' + Math.random().toString(36).slice(2, 5) }));
w.__v.stats = async () => {
  const out: any[] = [];
  for (const [id, p] of (voice as any).peers) {
    let inBytes = 0;
    let outBytes = 0;
    (await p.pc.getStats()).forEach((r: any) => {
      if (r.type === 'inbound-rtp' && r.kind === 'audio') inBytes += r.bytesReceived;
      if (r.type === 'outbound-rtp' && r.kind === 'audio') outBytes += r.bytesSent;
    });
    out.push({ id, state: p.state, conn: p.pc.connectionState, sig: p.pc.signalingState, inBytes, outBytes, audio: !!p.audio.srcObject });
  }
  return out;
};
