// Okeyhane Client: Menü, Kahvehane, Tisch-UI

import './style.css';
import type { Tile, OkeyIdentity } from '@okeyhane/engine';
import type { Avatar, MediaState, PlayerInfo } from '../../server/src/protocol.ts';
import { connect, send, on } from './net.ts';
import { h, toast } from './dom.ts';
import { cardElement, preloadCards, SUIT_SYM, type PCard } from './cardArt.ts';
import { hasLine, voiceUrl, type VoiceLine } from './voices.ts';
import { t, setLang, getLang } from './i18n.ts';
import { World, type GameVisual } from './scene.ts';
import { Istaka } from './istaka.ts';
import { openEditor } from './editor.ts';
import { MediaPlayer, parseTwitch, parseYouTube } from './media.ts';
import { Voice } from './voice.ts';
import { sfx, unlockAudio, playFile, preloadFile } from './sound.ts';
import { settings, saveSettings, vol, TOUCH_BTNS, defaultAvatar, loadProfile, saveProfile, keyLabel, defaultKeys, type Profile, type KeyBinds } from './settings.ts';
import { tileElement } from './tileArt.ts';
import { isCompleteMelds, isCompletePairs, looseSum, rackIsFinished } from '@okeyhane/engine';
import { CREDITS } from './models.ts';
import { setupControls, popupMenu, closeMenu, keyHintLine, touchActive, PAD_HELP, openWheel, closeWheel, wheelIsOpen, menuIsOpen } from './controls.ts';
import { SPOTS, ORDER_ITEMS, type OrderItem } from './scene.ts';
import { music as bgm, STATIONS } from './menuMusic.ts';
import { spotify, parseSpotify } from './spotify.ts';
import { initSocial, resume, openAuth, openFriends, openLobbies, logout, account, subscribe as onSocial, pendingCount } from './social.ts';

// ------------------------------------------------------------------ Zustand

interface TableSummary {
  code: string;
  ownerId: string;
  isPublic: boolean;
  seats: (PlayerInfo | null)[];
  spectators: { id: string; name: string; watching: number | null; lounge?: string | null; wantSeat?: number | null; avatar?: Avatar }[];
  rules: any;
  started: boolean;
  tv: MediaState;
  music: MediaState;
  signatures: Record<number, string>;
  spot?: number;
  ready?: number[];
}

let profile: Profile = loadProfile() ?? { name: '', avatar: { ...defaultAvatar }, signature: null };
let myId = '';
let stats: Record<string, { wins: number; losses: number; streak?: number; best?: number }> = {};
let table: TableSummary | null = null;
let you: { id: string; seat: number | null; watching: number | null } = { id: '', seat: null, watching: null };
let st: any = null; // letzter Spielzustand
let inCafe = false;
  document.body.classList.remove('incafe');
let sheetOpen = false;
/** Ergebnis erst nach kurzer Pause zeigen, damit man die letzte Karte / den letzten Stein und wohin es ging noch sieht */
let resultHold = 0;
function holdResult(ms: number) {
  resultHold = Date.now() + ms;
  setTimeout(() => {
    const ph = st?.view?.phase;
    if (ph === 'handOver' || ph === 'gameOver' || st?.view?.gameOver) sheetOpen = true;
    renderAll();
  }, ms + 30);
}
const resultHidden = () => Date.now() < resultHold;
let seenRows = 0;
let lastHandNo = -1;
let chatLog: HTMLElement[] = [];

const ui = document.getElementById('ui')!;
/** Bedienfläche um uiInset vom Rand nach innen (fixe Elemente beziehen sich dann auf den kleineren Rahmen) */
function applyUiInset() {
  const px = Math.max(0, settings.uiInset || 0);
  document.body.style.setProperty('--ui-inset-x', px + 'px');
  document.body.style.setProperty('--ui-inset-y', Math.round(px * 0.5) + 'px');
  document.body.classList.toggle('ui-inset', px > 0);
}
applyUiInset();
const world = new World(document.getElementById('world')!);
// alle Fernseher zeigen dasselbe; Ton nur vom nächsten
const tvs = world.tvHosts.map((host) => new MediaPlayer(host, 'volTv', true));
const tv = {
  set enabled(v: boolean) {
    tvs.forEach((p) => (p.enabled = v));
  },
  get enabled() {
    return tvs[0].enabled;
  },
  apply: (s: MediaState | null) => tvs.forEach((p) => p.apply(s)),
  stopAll: () => tvs.forEach((p) => p.stopAll()),
  tick: () => tvs.forEach((p) => p.tick()),
  refreshVolume: () => tvs.forEach((p) => p.refreshVolume()),
};
setInterval(() => {
  const near = world.nearestTv();
  tvs.forEach((p, i) => {
    const g = i === near ? 1 : 0;
    if (p.gain !== g) {
      p.gain = g;
      p.refreshVolume();
    }
  });
}, 500);
const musicHost = h('div', { id: 'music-host' });
document.body.append(musicHost);
const music = new MediaPlayer(musicHost, 'volMusic', false);
const ownHost = h('div', { id: 'music-host' });
document.body.append(ownHost);
const ownMusic = new MediaPlayer(ownHost, 'volMusic', false);
const voice = new Voice();
const istaka = new Istaka();

// ------------------------------------------------------------------ Netzwerk

// stabile Sitzungs-ID: damit man nach einem kurzen Verbindungsabbruch seinen Platz zurückbekommt
const sid = (() => {
  let v = localStorage.getItem('okeySid');
  if (!v) localStorage.setItem('okeySid', (v = Math.random().toString(36).slice(2) + Date.now().toString(36)));
  return v;
})();
let rejoining = false;
function hello() {
  send({ type: 'hello', sid, name: profile.name || 'Oyuncu', avatar: profile.avatar, signature: profile.signature });
}
connect(() => {
  hello();
  resume();
  // nach Verbindungsabbruch: zurück zum Tisch
  const code = sessionStorage.getItem('tableCode');
  if (code && inCafe) {
    rejoining = true;
    send({ type: 'joinTable', code });
  }
});

initSocial({
  modal: (...c) => modal(...c),
  join: (msg) => {
    unlockAudio();
    send(msg);
  },
  inTable: () => !!table,
  modeName: (m) => t(m),
  onAccount: (a) => {
    if (a) {
      profile.name = a.username;
      if (a.avatar) profile.avatar = a.avatar;
      saveProfile(profile);
      hello();
    }
    if (!inCafe) showMenu();
    else renderLeft();
  },
});

on('welcome', (m) => {
  myId = m.id;
  stats = m.stats ?? {};
  voice.setMe(myId);
});
on('table', (m) => {
  if (m.table?.rules?.mode === 'pisti' || m.table?.rules?.mode === 'batak') preloadCards();
  rejoining = false;
  const prevStarted = table?.started;
  // Handy: neuer Tisch → alle Menüs zu (auch „Schick deinen Freunden diesen Code“)
  if (document.body.classList.contains('phone') && m.table?.code && m.table.code !== table?.code) {
    settings.hudCompact = true;
    saveSettings();
    closeOverlays();
  }
  table = m.table;
  you = m.you;
  sessionStorage.setItem('tableCode', table!.code);
  if (!inCafe) enterCafe();
  world.setSpot(table!.spot ?? 0);
  world.setPlayers(table!.seats, you.seat ?? you.watching);
  // Spiel startet: automatisch hinsetzen
  if (table!.started && !prevStarted) {
    if (you.seat !== null) world.sitAt(you.seat);
    seenRows = 0;
    lastHandNo = -1;
  }
  if (prevStarted && !table!.started && !world.lounge) {
    // Spiel beendet → alle stehen auf (Zuschauer auf ihren Stühlen bleiben sitzen)
    world.sitAt(null);
    toast(getLang() === 'de' ? '🚶 Spiel beendet – ihr seid aufgestanden. Zum Weiterspielen wieder hinsetzen.' : '🚶 Oyun bitti – kalktınız. Tekrar oynamak için oturun.', '#2d5a3a');
  }
  if (!table!.started) {
    st = null;
    world.setGame(null);
    istaka.clear();
  }
  voice.syncMembers([...table!.seats.map((s) => s?.id ?? ''), ...table!.spectators.map((s) => s.id)]);
  world.keepWalkers([...table!.seats.map((s) => s?.id ?? ''), ...table!.spectators.map((s) => s.id)]);
  world.setLounge(table!.spectators, myId);
  // inzwischen Spieler → Zuschauer-Stuhl verlassen
  if (you.seat !== null && world.lounge) world.sitLounge(null);
  applyMedia();
  renderAll();
});
on('state', (m) => {
  const prev = st;
  st = m;
  const v = m.view;
  if (v.kind !== 'tavla') world.setTavla(null, null);
  if (v.kind === 'tavla') {
    world.setTavla(v, you.seat ?? you.watching);
    tavlaFeedback(prev?.view?.kind === 'tavla' ? prev.view : null, v);
    // Auswahl nur behalten, wenn der Pul noch ziehen darf; geschlagener Pul ist automatisch gewählt
    const mine = v.current === you.seat && v.phase === 'move';
    if (!mine) tavlaSelect(v, null);
    else if (v.bar[you.seat === 0 ? 0 : 1] > 0 && tavlaTargets(v, 'bar').length) tavlaSelect(v, 'bar');
    else if (tavlaSelFrom !== null && tavlaTargets(v, tavlaSelFrom).length) tavlaSelect(v, tavlaSelFrom);
    else tavlaSelect(v, null);
    const endedT = v.phase === 'handOver' || v.phase === 'gameOver';
    const wasEndedT = prev?.view?.kind === 'tavla' && (prev.view.phase === 'handOver' || prev.view.phase === 'gameOver');
    if (endedT && !wasEndedT) holdResult(2300);
    if (v.current === you.seat && prev?.view.current !== you.seat && !endedT) sfx.bell();
    renderAll();
    return;
  }
  if (v.kind === 'batak') {
    preloadCards();
    world.setBatak(v, you.seat ?? you.watching);
    batakFeedback(prev?.view?.kind === 'batak' ? prev.view : null, v);
    const endedB = v.phase === 'handOver';
    const wasEndedB = prev?.view?.kind === 'batak' && prev.view.phase === 'handOver';
    if (endedB && !wasEndedB) holdResult(2900);
    if (!endedB && wasEndedB) sheetOpen = false;
    if ((v.actor ?? v.current) === you.seat && (prev?.view.actor ?? prev?.view.current) !== you.seat && !endedB) sfx.bell();
    if (v.handNo !== batakHandNo) {
      batakHandNo = v.handNo;
      batakBurySel.clear();
    }
    renderAll();
    return;
  }
  if (v.kind === 'pisti') {
    preloadCards();
    world.setPisti(v, you.seat ?? you.watching);
    pistiFeedback(prev?.view?.kind === 'pisti' ? prev.view : null, v);
    const endedP = v.phase === 'handOver' || v.phase === 'gameOver';
    const wasEndedP = prev && (prev.view.phase === 'handOver' || prev.view.phase === 'gameOver');
    if (endedP && !wasEndedP) holdResult(3000);
    if (!endedP && wasEndedP) sheetOpen = false;
    if (v.current === you.seat && prev?.view.current !== you.seat && !endedP) sfx.bell();
    renderAll();
    return;
  }
  world.sharpCards(false);
  const okey: OkeyIdentity = m.okey;
  if (v.handNo !== lastHandNo || (prev && prev.view.phase === 'handOver' && v.phase !== 'handOver')) {
    if (prev && v.phase !== 'handOver' && prev.view.indicator?.id !== v.indicator?.id) istaka.clear();
    lastHandNo = v.handNo;
  }
  if (you.seat !== null || you.watching !== null) istaka.setHand(v.myHand, okey);
  const visual: GameVisual = {
    mySeat: you.seat,
    viewSeat: you.watching ?? 0,
    current: v.current,
    pileCount: v.pileCount,
    indicator: v.indicator,
    okeyBirTile: v.okeyBirTile,
    rackCounts: v.players.map((p: any) => p.tileCount),
    discards: v.players.map((p: any) => p.discards),
    tableMelds: v.tableMelds,
    revealed: v.revealedHands,
    finisher: v.phase === 'handOver' || v.gameOver ? m.lastResult?.finisher ?? null : null,
  };
  world.setGame(visual);
  const ended = v.phase === 'handOver' || v.phase === 'gameOver';
  const wasEnded = prev && (prev.view.phase === 'handOver' || prev.view.phase === 'gameOver');
  if (ended && !wasEnded) {
    holdResult(2200);
    if (m.lastResult?.note) toast(m.lastResult.note, '#2d5a3a');
  }
  // neue Runde beginnt → Zettel wieder zu
  if (!ended && wasEnded) sheetOpen = false;
  if (v.current === you.seat && prev?.view.current !== you.seat && v.phase === 'draw') sfx.bell();
  renderAll();
});
on('chat', (m) => addLog(h('div', {}, h('b', {}, m.from + (m.spectator ? ' 👁' : '') + ': '), m.text)));
on('quick', (m) => {
  const text = t('q_' + m.key);
  addLog(h('div', {}, h('b', {}, m.from + ': '), text));
  if (m.seat !== null) world.say(m.seat, text);
});
on('emote', (m) => {
  world.emote(m.seat, m.key, !!m.ring);
  if (m.seat !== null && m.seat === you.seat) selfFeedback(m.key, !!m.ring);
  else otherSound(m.key);
  if (m.smoke) {
    setTimeout(() => world.smokeCloud(), 1400);
    addLog(h('div', { class: 'sys' }, `${nameOf(m.seat)} 💨`));
  }
});
/** Ruf nach Ahmet (bei jeder Bestellung, für alle am Tisch) + Ahmets Antworten */
const AHMET_CALL = '/sfx/ahmet.mp3';
const AHMET_REPLIES = ['/sfx/ahmet_reply1.mp3', '/sfx/ahmet_reply2.mp3'];
setTimeout(() => [AHMET_CALL, ...AHMET_REPLIES].forEach(preloadFile), 3000);
function playVoice(src: string, gain = 1) {
  return playFile(src, gain, 'volSfx');
}
// Abräumen: nur manchmal sagt er etwas
world.onAhmetClear = () => {
  if (Math.random() < 0.45) playVoice('/sfx/ahmet_clear.mp3', 0.9);
};
/** Stimme der Figur auf einem Platz */
function voiceOfSeat(seat: number | null | undefined): string | undefined {
  if (seat === null || seat === undefined) return undefined;
  // Spieler und Bots an meinem Tisch (andere Tische schicken keine Ereignisse)
  return (table?.seats[seat] as any)?.avatar?.voice;
}
/** Satz in der Stimme dieser Figur – null, wenn sie keinen dafür hat (oder Stimmen aus sind) */
const isBotSeat = (seat: number | null | undefined) => seat !== null && seat !== undefined && !!table?.seats[seat]?.bot;
function sayLine(seat: number | null | undefined, line: VoiceLine, gain = 1): Promise<void> | null {
  const v = voiceOfSeat(seat);
  if (!hasLine(v, line)) return null;
  if (vol('volChar') <= 0) return null;
  if (!settings.botVoices && isBotSeat(seat)) return null;
  return playFile(voiceUrl(v!, line), gain * (seat === you.seat ? 1 : 0.85), 'volChar');
}
/** wenn ein Ton fertig ist (oder spätestens nach maxMs) */
function afterAudio(p: Promise<void> | null, fn: () => void, maxMs = 6000) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    fn();
  };
  if (!p) return go();
  void p.then(go);
  setTimeout(go, maxMs);
}
on('stats', (m) => {
  stats = m.stats ?? stats;
});
on('gameEnd', (m) => {
  // Siegerpose / Verliererpose, wenn das Ergebnis erscheint
  setTimeout(() => {
    for (const s of m.winners ?? []) world.emote(s, 'rubhands');
    for (const s of m.losers ?? []) world.emote(s, 'headshake');
  }, 2600);
  const de = getLang() === 'de';
  setTimeout(() => toast(de ? `☕ Verlierer zahlt: ${m.payerName} gibt allen einen Çay aus` : `☕ Kaybeden öder: ${m.payerName} herkese çay ısmarlıyor`, '#2d5a3a'), 4200);
});
on('order', (m) => {
  const items: OrderItem[] = (m.items ?? [m.item]) as OrderItem[];
  const variants: number[] = m.variants ?? [m.variant ?? 0];
  if (m.silent) {
    // ausgegebener Çay: Ahmet bringt ihn leise, ohne Ruf
    items.forEach((item, k) => world.order(m.seat, item, variants[k] ?? 0));
    return;
  }
  // nur Dosen bestellt → „bi kola getir“, sonst (auch gemischt) der Tee-Ruf; ohne eigene Stimme der alte Ruf
  const line: VoiceLine = items.every((x) => x === 'icecek') ? 'kola' : 'cay';
  let call: Promise<void> | null = null;
  // Charakter-Stimmen auf 0 → auch kein Ruf nach Ahmet
  if (vol('volChar') > 0) {
    call = sayLine(m.seat, line);
    if (!call && !(isBotSeat(m.seat) && !settings.botVoices)) call = playFile(AHMET_CALL, m.seat === you.seat ? 1 : 0.8, 'volChar');
  }
  // Ahmet antwortet nur manchmal – erst wenn der Ruf fertig ist, dann 1–2 s Pause (nicht überlappend)
  if (typeof m.reply === 'number' && m.reply >= 0) {
    const reply = AHMET_REPLIES[m.reply % AHMET_REPLIES.length];
    afterAudio(call, () => setTimeout(() => playVoice(reply, 0.9), 1000 + Math.random() * 1000));
  }
  items.forEach((item, k) => world.order(m.seat, item, variants[k] ?? 0));
  addLog(h('div', { class: 'sys' }, `${m.from}: ${items.map(orderLabel).join(', ')} ${getLang() === 'de' ? 'bestellt' : 'söyledi'}`));
  if (m.seat === you.seat) sfx.bell();
});
// Mitspieler, die im Kahvehane herumlaufen
on('pos', (m) => inCafe && world.setWalker(m.id, m));
let lastPose = '';
let lastPoseAt = 0;
let wasWalking = false;
setInterval(() => {
  if (!inCafe || !table) return;
  const p = world.myPose();
  if (!p) {
    if (wasWalking) send({ type: 'pos', x: 0, z: 0, yaw: 0, walking: false });
    wasWalking = false;
    return;
  }
  const key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${p.yaw.toFixed(2)}`;
  const now = Date.now();
  if (key === lastPose && now - lastPoseAt < 2000) return;
  lastPose = key;
  lastPoseAt = now;
  wasWalking = true;
  send({ type: 'pos', x: p.x, z: p.z, yaw: p.yaw, walking: true });
}, 120);

on('eye', (m) => {
  world.eye(m.seat, m.key);
  if (m.seat !== null && m.seat === you.seat) eyeFeedback(m.key);
});

/** Rückmeldung für eigene Aktionen (eigener Körper ist in Ego-Perspektive unsichtbar) */
function selfFeedback(key: string, ring = false) {
  if (key === 'nargile') {
    sfx.bubble();
    setTimeout(() => {
      sfx.exhale();
      world.selfPuff('smoke', ring);
    }, 1900);
  } else if (key === 'tea') {
    world.selfPuff('steam');
    setTimeout(() => sfx.sip(), 900);
  } else if (key === 'slam') {
    setTimeout(() => {
      sfx.slam();
      world.shake(0.3);
    }, 450);
  } else if (key === 'tespih') {
    for (let i = 0; i < 6; i++) setTimeout(() => sfx.tile(), i * 180);
  }
  flashLabel(t('e_' + key));
}

/** Geräusche, wenn andere am Tisch ein Emote machen (Shisha, Tee, auf den Tisch hauen, Tespih) */
function otherSound(key: string) {
  if (key === 'nargile') {
    sfx.bubble();
    setTimeout(() => sfx.exhale(), 1900);
  } else if (key === 'tea') setTimeout(() => sfx.sip(), 900);
  else if (key === 'slam') setTimeout(() => sfx.slam(), 450);
  else if (key === 'tespih') for (let i = 0; i < 6; i++) setTimeout(() => sfx.tile(), i * 180);
}

function eyeFeedback(key: string) {
  const el = h('div', { class: 'eyelids ' + key }, h('div', { class: 'lid top' }), h('div', { class: 'lid bottom' }));
  document.body.append(el);
  sfx.wink();
  setTimeout(() => el.remove(), key === 'blink' ? 1300 : key === 'wide' ? 1500 : 700);
  flashLabel(t('eye_' + key).replace(/ \(\d\)/, ''));
}

function flashLabel(text: string) {
  const el = h('div', { class: 'selfflash' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1600);
}
on('sfx', (m) => {
  if (m.kind === 'draw') sfx.draw();
  else if (m.kind === 'discard' || m.kind === 'layoff' || m.kind === 'open') sfx.tile();
  else if (m.kind === 'finish') {
    sfx.finish();
    world.emote(m.seat, 'slam');
  } else if (m.kind === 'shuffle') sfx.shuffle();
  else if (m.kind === 'indicator') {
    toast(`${nameOf(m.seat)}: ${t('showIndicator')}`, '#5a3a22');
    sfx.tile();
  } else if (m.kind === 'okeyBir') toast(`${nameOf(m.seat)}: OKEY BİR!`, '#8e1b1b');
});
on('accuse', (m) => {
  toast(`${nameOf(m.by)} → ${nameOf(m.target)}: ${m.caught ? t('caught') : t('falseAccuse')}`, m.caught ? '#2d5a3a' : '#7a1a1a');
  world.emote(m.by, 'slam');
});
on('seatQueued', (m) => {
  toast(getLang() === 'de' ? `🪑 Platz von ${nameOf(m.seat)} vorgemerkt – du setzt dich, sobald diese Runde fertig ist` : `🪑 ${nameOf(m.seat)} yeri ayrıldı – bu el bitince oturursun`, '#2d5a3a');
  renderAll();
});
on('seated', (m) => {
  world.sitAt(m.seat);
  toast(getLang() === 'de' ? '🪑 Die Runde ist fertig – du spielst jetzt mit!' : '🪑 El bitti – artık sen de oynuyorsun!', '#2d5a3a');
  renderAll();
});
on('tv', (m) => {
  if (table) table.tv = m.state;
  applyMedia();
});
on('music', (m) => {
  if (table) table.music = m.state;
  applyMedia();
});
on('error', (m) => {
  // Wiederverbinden zu einem inzwischen geschlossenen Tisch: still zurück ins Menü
  if (m.key === 'noTable' && rejoining) {
    rejoining = false;
    sessionStorage.removeItem('tableCode');
    if (inCafe) {
      toast(getLang() === 'de' ? 'Der Tisch wurde inzwischen geschlossen' : 'Masa kapandı');
      leaveCafe();
    }
    return;
  }
  const de = getLang() === 'de';
  if (m.key === 'noTable') return toast(de ? 'Tisch nicht gefunden' : 'Masa bulunamadı');
  if (m.key === 'orderWait') return orderWaitToast(m.secs ?? 30);
  if (m.text === 'Erst richtig umstellen') return toast(de ? '✋ Erst das Brett richtig umstellen (Perler mit Lücke trennen)' : '✋ Önce istakayı doğru diz (perler arası boşluk)', '#7a4a1a');
  toast(m.text ? (de ? m.text : errTr(m.text)) : de ? 'Fehler' : 'Hata');
});

/** Server-Meldungen kommen auf Deutsch → für Türkisch übersetzen */
const ERR_TR: Record<string, string> = {
  'Alle 4 Plätze müssen besetzt sein': '4 yerin hepsi dolu olmalı',
  'Bots sind aus': 'Botlar kapalı',
  'Das ist kein Okey': 'Bu okey değil',
  'Du hast die Gösterge nicht': 'Gösterge sende değil',
  'Du sitzt am Tisch': 'Zaten masada oturuyorsun',
  'Ein Stein muss zum Abwerfen bleiben': 'Atmak için bir taş kalmalı',
  'Erst nach der Hand': 'El bitince',
  'Erst öffnen': 'Önce açmalısın',
  'Falsche Steinanzahl': 'Taş sayısı yanlış',
  'Hand ist nicht fertig': 'El bitmemiş',
  'Hand ist vorbei': 'El bitti',
  'Hand läuft noch': 'El devam ediyor',
  'Hier kann nicht angelegt werden': 'Buraya işlenemez',
  'Kein Abwurf da': 'Yanda taş yok',
  'Kein Spiel': 'Oyun yok',
  'Kein gültiges Paar': 'Geçerli çift değil',
  'Keine Versuche mehr': 'Hakkın kalmadı',
  'Mitte ist leer': 'Ortada taş kalmadı',
  'Nach Okey bir nur aus der Mitte ziehen': 'Okey birden sonra sadece ortadan çekilir',
  'Nicht dein Zug': 'Sıra sende değil',
  'Nicht erlaubt': 'İzin yok',
  'Nicht geöffnet': 'Açılmadı',
  'Noch Steine auf der Hand': 'Elinde hâlâ taş var',
  'Nur der Tischbesitzer': 'Sadece masa sahibi',
  'Nur in 101': 'Sadece 101’de',
  'Nur in Perişan': 'Sadece Perişan’da',
  'Nur vor dem ersten Abwurf': 'Sadece ilk taş atılmadan önce',
  'Okey bir wurde schon gemacht': 'Okey bir zaten yapıldı',
  'Passt nicht': 'Uymuyor',
  'Platz besetzt': 'Yer dolu',
  'Schon gezeigt': 'Zaten gösterildi',
  'Spiel ist vorbei': 'Oyun bitti',
  'Spiel läuft noch': 'Oyun devam ediyor',
  'Spiel läuft schon': 'Oyun zaten başladı',
  'Stein doppelt': 'Taş iki kere seçilmiş',
  'Stein nicht auf der Hand': 'Taş elinde değil',
  'Taş Çalma ist aus': 'Taş çalma kapalı',
  'Unbekannte Aktion': 'Bilinmeyen hamle',
  'Ungültig': 'Geçersiz',
  'Ungültige Kombination': 'Geçersiz per',
  'Zuschauer können nicht spielen': 'İzleyiciler oynayamaz',
  Serverfehler: 'Sunucu hatası',
};
function errTr(x: string) {
  if (ERR_TR[x]) return ERR_TR[x];
  let m = x.match(/^Mindestens (\d+) Paare$/);
  if (m) return `En az ${m[1]} çift`;
  m = x.match(/^Summe (\d+) < (\d+)$/);
  if (m) return `Toplam ${m[1]} < ${m[2]}`;
  return x;
}
on('kicked', () => leaveCafe());
on('ownerChanged', (m) => toast(`👑 ${m.name} ${getLang() === 'de' ? 'ist jetzt Tischbesitzer' : 'artık masa sahibi'}`, '#2d5a3a'));
on('left', () => leaveCafe());
on('lobby', () => {
  istaka.clear();
  st = null;
});

function appendAll(el: HTMLElement, ...items: (Node | string | null | undefined | false)[]) {
  for (const i of items) if (i !== null && i !== undefined && i !== false) el.append(i);
}

function nameOf(seat: number | null) {
  if (seat === null || !table) return '?';
  return table.seats[seat]?.name ?? '?';
}

function addLog(el: HTMLElement) {
  chatLog.push(el);
  if (chatLog.length > 80) chatLog.shift();
  const log = document.querySelector('.chat .log');
  if (log) {
    log.append(el);
    log.scrollTop = log.scrollHeight;
  }
}

// ------------------------------------------------------------------ Medien

/** eigenes Fernsehprogramm (nur für einen selbst, z. B. als Zuschauer) */
const ownTv: MediaState = { source: null, playing: false, position: 0, at: Date.now(), volume: 80 };
function ownTvSource(url: string): MediaState['source'] {
  const id = parseYouTube(url);
  if (id) return { kind: 'youtube', id };
  const ch = parseTwitch(url);
  if (ch) return { kind: 'twitch', channel: ch };
  return null;
}
if (settings.ownTvUrl) ownTv.source = ownTvSource(settings.ownTvUrl);
function ownTvDo(action: 'play' | 'pause' | 'seek' | 'volume' | 'stop', val = 0) {
  const now = Date.now();
  const cur = ownTv.playing ? ownTv.position + (now - ownTv.at) / 1000 : ownTv.position;
  if (action === 'play') Object.assign(ownTv, { position: cur, playing: true });
  else if (action === 'pause') Object.assign(ownTv, { position: cur, playing: false });
  else if (action === 'seek') ownTv.position = Math.max(0, cur + val);
  else if (action === 'volume') Object.assign(ownTv, { position: cur, volume: val });
  else if (action === 'stop') {
    Object.assign(ownTv, { source: null, playing: false, position: 0 });
    settings.ownTvUrl = '';
    settings.tvMode = 'table';
    saveSettings();
  }
  ownTv.at = now;
  applyMedia();
}

function applyMedia() {
  if (!table) {
    tv.stopAll();
    music.stopAll();
    world.setTvPower(settings.tvMode !== 'off');
    world.setTvVisible(false);
    spotify.close();
    bgm.setBusy(false);
    return;
  }
  const tvState = settings.tvMode === 'own' ? ownTv : table.tv;
  tv.enabled = settings.tvMode !== 'off';
  tv.apply(tvState);
  world.setTvPower(tv.enabled);
  world.setTvVisible(tv.enabled && !!tvState.source);
  music.enabled = settings.musicMode === 'table';
  music.apply(table.music);
  const spUri = parseSpotify(settings.ownMusicUrl);
  const ownOn = settings.musicMode === 'own' && !!settings.ownMusicUrl && !spUri;
  if (ownOn) ownMusic.playLocal(settings.ownMusicUrl);
  else ownMusic.stopAll();
  if (settings.musicMode === 'own' && spUri) spotify.open(spUri);
  else if (spotify.isOpen() && settings.musicMode !== 'own') spotify.pause();
  // Radio macht automatisch Platz, sobald andere Musik oder der Fernseher läuft
  const tableMusic = music.enabled && !!table.music.source && table.music.playing;
  const tableTv = tv.enabled && !!tvState.source && tvState.playing;
  bgm.setBusy(ownOn || tableMusic || tableTv || spotify.playing);
}
setInterval(() => {
  tv.tick();
  music.tick();
}, 4000);
spotify.onPlaying = () => applyMedia();
spotify.onClosed = () => {
  settings.musicMode = 'table';
  saveSettings();
  applyMedia();
};

// ------------------------------------------------------------------ Handy: UI-Größe an den Bildschirm anpassen

function fitUi() {
  const vv = window.visualViewport;
  const W = vv?.width ?? innerWidth;
  const H = vv?.height ?? innerHeight;
  // Menüs sind für ~1050×640 gebaut → so weit verkleinern, dass sie passen
  const z = Math.max(0.5, Math.min(1, H / 640, W / 1050));
  const root = document.documentElement.style;
  root.setProperty('--uiz', z.toFixed(3));
  root.setProperty('--uih', Math.floor(H / z - 16) + 'px');
  root.setProperty('--uiw', Math.floor(Math.min(1000, W / z - 24)) + 'px');
}
let wasPhone = false;
setInterval(() => {
  const ph = document.body.classList.contains('phone');
  if (ph !== wasPhone && inCafe && table) renderRight();
  wasPhone = ph;
}, 500);
fitUi();
addEventListener('resize', fitUi);
window.visualViewport?.addEventListener('resize', fitUi);
addEventListener('orientationchange', () => [100, 400, 1000].forEach((ms) => setTimeout(fitUi, ms)));

// ------------------------------------------------------------------ App (PWA)

// am PC die Kartenbilder schon im Leerlauf laden (am Handy erst, wenn Pişti gewählt ist)
setTimeout(() => {
  if (!document.body.classList.contains('phone')) preloadCards();
}, 4000);
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
let installEvt: any = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  // Knopf nachträglich einblenden, ohne offene Fenster zu schließen
  const slot = document.getElementById('install-slot');
  const b = installButton();
  if (slot && b && !slot.firstChild) slot.append(b);
});
const isApp = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as any).standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installButton() {
  if (isApp() || (!installEvt && !isIOS())) return null;
  const de = getLang() === 'de';
  return h(
    'button',
    {
      class: 'ghost small',
      onclick: async () => {
        if (installEvt) {
          installEvt.prompt();
          await installEvt.userChoice.catch(() => null);
          installEvt = null;
          showMenu();
          return;
        }
        modal(
          h('h2', {}, '📲 ' + (de ? 'Als App installieren' : 'Uygulama olarak yükle')),
          h(
            'ol',
            { style: { lineHeight: '1.7' } },
            h('li', {}, de ? 'In Safari unten auf Teilen ⬆️ tippen' : "Safari'de alttaki Paylaş ⬆️ simgesine dokun"),
            h('li', {}, de ? '„Zum Home-Bildschirm“ wählen' : '“Ana Ekrana Ekle”yi seç'),
            h('li', {}, de ? 'Okeyhane startet dann im Vollbild wie eine App' : 'Okeyhane tam ekran uygulama gibi açılır'),
          ),
        );
      },
    },
    '📲 ' + (de ? 'Als App installieren' : 'Uygulama olarak yükle'),
  );
}

// Vollbild-Knopf (Handy/Tablet): Android & iPad können echtes Vollbild, iPhone nur als installierte App
{
  const de0 = () => getLang() === 'de';
  const fsEl = document.documentElement as any;
  const canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  const fsBtn = h('button', {
    class: 'fsbtn',
    title: 'Vollbild',
    onclick: async () => {
      const d = document as any;
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
        return;
      }
      if (canFs) {
        try {
          await (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl, { navigationUI: 'hide' });
          (screen.orientation as any)?.lock?.('landscape').catch(() => {});
          return;
        } catch {}
      }
      modal(
        h('h2', {}, '⛶ ' + (de0() ? 'Vollbild' : 'Tam ekran')),
        h(
          'p',
          {},
          de0()
            ? 'Auf dem iPhone geht Vollbild nur, wenn Okeyhane als App installiert ist: in Safari unten auf Teilen ⬆️ → „Zum Home-Bildschirm“. Danach von dort starten – ohne Safari-Leisten.'
            : "iPhone'da tam ekran sadece uygulama olarak yüklenince olur: Safari'de Paylaş ⬆️ → “Ana Ekrana Ekle”. Sonra oradan aç.",
        ),
      );
    },
  }, '⛶');
  if (!isApp()) document.body.append(fsBtn);
}

// ------------------------------------------------------------------ Menü

function showMenu() {
  bgm.set('menu');
  ui.innerHTML = '';
  world.sitAt(null);
  const previewBox = h('div', { class: 'preview' });
  const nameInput = h('input', { value: profile.name, placeholder: t('yourName'), maxLength: 20 });
  const codeInput = h('input', { placeholder: t('code'), maxLength: 5, style: { textTransform: 'uppercase', width: '120px' } });
  const specBox = h('input', { type: 'checkbox' });
  const friendsBtn = h('button', { onclick: () => openFriends() });
  const paintFriends = () => {
    const n = pendingCount();
    friendsBtn.textContent = '👥 ' + (getLang() === 'de' ? 'Freunde' : 'Arkadaşlar') + (n ? ` (${n})` : '');
    friendsBtn.classList.toggle('badge', n > 0);
  };
  paintFriends();
  const offSocial = onSocial(paintFriends);
  codeInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') go({ type: 'joinTable', code: codeInput.value, spectate: specBox.checked });
  });
  nameInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') commitName();
  });
  const commitName = () => {
    profile.name = nameInput.value.trim() || 'Oyuncu';
    saveProfile(profile);
    hello();
  };
  const go = (msg: any) => {
    unlockAudio();
    commitName();
    send(msg);
  };
  const menu = h(
    'div',
    { class: 'menu' },
    h(
      'div',
      { class: 'lang' },
      h('button', { class: 'small ' + (getLang() === 'tr' ? 'primary' : 'ghost'), onclick: () => (setLang('tr'), showMenu()) }, 'TR'),
      ' ',
      h('button', { class: 'small ' + (getLang() === 'de' ? 'primary' : 'ghost'), onclick: () => (setLang('de'), showMenu()) }, 'DE'),
      ' ',
      muteButton(),
    ),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'col' },
        previewBox,
        h('button', { class: 'ghost', onclick: () => openEditor({ ...profile, name: nameInput.value || profile.name }, (p) => ((profile = p), saveProfile(p), hello(), showMenu())) }, '✏️ ' + t('editChar')),
      ),
      h(
        'div',
        { class: 'col panel actions' },
        h('div', { class: 'logo' }, 'Okeyhane'),
        h('div', { class: 'tagline' }, t('tagline')),
        account
          ? h(
              'div',
              { class: 'acct' },
              h('span', {}, '👤 ', h('b', {}, account.username)),
              h('button', { class: 'small ghost', onclick: () => logout() }, getLang() === 'de' ? 'Abmelden' : 'Çıkış'),
            )
          : h(
              'div',
              { class: 'col', style: { gap: '6px' } },
              h('button', { class: 'primary', onclick: () => openAuth() }, '👤 ' + (getLang() === 'de' ? 'Anmelden / Registrieren' : 'Giriş yap / Kayıt ol')),
              h('label', {}, (getLang() === 'de' ? 'oder als Gast: ' : 'ya da misafir olarak: ') + t('yourName')),
              nameInput,
            ),
        h('button', { class: 'primary', onclick: () => go({ type: 'createTable', isPublic: false }) }, '🀄 ' + t('createTable')),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, codeInput, h('label', { class: 'row', style: { gap: '4px' } }, specBox, t('spectate')), h('button', { onclick: () => go({ type: 'joinTable', code: codeInput.value, spectate: specBox.checked }) }, t('join'))),
        h(
          'div',
          { class: 'row', style: { flexWrap: 'nowrap' } },
          h('button', { onclick: () => (commitName(), unlockAudio(), openLobbies()) }, '🌐 ' + (getLang() === 'de' ? 'Offene Tische' : 'Açık masalar')),
          friendsBtn,
        ),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('button', { class: 'ghost', onclick: () => openStats() }, '📊 ' + t('stats')), h('button', { class: 'ghost', onclick: () => openSettings() }, '⚙️ ' + t('settings'))),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { id: 'install-slot', style: { display: 'contents' } }, installButton()), h('button', { class: 'ghost small', onclick: () => openCredits() }, '© Credits')),
      ),
    ),
  );
  ui.append(menu);
  if (!profile.name) setTimeout(() => nameInput.focus(), 50);
  const pv = World.preview(previewBox, profile.avatar, profile.name || '...');
  nameInput.addEventListener('input', () => pv.update(profile.avatar, nameInput.value || '...'));
  menu.addEventListener('remove', () => pv.dispose());
  new MutationObserver((_, o) => {
    if (!menu.isConnected) {
      offSocial();
      o.disconnect();
    }
  }).observe(ui, { childList: true });
  (menu as any)._pv = pv;
}

function openStats() {
  const de = getLang() === 'de';
  const modes = ['standard', 'okey101', 'perisan', 'pisti', 'batak', 'tavla'];
  const rows = modes.map((m) => {
    const s = stats[m] ?? { wins: 0, losses: 0 };
    const n = s.wins + s.losses;
    return h(
      'tr',
      {},
      h('td', {}, t(m)),
      h('td', {}, String(s.wins)),
      h('td', {}, String(s.losses)),
      h('td', {}, n ? Math.round((s.wins / n) * 100) + '%' : '–'),
      h('td', {}, (s.streak ? '🔥' + s.streak : '0') + (s.best ? ` / ${s.best}` : '')),
    );
  });
  // Rangliste (nur angemeldete Spieler, dauerhaft gespeichert)
  const board = h('div', { class: 'lb-board muted' }, de ? 'Lädt …' : 'Yükleniyor …');
  let lbMode = 'standard';
  const tabs = h('div', { class: 'row lb-tabs' });
  const load = (m: string) => {
    lbMode = m;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', (b as HTMLElement).dataset.m === m));
    board.textContent = de ? 'Lädt …' : 'Yükleniyor …';
    send({ type: 'leaderboard', mode: m });
  };
  for (const m of modes) tabs.append(h('button', { class: 'small', 'data-m': m, onclick: () => load(m) }, t(m)));
  lbRender = (mode: string, list: any[]) => {
    if (mode !== lbMode || !board.isConnected) return;
    board.innerHTML = '';
    if (!list.length) return void (board.textContent = de ? 'Noch keine Einträge.' : 'Henüz kayıt yok.');
    board.append(
      h(
        'table',
        { style: { width: '100%' } },
        h('tr', {}, h('th', {}, '#'), h('th', {}, de ? 'Spieler' : 'Oyuncu'), h('th', {}, t('wins')), h('th', {}, t('losses')), h('th', {}, de ? 'Quote' : 'Oran'), h('th', {}, de ? 'Rekord' : 'Rekor')),
        list.map((r, i) =>
          h(
            'tr',
            { class: r.username === profile.name ? 'lb-me' : '' },
            h('td', {}, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
            h('td', {}, r.username),
            h('td', {}, String(r.wins)),
            h('td', {}, String(r.losses)),
            h('td', {}, r.rate + '%'),
            h('td', {}, r.best ? '🔥' + r.best : '–'),
          ),
        ),
      ),
    );
  };
  modal(
    h('h2', {}, t('stats') + ' · ' + (profile.name || '')),
    h('table', { style: { width: '100%' } }, h('tr', {}, h('th', {}, t('mode')), h('th', {}, t('wins')), h('th', {}, t('losses')), h('th', {}, de ? 'Quote' : 'Oran'), h('th', {}, de ? 'Serie / Rekord' : 'Seri / Rekor')), rows),
    account ? '' : h('div', { class: 'muted', style: { margin: '6px 0' } }, de ? 'Als Gast wird nur kurz gezählt. Melde dich an, damit deine Siege dauerhaft gespeichert werden und in der Rangliste stehen.' : 'Misafir olarak sadece geçici sayılır. Kalıcı kayıt ve sıralama için giriş yap.'),
    h('h2', { style: { marginTop: '14px' } }, '🏆 ' + (de ? 'Rangliste' : 'Sıralama')),
    tabs,
    board,
  );
  load(lbMode);
}
let lbRender: ((mode: string, list: any[]) => void) | null = null;
on('leaderboard', (m) => lbRender?.(m.mode, m.rows ?? []));

function openCredits() {
  modal(
    h('h2', {}, '© Credits'),
    h('div', { class: 'muted', style: { marginBottom: '8px' } }, getLang() === 'de' ? '3D-Modelle und Lizenzen:' : '3D modeller ve lisanslar:'),
    h('ul', {}, CREDITS.map((c) => h('li', {}, h('a', { href: c.url, target: '_blank', rel: 'noopener', style: { color: '#e3b04b' } }, c.what), ' – ', c.author))),
    h('div', { class: 'muted' }, getLang() === 'de' ? 'Größe/Detailgrad für das Spiel angepasst. Alles andere: Okeyhane.' : 'Boyut/detay oyun için uyarlandı. Geri kalan her şey: Okeyhane.'),
  );
}

function modal(...children: (HTMLElement | string)[]) {
  // Fenster schließt Chat, Menüs und das Emote-Rad
  els.chat?.classList.remove('open');
  document.body.classList.remove('chat-open');
  closeMenu();
  closeWheel();
  const m = h('div', { class: 'modal', onclick: (e: MouseEvent) => e.target === m && m.remove() }, h('div', { class: 'panel' }, ...children, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { onclick: () => m.remove() }, 'OK'))));
  m.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') return m.remove();
    if (ke.key !== 'Enter') return;
    const tgt = ke.target as HTMLElement;
    if (tgt instanceof HTMLInputElement) {
      // Enter = Knopf in derselben Zeile (z. B. „Laden“), sonst OK
      const btn = (tgt.closest('.row')?.querySelector('button.primary, button') as HTMLButtonElement | null) ?? null;
      e.preventDefault();
      if (btn) btn.click();
      else m.remove();
    } else if (!(tgt instanceof HTMLButtonElement) && !(tgt instanceof HTMLSelectElement)) m.remove();
  });
  ui.append(m);
  return m;
}

function openSettings() {
  // nochmal ⚙️ drücken = Einstellungen wieder zu
  const open = ui.querySelector(':scope > .modal.settings-modal');
  if (open) return open.remove();
  const slider = (key: keyof typeof settings, label: string) =>
    h(
      'label',
      {},
      label,
      h('input', {
        type: 'range',
        min: 0,
        max: 100,
        value: settings[key] as number,
        oninput: (e: Event) => {
          (settings as any)[key] = Number((e.target as HTMLInputElement).value);
          saveSettings();
          tv.refreshVolume();
          music.refreshVolume();
          ownMusic.refreshVolume();
          voice.refreshVolume();
        },
      }),
    );
  const select = (key: keyof typeof settings, label: string, options: [string, string][], after?: () => void) =>
    h(
      'label',
      {},
      label,
      h(
        'select',
        {
          onchange: (e: Event) => {
            (settings as any)[key] = (e.target as HTMLSelectElement).value;
            saveSettings();
            after?.();
          },
        },
        options.map(([v, l]) => h('option', { value: v, selected: settings[key] === v }, l)),
      ),
    );
  const range = (key: keyof typeof settings, label: string, min: number, max: number, unit: string, after?: () => void) => {
    const out = h('span', { class: 'muted', style: { minWidth: '44px', textAlign: 'right' } }, settings[key] + unit);
    return h(
      'label',
      {},
      label,
      h(
        'span',
        { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
        h('input', {
          type: 'range',
          min,
          max,
          value: settings[key] as number,
          oninput: (e: Event) => {
            (settings as any)[key] = Number((e.target as HTMLInputElement).value);
            out.textContent = settings[key] + unit;
            saveSettings();
            after?.();
          },
        }),
        out,
      ),
    );
  };
  const check = (key: keyof typeof settings, label: string) =>
    h('label', {}, label, h('input', { type: 'checkbox', checked: settings[key] as boolean, onchange: (e: Event) => (((settings as any)[key] = (e.target as HTMLInputElement).checked), saveSettings()) }));
  const settingsM = modal(
    h('h2', {}, '⚙️ ' + t('settings')),
    h(
      'div',
      { class: 'settings' },
      slider('volMaster', t('volumeMaster')),
      slider('volSfx', t('volumeSfx')),
      slider('volVoice', t('volumeVoice')),
      slider('volTv', t('volumeTv')),
      slider('volMusic', t('volumeMusic')),
      slider('volNpc', t('volumeNpc')),
      slider('volChar', t('volumeChar')),
      h(
        'label',
        { title: getLang() === 'de' ? 'Aus: Bots rufen nicht mehr nach Ahmet und sagen kein „Pişti!“. Ahmet antwortet trotzdem.' : 'Kapalı: botlar konuşmaz. Ahmet yine cevap verir.' },
        getLang() === 'de' ? '🤖 Bots sprechen' : '🤖 Botlar konuşsun',
        h('input', { type: 'checkbox', checked: settings.botVoices, onchange: (e: Event) => ((settings.botVoices = (e.target as HTMLInputElement).checked), saveSettings()) }),
      ),
      // Bedienfläche nach innen rücken (z. B. bei abgerundeten Handy-Ecken oder wenn man es zentraler mag)
      h(
        'label',
        {},
        getLang() === 'de' ? 'Bildschirmrand (Bedienung nach innen)' : 'Ekran kenarı (kontroller içe)',
        h('input', {
          type: 'range',
          min: 0,
          max: 80,
          step: 4,
          value: settings.uiInset,
          oninput: (e: Event) => {
            settings.uiInset = Number((e.target as HTMLInputElement).value);
            applyUiInset();
            saveSettings();
          },
        }),
      ),
      check('smoke', t('smoke')),
      // Touch: Knöpfe rechts selbst auswählen
      document.body.classList.contains('touch')
        ? h(
            'div',
            { class: 'btnpick' },
            h('div', { class: 'muted' }, getLang() === 'de' ? 'Knöpfe rechts (antippen = an/aus)' : 'Sağdaki düğmeler (dokun = aç/kapa)'),
            h(
              'div',
              { class: 'chips' },
              TOUCH_BTNS.map((b) => {
                const chip = h('button', { class: 'chip' + (settings.touchBtns.includes(b.key) ? ' on' : '') }, `${b.icon} ${getLang() === 'de' ? b.de : b.tr}`);
                chip.onclick = () => {
                  const on = settings.touchBtns.includes(b.key);
                  settings.touchBtns = on ? settings.touchBtns.filter((k) => k !== b.key) : [...settings.touchBtns, b.key];
                  chip.classList.toggle('on', !on);
                  saveSettings();
                };
                return chip;
              }),
            ),
          )
        : null,
      check('pushToTalk', t('pushToTalk')),
      check('menuMusic', getLang() === 'de' ? '🎶 Musik im Menü' : '🎶 Menüde müzik'),
      check('musicMuted', getLang() === 'de' ? '🔇 Menümusik & Radio stumm' : '🔇 Menü müziği & radyo sessiz'),
      h('label', {}, '📻 Radio', radioSelect()),
      select('tvMode', getLang() === 'de' ? '📺 Fernseher' : '📺 Televizyon', [
        ['table', getLang() === 'de' ? 'An' : 'Açık'],
        ['off', getLang() === 'de' ? 'Ganz aus' : 'Tamamen kapalı'],
      ], () => applyMedia()),
      select('quality', t('quality'), [
        ['high', 'High'],
        ['low', 'Low'],
      ], () => toast(getLang() === 'de' ? 'Lichter, Gäste und Außenwelt ändern sich nach dem Neuladen der Seite' : 'Işıklar, misafirler ve dış dünya sayfa yenilenince değişir')),
      select('timeOfDay', t('timeOfDay'), [
        ['auto', t('auto')],
        ['day', '☀️'],
        ['evening', '🌇'],
        ['night', '🌙'],
      ]),
      h('b', { style: { marginTop: '10px' } }, getLang() === 'de' ? '🎥 Ansicht & Steuerung' : '🎥 Görüş & kontrol'),
      range('fovTable', getLang() === 'de' ? 'Sichtfeld am Tisch' : 'Masada görüş açısı', 50, 90, '°'),
      range('camTilt', getLang() === 'de' ? 'Blick am Tisch heben (Gesichter)' : 'Masada bakışı kaldır (yüzler)', 0, 25, '', () => world.seated !== null && world.sitAt(world.seated)),
      range('fovWalk', getLang() === 'de' ? 'Sichtfeld beim Laufen' : 'Yürürken görüş açısı', 50, 90, '°'),
      range('sensitivity', getLang() === 'de' ? 'Empfindlichkeit (Maus/Touch/Stick)' : 'Hassasiyet (fare/dokunma/kol)', 30, 250, '%'),
      check('invertY', getLang() === 'de' ? 'Y-Achse umkehren' : 'Y eksenini ters çevir'),
      h(
        'button',
        {
          class: 'small',
          style: { alignSelf: 'flex-start', marginTop: '4px' },
          onclick: (e: MouseEvent) => {
            Object.assign(settings, { fovTable: 62, fovWalk: 66, camTilt: 0, sensitivity: 100, invertY: false });
            saveSettings();
            world.setThird(null);
            world.setZoom(false);
            if (world.seated !== null) world.sitAt(world.seated);
            (e.target as HTMLElement).closest('.modal')?.remove();
            openSettings();
            toast(getLang() === 'de' ? 'Kamera zurückgesetzt' : 'Kamera sıfırlandı', '#2d5a3a');
          },
        },
        '↺ ' + (getLang() === 'de' ? 'Kamera auf Standard zurücksetzen' : 'Kamerayı varsayılana sıfırla'),
      ),
      select('touchUi', getLang() === 'de' ? 'Touch-Steuerung (Handy/iPad)' : 'Dokunmatik kontrol (telefon/iPad)', [
        ['auto', t('auto')],
        ['on', getLang() === 'de' ? 'An' : 'Açık'],
        ['off', getLang() === 'de' ? 'Aus' : 'Kapalı'],
      ]),
      check('showKeyHints', getLang() === 'de' ? '❔ Bedienhinweise einblenden' : '❔ Kullanım ipuçlarını göster'),
      keybindSection(),
      controllerSection(),
      h(
        'label',
        {},
        t('language'),
        h(
          'select',
          { onchange: (e: Event) => (setLang((e.target as HTMLSelectElement).value as any), inCafe ? renderAll() : showMenu()) },
          h('option', { value: 'tr', selected: getLang() === 'tr' }, 'Türkçe'),
          h('option', { value: 'de', selected: getLang() === 'de' }, 'Deutsch'),
        ),
      ),
    ),
  );
  settingsM.classList.add('settings-modal');
}

/** kleiner Punkt: Sprachverbindung zu diesem Spieler */
function voiceDot(id: string, isMe: boolean) {
  if (isMe || id.startsWith('bot-')) return '';
  const st = voice.state(id);
  const de = getLang() === 'de';
  const map: Record<string, [string, string]> = {
    connected: ['🟢', de ? 'Sprachverbindung steht' : 'Ses bağlantısı var'],
    connecting: ['🟡', de ? 'Sprachverbindung wird aufgebaut…' : 'Ses bağlanıyor…'],
    failed: ['🔴', de ? 'Keine Sprachverbindung (Netzwerk blockiert)' : 'Ses bağlantısı yok (ağ engelliyor)'],
  };
  const [dot, title] = map[st ?? 'connecting'];
  return h('span', { class: 'vdot', title }, dot + ' ');
}
voice.onChange = () => inCafe && table && renderLeft();
// eigener Mikro-Pegel: grüner Rand am Mikro-Knopf
setInterval(() => {
  const b = document.querySelector('.mic-btn') as HTMLElement | null;
  if (b) b.style.boxShadow = voice.level > 0.08 ? `0 0 0 ${2 + Math.round(voice.level * 4)}px #6fdc6f` : '';
}, 120);

/** Radio-Anzeige: Sender · Titel; Klick = abspielen erlauben bzw. Musikfenster */
let radioEl: HTMLElement | null = null;
function radioChip() {
  const label = h('span', { class: 'rc-text' });
  const next = h('button', { class: 'small ghost', title: getLang() === 'de' ? 'nächster Titel' : 'sonraki parça', onclick: (e: Event) => (e.stopPropagation(), bgm.nextTrack()) }, '⏭');
  radioEl = h('div', { class: 'radiochip', onclick: () => (bgm.status().state === 'blocked' ? bgm.unlock() : openMedia()) }, label, next);
  updateRadioChip();
  return radioEl;
}
function updateRadioChip() {
  if (!radioEl || !radioEl.isConnected) return;
  const s = bgm.status();
  const de = getLang() === 'de';
  const why: Record<string, string> = {
    playing: '📻 ',
    loading: '📻 … ',
    busy: de ? '📻 ⏸ (TV/Musik läuft) ' : '📻 ⏸ (TV/müzik açık) ',
    muted: '📻 🔇 ',
    off: '📻 ',
    blocked: de ? '📻 ▶ Antippen zum Abspielen · ' : '📻 ▶ Çalmak için dokun · ',
  };
  (radioEl.querySelector('.rc-text') as HTMLElement).textContent = why[s.state] + s.text;
  radioEl.className = 'radiochip ' + s.state;
}
setInterval(updateRadioChip, 1000);

/** 🔊/🔇 für Menümusik und Radio */
function muteButton() {
  const b = h('button', { class: 'small ghost', title: getLang() === 'de' ? 'Musik an/aus' : 'Müzik aç/kapa' }, settings.musicMuted ? '🔇' : '🔊');
  b.onclick = () => {
    bgm.toggleMute();
    b.textContent = settings.musicMuted ? '🔇' : '🔊';
  };
  return b;
}

function radioSelect() {
  return h(
    'select',
    {
      onchange: (e: Event) => {
        settings.radioStation = (e.target as HTMLSelectElement).value;
        saveSettings();
      },
    },
    h('option', { value: 'off', selected: settings.radioStation === 'off' }, getLang() === 'de' ? 'Aus' : 'Kapalı'),
    STATIONS.map((st) => h('option', { value: st.id, selected: settings.radioStation === st.id }, st.name)),
  );
}

function keybindSection() {
  const de = getLang() === 'de';
  const groups: [string, [keyof KeyBinds, string, string][]][] = [
    [
      de ? '🚶 Bewegung & Ansicht' : '🚶 Hareket & görüş',
      [
        ['forward', 'Vorwärts', 'İleri'],
        ['back', 'Rückwärts', 'Geri'],
        ['left', 'Links', 'Sol'],
        ['right', 'Rechts', 'Sağ'],
        ['look', 'Umschauen ↔ Brett', 'Etrafa bak ↔ masa'],
        ['zoom', 'Zoom (halten)', 'Yakınlaştır (basılı)'],
        ['thirdBack', '3rd Person von hinten (halten)', 'Arkadan bak (basılı)'],
        ['thirdFront', '3rd Person von vorne (halten)', 'Önden bak (basılı)'],
      ],
    ],
    [
      de ? '🀄 Spielzüge' : '🀄 Hamleler',
      [
        ['drawPile', 'Aus der Mitte ziehen', 'Ortadan çek'],
        ['drawSide', 'Von der Seite nehmen', 'Yandan al'],
        ['discard', 'Abwerfen', 'Taş at'],
        ['finish', 'Fertig (Bitirmek)', 'Bitir'],
        ['indicator', 'Gösterge zeigen', 'Gösterge göster'],
        ['okeyBir', 'Okey bir (Perişan)', 'Okey bir (Perişan)'],
        ['select', 'Stein markieren (Shift = Peri)', 'Taş seç (Shift = per)'],
        ['flip', 'Stein umdrehen', 'Taşı çevir'],
        ['sortRuns', 'Sortieren: Reihen', 'Diz: seri'],
        ['sortPairs', 'Sortieren: Paare', 'Diz: çift'],
      ],
    ],
    [
      de ? '☕ Kahvehane & Emotes' : '☕ Kahvehane & hareketler',
      [
        ['emoteWheel', 'Emote-Rad öffnen', 'Hareket çarkı'],
        ['emoteTea', 'Çay trinken', 'Çay iç'],
        ['emoteNargile', 'Nargile ziehen', 'Nargile çek'],
        ['emoteSlam', 'Auf den Tisch hauen', 'Masaya vur'],
        ['emoteTespih', 'Tespih drehen', 'Tespih çek'],
        ['emoteHeadshake', 'Kopf schütteln', 'Kafa salla'],
        ['emoteRub', 'Hände reiben', 'El ovuştur'],
        ['wink', 'Zwinkern', 'Göz kırp'],
        ['blink', 'Blinzeln', 'Göz kırpıştır'],
        ['wide', 'Große Augen', 'Göz aç'],
        ['cayci', 'Ahmet (Çaycı) rufen', 'Ahmet’i (çaycı) çağır'],
        ['quick', 'Sprüche-Menü', 'Hazır sözler'],
        ['chat', 'Chat schreiben', 'Sohbet yaz'],
        ['sheet', 'Punktezettel', 'Puan kağıdı'],
        ['media', 'TV & Musik', 'TV & müzik'],
        ['ptt', 'Push-to-Talk', 'Bas-konuş'],
      ],
    ],
  ];
  const box = h('div', { class: 'col keybinds', style: { margin: '10px 0', gap: '4px' } });
  const render = () => {
    box.innerHTML = '';
    box.append(h('b', {}, de ? '⌨️ Tastenbelegung' : '⌨️ Tuş ayarları'), h('div', { class: 'muted small' }, de ? 'Pfeiltasten bewegen den Cursor auf der Istaka · Shift + Pfeil schiebt markierte Steine' : 'Ok tuşları ıstakada imleci gezdirir · Shift + ok seçili taşları kaydırır'));
    const used = new Map<string, number>();
    const walkOnly = ['forward', 'back', 'left', 'right'];
    for (const k of Object.keys(settings.keys)) {
      if (walkOnly.includes(k)) continue;
      used.set(settings.keys[k as keyof KeyBinds], (used.get(settings.keys[k as keyof KeyBinds]) ?? 0) + 1);
    }
    for (const [title, list] of groups) {
      box.append(h('div', { class: 'kb-group' }, title));
      for (const [k, dl, tl] of list) {
        const dup = (used.get(settings.keys[k]) ?? 0) > 1;
        const btn = h('button', { class: 'small ghost' + (dup ? ' dup' : ''), style: { minWidth: '96px' }, title: dup ? (de ? 'doppelt belegt' : 'çift atanmış') : '' }, keyLabel(settings.keys[k]));
        btn.onclick = () => {
          btn.textContent = de ? 'Taste drücken…' : 'Tuşa bas…';
          const cap = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            removeEventListener('keydown', cap, true);
            if (e.code !== 'Escape') {
              settings.keys[k] = e.code;
              saveSettings();
            }
            render();
            renderFocusBadge();
          };
          addEventListener('keydown', cap, true);
        };
        box.append(h('label', {}, de ? dl : tl, btn));
      }
    }
    box.append(h('button', { class: 'small ghost', onclick: () => ((settings.keys = { ...defaultKeys }), saveSettings(), render()) }, de ? 'Standard wiederherstellen' : 'Varsayılana dön'));
  };
  render();
  return box;
}

function controllerSection() {
  const de = getLang() === 'de';
  const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
  return h(
    'div',
    { class: 'col', style: { margin: '10px 0', gap: '4px' } },
    h('b', {}, '🎮 Controller'),
    h('div', { class: 'muted small' }, pads.length ? (de ? 'Verbunden: ' : 'Bağlı: ') + pads[0]!.id.slice(0, 50) : de ? 'Kein Controller erkannt – einstecken und eine Taste drücken.' : 'Kol bulunamadı – tak ve bir tuşa bas.'),
    h('table', { class: 'padhelp' }, PAD_HELP().map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b)))),
  );
}

// ------------------------------------------------------------------ Kahvehane

function enterCafe() {
  bgm.set('cafe');
  inCafe = true;
  document.body.classList.add('incafe');
  const menu = ui.querySelector('.menu') as any;
  menu?._pv?.dispose();
  ui.innerHTML = '';
  chatLog = [];
  if (settings.showKeyHints) addLog(h('div', { class: 'sys' }, touchActive() ? (getLang() === 'de' ? 'Links: Joystick zum Laufen · rechts wischen: umschauen · Stuhl antippen: hinsetzen' : 'Sol: yürü · sağda kaydır: etrafa bak · sandalyeye dokun: otur') : t('walkHint')));
  world.setSelf(profile.avatar, profile.name || 'Oyuncu');
  world.onChair = (seat, spot) => {
    if (!table) return;
    if (spot !== (table.spot ?? 0)) {
      // anderer Tisch: vor dem Spielstart zieht die ganze Runde um
      if (table.started) return toast(getLang() === 'de' ? 'Das Spiel läuft – Tischwechsel erst danach' : 'Oyun sürüyor – masa sonra değişir');
      send({ type: 'setSpot', spot });
      toast(`🪑 ${getLang() === 'de' ? SPOTS[spot].de : SPOTS[spot].tr}`, '#2d5a3a');
      if (you.seat === null || you.seat !== seat) {
        if (!table.seats[seat]) send({ type: 'sit', seat });
      } else world.sitAt(seat);
      return;
    }
    if (you.seat === seat) {
      world.sitAt(seat);
      renderAll();
      return;
    }
    const occ = table.seats[seat];
    if (you.seat === null) {
      // Zuschauer: Bot ablösen (laufendes Spiel) oder zuschauen
      if (table.started && occ?.bot) {
        if (myWantSeat() === seat) send({ type: 'cancelSeat' });
        else send({ type: 'sit', seat });
      } else {
        send({ type: 'watch', seat });
        if (world.lounge) send({ type: 'lounge', spot: null });
        world.sitAt(null);
        watchAt(seat);
      }
      return;
    }
    if (!occ && !table.started) send({ type: 'sit', seat });
    else if (you.seat !== null) {
      world.sitAt(you.seat);
      renderAll();
    }
  };
  world.onDrawDragStart = (kind, e) => {
    if (!myTurn('draw') || !st) return false;
    const left = st.topDiscards[(you.seat! + 3) % 4];
    if (kind === 'side' && (!left || st.view.okeyBirTile)) return false;
    const ghost = kind === 'side' ? tileElement(left, st.okey) : h('div', { class: 'tile back' });
    istaka.externalDrag(ghost, e, (slot, moved, x, y) => {
      if (!moved) return; // war nur ein Klick → normales Ziehen per Klick
      world.suppressClick = true;
      setTimeout(() => (world.suppressClick = false), 60);
      if (slot === null) return;
      istaka.pendingSlot = slot;
      istaka.flyFrom = { x, y };
      act({ action: kind === 'pile' ? 'drawPile' : 'drawDiscard' });
    });
    return true;
  };
  world.onLounge = (k) => sitLounge(k);
  world.onTavla = (k) => tavlaClick(k);
  world.onLoungeStand = () => sitLounge(null);
  world.onPile = () => act({ action: 'drawPile' });
  world.onSide = () => act({ action: 'drawDiscard' });
  world.onMeld = (index) => {
    const ids = [...istaka.selected];
    if (!ids.length) return toast(t('selectMeld'));
    act({ action: 'layoff', meldIndex: index, tileIds: ids });
  };
  istaka.zoneAt = (x, y) => world.dropZoneAt(x, y);
  istaka.onZoneHover = (z) => world.showZones(z);
  istaka.canDiscard = () => myTurn('discard');
  world.onFocusChange = () => renderFocusBadge();
  world.onTvWatch = (i) => {
    document.body.classList.toggle('tv-watch', i !== null);
    document.querySelector('.tv-exit')?.remove();
    if (i === null) return;
    closeOverlays();
    const de = getLang() === 'de';
    const b = h('button', { class: 'tv-exit', onclick: (e: Event) => (e.stopPropagation(), world.watchTv(null)) }, de ? '✕ Zurück (Esc)' : '✕ Geri (Esc)');
    document.body.append(b);
  };
  world.onLookChange = () => renderHint();
  istaka.onDropZone = (zone, id) => {
    if (zone === 'discard') act({ action: 'discard', tileId: id });
    else if (zone === 'finish') tryFinish(id);
  };
  istaka.onChange = () => renderActions();
  let layoutTimer = 0;
  istaka.onLayout = (slots) => {
    clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => you.seat !== null && st && send({ type: 'layout', slots }), 400);
  };
  renderAll();
}

// ------------------------------------------------------------------ Zuschauer

const isSpectator = () => !!table && you.seat === null;
const meSpect = () => table?.spectators.find((s) => s.id === myId);
const myWantSeat = () => meSpect()?.wantSeat ?? null;
/** Spiel-Anzeige (Istaka/Karten/Punkte) für Zuschauer ausgeblendet? */
function spectHud(): boolean {
  if (!isSpectator()) return true;
  if (settings.spectHide) return false;
  return !(world.lounge ?? '').startsWith('tv');
}
function sitLounge(k: string | null) {
  if (!table || you.seat !== null) return;
  if (k && table.spectators.some((s) => s.id !== myId && s.lounge === k)) {
    toast(getLang() === 'de' ? 'Da sitzt schon jemand' : 'Orada biri oturuyor');
    return;
  }
  send({ type: 'lounge', spot: k });
  if (k) world.sitLounge(k);
  else {
    world.sitLounge(null);
    world.sitAt(null);
  }
  renderAll();
}
function freeLounge(prefix: 'tv' | 'c'): string | null {
  const keys = prefix === 'tv' ? ['tv0', 'tv1'] : ['c0', 'c1', 'c2', 'c3'];
  if (world.lounge?.startsWith(prefix)) return world.lounge;
  return keys.find((k) => !table!.spectators.some((s) => s.id !== myId && s.lounge === k)) ?? null;
}
/** Leiste für Zuschauer: Spiel verfolgen, Fernseher, Ecke, aufstehen, Steine ausblenden, mitspielen */
function renderSpect() {
  const el = slot('spect', 'spect-bar');
  if (!isSpectator()) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = '';
  const de = getLang() === 'de';
  const following = world.seated !== null;
  const lg = world.lounge;
  const btn = (on: boolean, icon: string, label: string, title: string, fn: () => void) => h('button', { class: 'small ' + (on ? 'primary' : 'ghost'), title, onclick: fn }, icon, h('span', { class: 'lbl' }, ' ' + label));
  const want = myWantSeat();
  const g = st?.view;
  const midHand = !!table!.started && !!g && g.phase !== 'handOver' && g.phase !== 'gameOver' && !g.gameOver;
  appendAll(
    el,
    h('span', { class: 'muted spect-title' }, '👁 ' + (de ? 'Zuschauer' : 'İzleyici')),
    table!.started
      ? btn(following, '🎴', de ? 'Mitschauen' : 'Takip et', de ? 'Spiel verfolgen (am Platz eines Spielers)' : 'Oyunu takip et', () => {
          if (lg) send({ type: 'lounge', spot: null });
          const s = you.watching ?? 0;
          send({ type: 'watch', seat: s });
          watchAt(s);
        })
      : null,
    btn(!!lg?.startsWith('tv'), '📺', de ? 'Fernseher' : 'Televizyon', de ? 'Vor den Fernseher setzen' : 'Televizyonun önüne otur', () => {
      const k = freeLounge('tv');
      if (!k) return toast(de ? 'Beide Stühle am Fernseher sind besetzt' : 'TV önündeki sandalyeler dolu');
      sitLounge(k);
    }),
    btn(!!lg?.startsWith('c'), '🪑', de ? 'Ecke' : 'Köşe', de ? 'In die Ecke zwischen zwei Spieler setzen (nochmal = nächste Ecke)' : 'İki oyuncunun arasına otur (tekrar = sonraki köşe)', () => {
      if (lg?.startsWith('c')) {
        // nochmal = nächste Ecke
        const keys = ['c0', 'c1', 'c2', 'c3'];
        const start = keys.indexOf(lg);
        for (let i = 1; i <= 4; i++) {
          const k = keys[(start + i) % 4];
          if (!table!.spectators.some((s) => s.id !== myId && s.lounge === k)) return sitLounge(k);
        }
        return;
      }
      const k = freeLounge('c');
      if (!k) return toast(de ? 'Alle Ecken sind besetzt' : 'Tüm köşeler dolu');
      sitLounge(k);
    }),
    following || lg ? btn(false, '🚶', de ? 'Aufstehen' : 'Kalk', de ? 'Aufstehen und herumlaufen' : 'Kalk ve dolaş', () => sitLounge(null)) : null,
    table!.started
      ? btn(settings.spectHide, '🙈', settings.spectHide ? (de ? 'Spiel einblenden' : 'Oyunu göster') : de ? 'Spiel ausblenden' : 'Oyunu gizle', settings.spectHide ? (de ? 'Steine/Karten wieder einblenden' : 'Taşları/kartları göster') : de ? 'Steine/Karten ausblenden – nur im Raum sein' : 'Taşları/kartları gizle – sadece odada ol', () => {
          settings.spectHide = !settings.spectHide;
          saveSettings();
          renderAll();
        })
      : null,
    want !== null
      ? h(
          'span',
          { class: 'spect-want' },
          (de ? `⏳ Nach der Runde: Platz von ${nameOf(want)}` : `⏳ El bitince: ${nameOf(want)} yeri`) + ' ',
          h('button', { class: 'small ghost', title: de ? 'Abbrechen' : 'Vazgeç', onclick: () => send({ type: 'cancelSeat' }) }, '✕'),
        )
      : table!.started && table!.seats.some((p) => p?.bot)
        ? h(
            'button',
            {
              class: 'small',
              title: de ? 'Einen Bot ablösen' : 'Bir botun yerine geç',
              onclick: () => {
                const bots = table!.seats.map((p, s) => (p?.bot ? s : -1)).filter((s) => s >= 0);
                if (bots.length === 1) return send({ type: 'sit', seat: bots[0] });
                popupMenu(de ? 'Welchen Platz übernehmen?' : 'Hangi yere geçeceksin?', bots.map((s) => ({ label: '🤖 ' + nameOf(s), fn: () => send({ type: 'sit', seat: s }) })));
              },
            },
            '🎲',
            h('span', { class: 'lbl' }, ' ' + (de ? (midHand ? 'Mitspielen (nach der Runde)' : 'Mitspielen') : midHand ? 'Oyna (el bitince)' : 'Oyna')),
          )
        : null,
  );
}

function watchAt(seat: number) {
  // Zuschauer schaut aus Sicht des Spielers mit
  world.sitAt(seat);
  renderAll();
}

function leaveCafe() {
  inCafe = false;
  document.body.classList.remove('incafe');
  table = null;
  st = null;
  sessionStorage.removeItem('tableCode');
  voice.leaveAll();
  world.setGame(null);
  world.setPlayers([null, null, null, null], null);
  istaka.clear();
  applyMedia();
  showMenu();
}

function act(m: any) {
  // Pişti kennt nur „play“ und „respond“ (Okey-Tasten ignorieren)
  if (st?.view?.kind === 'pisti' && m.action !== 'play' && m.action !== 'respond') return;
  if (st?.view?.kind === 'batak' && !['bid', 'trump', 'bury', 'play'].includes(m.action)) return;
  if (m.action === 'drawPile' && !istaka.flyFrom) istaka.flyFrom = world.screenOf('pile');
  if (m.action === 'drawDiscard' && !istaka.flyFrom) istaka.flyFrom = world.screenOf('side');
  send({ type: 'action', ...m });
  if (m.action === 'discard' || m.action === 'finish' || m.action === 'okeyBir') istaka.selected.clear();
}

/** Beenden nur mit fertiger Hand und nach Bestätigung (nie aus Versehen) */
function tryFinish(id: number) {
  if (st?.view?.kind === 'pisti' || st?.view?.kind === 'batak') return;
  if (!st || !myTurn('discard')) return;
  const de = getLang() === 'de';
  const v = st.view;
  const rest = v.myHand.filter((x: any) => x.id !== id);
  const r = table!.rules;
  let ok = true;
  if (r.mode !== 'okey101') ok = rest.length === 14 && (isCompleteMelds(rest, st.okey) || isCompletePairs(rest, st.okey, v.indicator, r.indicatorPairsAnything));
  else ok = rest.length === 0;
  if (!ok) {
    toast(de ? '✋ Deine Hand ist noch nicht fertig – der Stein bleibt bei dir.' : '✋ Elin henüz bitmedi – taş sende kalıyor.');
    return;
  }
  // wie am echten Tisch: Brett muss richtig umgestellt sein (Lücken zwischen den Perlern)
  if (r.mode !== 'okey101' && !rackIsFinished(istaka.slots, rest, st.okey, v.indicator, r.indicatorPairsAnything)) {
    toast(
      de
        ? '✋ Deine Hand ist fertig, aber noch nicht richtig umgestellt: lege jede Reihe/Gruppe (oder die Paare) mit Lücke getrennt aufs Brett.'
        : '✋ Elin bitti ama dizilmemiş: her perini (ya da çiftleri) istakaya aralıklı diz.',
      '#7a4a1a',
    );
    return;
  }
  const tile = v.myHand.find((x: any) => x.id === id);
  const label = tile ? (tile.fake ? '★' : `${tile.value}`) : '';
  popupMenu(de ? `🏁 Mit diesem Stein (${label}) beenden?` : `🏁 Bu taşla (${label}) bitiriyor musun?`, [
    { label: de ? '✓ Ja, beenden!' : '✓ Evet, bitir!', fn: () => act({ action: 'finish', tileId: id, slots: [...istaka.slots] }) },
    { label: de ? '✗ Nein, weiterspielen' : '✗ Hayır, devam', fn: () => {} },
  ]);
}

function myTurn(phase?: 'draw' | 'discard') {
  if (!st || you.seat === null) return false;
  const v = st.view;
  return v.current === you.seat && (!phase || v.phase === phase);
}

// ------------------------------------------------------------------ Rendering

const els: Record<string, HTMLElement> = {};
function slot(name: string, cls: string) {
  if (!els[name] || !els[name].isConnected) {
    els[name] = h('div', { class: cls });
    ui.append(els[name]);
  }
  return els[name];
}

function renderAll() {
  if (!inCafe || !table) return;
  renderLeft();
  renderRight();
  renderChat();
  renderLobby();
  renderGame();
  renderSheet();
  renderHint();
  renderSpect();
  // Ergebnis + Zettel gleichzeitig offen → nebeneinander statt übereinander
  const resOpen = !!document.querySelector('.result.panel:not(.hidden)');
  const sheetVis = !!document.querySelector('.sheet:not(.hidden)');
  document.body.classList.toggle('result-sheet', resOpen && sheetVis);
}

function renderFocusBadge() {
  const el = slot('focus', 'focusbadge');
  const show = inCafe && world.seated !== null && settings.showKeyHints;
  el.classList.toggle('hidden', !show);
  const L = keyLabel(settings.keys.look);
  const Z = keyLabel(settings.keys.zoom);
  el.textContent = world.focus
    ? getLang() === 'de'
      ? `🎯 Blick aufs Brett · ${L} = umschauen · ${Z} halten = Zoom`
      : `🎯 Masaya odaklı · ${L} = etrafa bak · ${Z} basılı = yakınlaştır`
    : getLang() === 'de'
      ? `👀 Umschauen mit der Maus · Brett anvisieren + Klick oder ${L} = zurück · ${Z} = Zoom`
      : `👀 Fareyle etrafa bak · masaya nişan al + tıkla ya da ${L} = geri · ${Z} = yakınlaştır`;
  if (touchActive()) el.textContent = world.focus ? (getLang() === 'de' ? '🎯 Brett · 👁 = umschauen · Stein antippen = wählen, doppelt = umdrehen, ziehen = werfen' : '🎯 Masa · 👁 = etrafa bak · taşa dokun = seç, çift = çevir, sürükle = at') : getLang() === 'de' ? '👀 Wischen = umschauen · Brett antippen = zurück' : '👀 Kaydır = etrafa bak · masaya dokun = geri';
  else if (world.focus && settings.showKeyHints && table?.started) el.append(h('div', { class: 'keyline' }, keyHintLine()));
}

function renderHint() {
  renderFocusBadge();
  const el = slot('hint', 'hint');
  const cross = slot('cross', 'crosshair');
  const walking = world.seated === null;
  const looking = world.isLooking();
  cross.classList.toggle('hidden', !looking);
  el.classList.toggle('hidden', !walking || !settings.showKeyHints);
  const K = settings.keys;
  const mv = [K.forward, K.left, K.back, K.right].map(keyLabel).join('');
  if (touchActive()) {
    el.textContent = getLang() === 'de' ? 'Joystick: laufen · Wischen: umschauen · Stuhl antippen: hinsetzen · 🎥 halten: dich selbst sehen' : 'Joystick: yürü · kaydır: etrafa bak · sandalyeye dokun: otur · 🎥 basılı: kendini gör';
    return;
  }
  el.textContent = looking
    ? getLang() === 'de'
      ? `Maus: umschauen · ${mv}: laufen · Stuhl anvisieren + Klick: hinsetzen · Esc: Mauszeiger`
      : `Fare: etrafa bak · ${mv}: yürü · Sandalyeye nişan al + tıkla: otur · Esc: imleç`
    : getLang() === 'de'
      ? 'Ins Bild klicken, um dich mit der Maus umzuschauen'
      : 'Fareyle etrafa bakmak için ekrana tıkla';
}

function renderLeft() {
  const el = slot('left', 'hud-left panel');
  el.innerHTML = '';
  el.classList.toggle('compact', settings.hudCompact);
  const isOwner = table!.ownerId === myId;
  const fold = h(
    'button',
    {
      class: 'small ghost fold',
      title: getLang() === 'de' ? 'ein-/ausklappen' : 'aç/kapa',
      onclick: () => {
        if (settings.hudCompact) closeOverlays('left');
        settings.hudCompact = !settings.hudCompact;
        saveSettings();
        renderLeft();
      },
    },
    settings.hudCompact ? '▸' : '▾',
  );
  if (settings.hudCompact) {
    el.append(
      h(
        'div',
        { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } },
        fold,
        h('div', { class: 'code small-code', title: 'Copy', onclick: () => (navigator.clipboard?.writeText(table!.code), toast(t('copied'), '#2d5a3a')) }, table!.code + ' 📋'),
        // Handy: Einstellungen immer direkt erreichbar (nicht nur im Chat-Menü)
        document.body.classList.contains('phone') ? h('button', { class: 'small ghost gear', title: getLang() === 'de' ? 'Einstellungen' : 'Ayarlar', onclick: () => openSettings() }, '⚙️') : null,
      ),
    );
    return;
  }
  el.append(
    fold,
    h('div', { class: 'muted' }, t('invite')),
    h(
      'div',
      { class: 'code', title: 'Copy', onclick: () => (navigator.clipboard?.writeText(table!.code), toast(t('copied'), '#2d5a3a')) },
      table!.code + ' 📋',
    ),
    h(
      'div',
      { class: 'row', style: { margin: '6px 0' } },
      isOwner
        ? h('button', { class: 'small ghost', onclick: () => send({ type: 'setPublic', isPublic: !table!.isPublic }) }, table!.isPublic ? '🌐 ' + t('publicTable') : '🔒 ' + t('privateTable'))
        : h('span', { class: 'muted' }, table!.isPublic ? '🌐 ' + t('publicTable') : '🔒 ' + t('privateTable')),
      h('button', { class: 'small ghost', onclick: () => openFriends() }, '👥 ' + (getLang() === 'de' ? 'Einladen' : 'Davet et') + (pendingCount() ? ` (${pendingCount()})` : '')),
    ),
    h(
      'div',
      { class: 'row', style: { margin: '0 0 6px' } },
      world.seated !== null && !table!.started && you.seat !== null ? h('button', { class: 'small ghost', onclick: () => (world.sitAt(null), renderAll()) }, '🚶 ' + t('leave')) : null,
      h('button', { class: 'small danger', onclick: () => send({ type: 'leaveTable' }) }, '🚪 ' + t('back')),
    ),
  );
  const people = h('div', { class: 'people' });
  table!.seats.forEach((p, s) => {
    if (!p) return;
    const isMe = p.id === myId;
    people.append(
      h(
        'div',
        { class: 'p' },
        h('span', {}, voiceDot(p.id, isMe), `${(table!.rules.mode === 'pisti' && table!.rules.pistiPlayers === 2 ? s === 0 : s % 2 === 0) ? '🔵' : '🔴'} ${p.name}${p.bot ? ' 🤖' : ''}${p.id === table!.ownerId ? ' 👑' : ''}${isMe ? (getLang() === 'de' ? ' (du)' : ' (sen)') : ''}`),
        h(
          'span',
          { class: 'row', style: { gap: '4px' } },
          !isMe && !p.bot ? h('button', { class: 'small ghost', title: 'Mute', onclick: () => (voice.setMuted(p.id, !voice.isMuted(p.id)), renderLeft()) }, voice.isMuted(p.id) ? '🔇' : '🔊') : null,
          // Zuschauer: Platz eines Bots übernehmen (laufendes Spiel)
          you.seat === null && p.bot && table!.started ? h('button', { class: 'small', title: getLang() === 'de' ? 'Platz übernehmen' : 'Yerine otur', onclick: () => send({ type: 'sit', seat: s }) }, '🪑') : null,
          isOwner && !isMe && !p.bot
            ? h(
                'button',
                {
                  class: 'small ghost',
                  title: getLang() === 'de' ? 'Tischbesitz abgeben' : 'Masa sahipliğini devret',
                  onclick: () =>
                    popupMenu(getLang() === 'de' ? `👑 ${p.name} zum Tischbesitzer machen?` : `👑 ${p.name} masa sahibi olsun mu?`, [
                      { label: getLang() === 'de' ? '✓ Ja, abgeben' : '✓ Evet, devret', fn: () => send({ type: 'giveOwner', id: p.id }) },
                      { label: getLang() === 'de' ? '✗ Abbrechen' : '✗ Vazgeç', fn: () => {} },
                    ]),
                },
                '👑',
              )
            : null,
          isOwner && !isMe && !p.bot ? h('button', { class: 'small danger', onclick: () => send({ type: 'kick', id: p.id }) }, '✕') : null,
        ),
      ),
    );
  });
  if (table!.spectators.length) {
    people.append(h('div', { class: 'muted', style: { marginTop: '6px' } }, t('spectators')));
    for (const sp of table!.spectators)
      people.append(
        h(
          'div',
          { class: 'p' },
          h('span', {}, '👁 ' + sp.name + (sp.id === myId ? ' (sen)' : '')),
          sp.id !== myId ? h('button', { class: 'small ghost', onclick: () => (voice.setMuted(sp.id, !voice.isMuted(sp.id)), renderLeft()) }, voice.isMuted(sp.id) ? '🔇' : '🔊') : null,
        ),
      );
  }
  el.append(people);
}

let chatMenuPane: HTMLElement | null = null;
function renderRight() {
  const col = slot('right', 'hud-right');
  col.innerHTML = '';
  // PC: Symbol-Spalte links (Text als Tooltip) · Handy: dieselben Knöpfe nur im Chat-Menü (Tab „Menü“)
  const ph = document.body.classList.contains('phone');
  if (ph && (!chatMenuPane || !chatMenuPane.isConnected) && els.chat?.isConnected) {
    // Chat wurde noch ohne Menü-Tab gebaut → neu aufbauen (ruft renderRight selbst auf)
    els.chat.remove();
    renderChat();
    return;
  }
  const el = ph && chatMenuPane ? chatMenuPane : col;
  if (el !== col) el.innerHTML = '';
  const touch = document.body.classList.contains('touch');
  const L = (icon: string, _text: string) => icon;
  const de = getLang() === 'de';
  appendAll(el,
    // Touch am Platz: frei umschauen (früher eigener Knopf rechts)
    touch && you.seat !== null && world.seated !== null
      ? h('button', { class: 'small' + (!world.focus && world.freeLook ? ' primary' : ''), title: de ? 'Frei umschauen' : 'Serbest bak', onclick: () => ((world.focus || !world.freeLook ? world.setFocus(false, true) : world.setFocus(true)), renderRight()) }, '👁')
      : null,
    h('button', { class: 'small', title: t('tv') + ' / ' + t('music'), onclick: () => openMedia() }, '📺'),
    radioChip(),
    muteButton(),
    h(
      'button',
      {
        class: 'small ' + (settings.showKeyHints ? 'primary' : 'ghost'),
        title: getLang() === 'de' ? 'Bedienhinweise ein/aus' : 'İpuçları aç/kapa',
        onclick: () => {
          settings.showKeyHints = !settings.showKeyHints;
          saveSettings();
          renderRight();
          renderHint();
        },
      },
      '❔',
    ),
    h(
      'button',
      {
        class: 'small mic-btn ' + (voice.micOn ? 'primary' : ''),
        onclick: async () => {
          try {
            await voice.enableMic(!voice.micOn);
          } catch (e: any) {
            toast(e.message);
          }
          renderRight();
        },
      },
      L('🎙️', voice.micOn ? t('voiceOn') : t('voiceOff')),
    ),
    table!.started ? h('button', { class: 'small', title: t('sheet'), onclick: () => ((sheetOpen = !sheetOpen), renderAll()) }, L('📝', t('sheet'))) : null,
    // am PC gibt es keine Touch-Knöpfe rechts → Chat, Çaycı, Emotes hier
    !touch ? h('button', { class: 'small', title: 'Chat (Enter)', onclick: () => setChatOpen(!els.chat?.classList.contains('open')) }, '💬') : null,
    !touch && you.seat !== null ? h('button', { class: 'small', title: de ? 'Ahmet rufen (K)' : 'Ahmet (K)', onclick: () => openCayci() }, '☕') : null,
    !touch && you.seat !== null ? h('button', { class: 'small', title: 'Emotes (E)', onclick: () => openWheelEmotes() }, '😊') : null,
    !touch && you.seat !== null ? h('button', { class: 'small', title: 'Nargile', onclick: () => sendEmote('nargile') }, '💨') : null,
    h('button', { class: 'small ghost', title: de ? 'Einstellungen' : 'Ayarlar', onclick: () => openSettings() }, '⚙️'),
    ph && !isApp() ? h('button', { class: 'small ghost', title: de ? 'Vollbild' : 'Tam ekran', onclick: () => (document.querySelector('.fsbtn') as HTMLButtonElement | null)?.click() }, '⛶') : null,
  );
  if (el !== col) {
    // im Menü mit Beschriftung
    el.querySelectorAll(':scope > *').forEach((b) => {
      const tt = (b as HTMLElement).title || (b.classList.contains('mic-btn') ? (voice.micOn ? t('voiceOn') : t('voiceOff')) : b.classList.contains('radio') ? 'Radyo' : '');
      if (tt) b.append(h('span', { class: 'cd-lbl' }, tt));
    });
  }
}

function renderChat() {
  let el = els.chat;
  if (el && el.isConnected) return;
  el = slot('chat', 'chat drawer');
  const de = getLang() === 'de';
  const log = h('div', { class: 'log' }, chatLog);
  const input = h('input', { placeholder: t('chat') + '…', maxLength: 200 });
  const sendChat = () => {
    if (input.value.trim()) send({ type: 'chat', text: input.value });
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (!input.value.trim()) return input.blur();
      sendChat();
    }
    if (e.key === 'Escape') {
      input.blur();
      setChatOpen(false);
    }
  });
  const quick = h(
    'div',
    { class: 'quick' },
    ['hadi', 'okeyBende', 'caylar', 'buElBizim', 'yazik', 'helal', 'tesekkur', 'gecmisOlsun'].map((k) => h('button', { onclick: () => send({ type: 'quick', key: k }) }, t('q_' + k))),
  );
  const emotes = h(
    'div',
    { class: 'emotegrid' },
    ['slam', 'tea', 'nargile', 'headshake', 'rubhands', 'tespih'].map((k) => h('button', { onclick: () => sendEmote(k) }, t('e_' + k))),
    ['wink', 'blink', 'wide'].map((k) => h('button', { onclick: () => send({ type: 'eye', key: k }) }, '👁 ' + t('eye_' + k).replace(/ \(\d\)/, ''))),
  );
  const chatPane = h('div', { class: 'cd-pane' }, h('div', { class: 'cd-main' }, log, quick), h('div', { class: 'cd-input' }, input, h('button', { class: 'primary', onclick: sendChat }, t('send'))));
  const emotePane = h('div', { class: 'cd-pane hidden' }, emotes);
  const phone = document.body.classList.contains('phone');
  const menuPane = h('div', { class: 'cd-pane hidden' }, h('div', { class: 'cd-menu' }));
  chatMenuPane = phone ? (menuPane.firstChild as HTMLElement) : null;
  const panes = [chatPane, emotePane, ...(phone ? [menuPane] : [])];
  const tabBtn = (label: string, pane: HTMLElement) => {
    const b = h('button', {
      class: 'cd-tab',
      onclick: () => {
        panes.forEach((p) => p.classList.toggle('hidden', p !== pane));
        el!.querySelectorAll('.cd-tab').forEach((x) => x.classList.toggle('on', x === b));
      },
    }, label);
    return b;
  };
  const t1 = tabBtn('💬 ' + (de ? 'CHAT' : 'SOHBET'), chatPane);
  const t2 = tabBtn('😊 ' + (de ? 'EMOTES' : 'HAREKET'), emotePane);
  const t3 = phone ? tabBtn('☰ ' + (de ? 'MENÜ' : 'MENÜ'), menuPane) : null;
  t1.classList.add('on');
  el.append(h('div', { class: 'cd-head' }, t1, t2, t3, h('button', { class: 'cd-close', title: 'Esc', onclick: () => setChatOpen(false) }, '✕')), ...panes);
  log.scrollTop = log.scrollHeight;
  if (phone) renderRight();
}

/** Chat-Seitenleiste öffnen/schließen (schließt andere Fenster) */
function setChatOpen(open: boolean) {
  if (open) closeOverlays('chat');
  els.chat?.classList.toggle('open', open);
  document.body.classList.toggle('chat-open', open);
  const log = els.chat?.querySelector('.log');
  if (open && log) log.scrollTop = log.scrollHeight;
  if (!open) (els.chat?.querySelector('input') as HTMLInputElement | null)?.blur();
}

/** Immer nur ein Fenster/Menü gleichzeitig: alles andere zu */
function closeOverlays(keep?: 'chat' | 'menu' | 'wheel' | 'left' | 'modal') {
  if (keep !== 'chat') {
    els.chat?.classList.remove('open');
    document.body.classList.remove('chat-open');
  }
  if (keep !== 'menu') closeMenu();
  if (keep !== 'wheel') closeWheel();
  if (keep !== 'modal') ui.querySelectorAll(':scope > .modal').forEach((m) => m.remove());
  if (keep !== 'left' && !settings.hudCompact && inCafe && table) {
    settings.hudCompact = true;
    saveSettings();
    renderLeft();
  }
}

// Steuerung ohne Maus: Tastenkürzel, Controller, Touch
const ORDER_LABELS: Record<OrderItem, [string, string]> = {
  cay: ['🫖 Çay', '🫖 Çay (Tee)'],
  icecek: ['🥤 İçecek (sürpriz)', '🥤 Softdrink (zufällig)'],
  kahve: ['☕ Türk kahvesi', '☕ Türkischer Kaffee'],
  kuruyemis: ['🥜 Kuruyemiş', '🥜 Kuruyemiş (Nüsse)'],
  su: ['💧 Su', '💧 Su (Wasser)'],
  oralet: ['🍊 Oralet', '🍊 Oralet (Orangentee)'],
  sahlep: ['🥛 Sahlep', '🥛 Sahlep (heiße Milch, Zimt)'],
};
function orderLabel(i: OrderItem) {
  return ORDER_LABELS[i]?.[getLang() === 'de' ? 1 : 0] ?? i;
}
function needTile(): number | null {
  const id = istaka.actionTile();
  if (id === null) toast(getLang() === 'de' ? 'Erst einen Stein wählen (Pfeiltasten / Klick)' : 'Önce bir taş seç (ok tuşları / tık)');
  return id;
}
const controlsApi: any = {
  inCafe: () => inCafe,
  seated: () => you.seat !== null && world.seated === you.seat,
  started: () => !!table?.started && !!st,
  drawPile: () => myTurn('draw') && act({ action: 'drawPile' }),
  drawSide: () => myTurn('draw') && act({ action: 'drawDiscard' }),
  discard: () => {
    if (!myTurn('discard')) return;
    const id = needTile();
    if (id !== null) act({ action: 'discard', tileId: id });
  },
  finish: () => {
    if (!myTurn('discard')) return;
    const id = needTile();
    if (id !== null) tryFinish(id);
  },
  indicator: () => act({ action: 'showIndicator' }),
  okeyBir: () => {
    if (table?.rules.mode !== 'perisan' || !myTurn('discard')) return;
    const id = needTile();
    if (id !== null) act({ action: 'okeyBir', tileId: id });
  },
  sortRuns: () => !table?.rules.hardMode && istaka.sortRuns(),
  sortPairs: () => !table?.rules.hardMode && istaka.sortPairs(),
  emote: (k) => sendEmote(k),
  eye: (k) => send({ type: 'eye', key: k }),
  openCayci,
  openQuick: () =>
    popupMenu(
      '💬 ' + (getLang() === 'de' ? 'Sprüche' : 'Hazır sözler'),
      ['hadi', 'okeyBende', 'caylar', 'buElBizim', 'yazik', 'helal', 'tesekkur', 'gecmisOlsun'].map((k) => ({ label: t('q_' + k), fn: () => send({ type: 'quick', key: k }) })),
    ),
  openEmotes: () => {
    if (wheelIsOpen()) return closeWheel();
    closeOverlays('wheel');
    const de = getLang() === 'de';
    const e = (icon: string, k: string) => ({ icon, label: t('e_' + k), fn: () => sendEmote(k) });
    const y = (icon: string, k: string) => ({ icon, label: t('eye_' + k).replace(/ \(\d\)/, ''), fn: () => send({ type: 'eye', key: k }) });
    openWheel([
      e('🫖', 'tea'),
      e('💨', 'nargile'),
      e('✊', 'slam'),
      e('📿', 'tespih'),
      e('🙅', 'headshake'),
      e('🤲', 'rubhands'),
      y('😉', 'wink'),
      y('😵', 'blink'),
      y('😳', 'wide'),
      { icon: '☕', label: de ? 'Ahmet rufen' : 'Ahmet’i çağır', fn: () => openCayci() },
    ]);
  },
  focusChat: () => {
    setChatOpen(true);
    settings.hideChat = false;
    saveSettings();
    els.chat?.classList.remove('collapsed');
    (els.chat?.querySelector('input') as HTMLInputElement | null)?.focus();
  },
  toggleChat: () => setChatOpen(!els.chat?.classList.contains('open')),
  toggleMic: async () => {
    try {
      unlockAudio();
      await voice.enableMic(!voice.micOn);
      toast(voice.micOn ? (getLang() === 'de' ? '🎙️ Mikro an' : '🎙️ Mikrofon açık') : getLang() === 'de' ? '🔇 Mikro aus' : '🔇 Mikrofon kapalı', '#2d5a3a');
    } catch (e: any) {
      toast(e.message);
    }
    renderRight();
  },
  micOn: () => !!voice.micOn,
  toggleSheet: () => {
    if (!table?.started) return;
    sheetOpen = !sheetOpen;
    renderAll();
  },
  openMedia: () => table && openMedia(),
  escape: () => {
    closeMenu();
    if (world.seated !== null && table && !table.started) {
      world.sitAt(null);
      renderAll();
    }
  },
};
setupControls(world, istaka, controlsApi);

function openWheelEmotes() {
  controlsApi.openEmotes();
}
const CAYCI_TITLE = () => '🫖 ' + (getLang() === 'de' ? 'Ahmet rufen – was darf es sein?' : 'Ahmet! Ne alırsın?');
/** gleicher Abstand wie auf dem Server */
const ORDER_GAP_MS = 45_000;
let lastOrderAt = 0;
function orderWaitToast(secs: number) {
  toast(getLang() === 'de' ? `🫖 Ahmet ist noch unterwegs – in ${secs} s kannst du wieder bestellen` : `🫖 Ahmet yolda – ${secs} sn sonra tekrar söyleyebilirsin`);
}
function openCayci() {
  // nochmal drücken = wieder zu (ohne zu bestellen)
  if (menuIsOpen(CAYCI_TITLE())) return closeMenu();
  closeOverlays('menu');
  if (you.seat === null) {
    return toast(getLang() === 'de' ? 'Setz dich erst an den Tisch – Ahmet bringt es dann' : 'Önce masaya otur – Ahmet getirsin');
  }
  const left = ORDER_GAP_MS - (Date.now() - lastOrderAt);
  if (left > 0) return orderWaitToast(Math.ceil(left / 1000));
  sfx.spoon();
  popupMenu(
    CAYCI_TITLE(),
    (() => {
      // bis zu 3 Sachen für sich selbst ankreuzen, dann bestellen
      const pick: OrderItem[] = [];
      const de = getLang() === 'de';
      return [
        ...ORDER_ITEMS.map((i) => ({
          label: orderLabel(i),
          keep: true,
          on: () => pick.includes(i),
          dyn: () => (pick.includes(i) ? '✅ ' : '') + orderLabel(i),
          fn: () => {
            const k = pick.indexOf(i);
            if (k >= 0) pick.splice(k, 1);
            else if (pick.length >= 3) toast(de ? 'Höchstens 3 Sachen pro Bestellung' : 'Bir seferde en fazla 3 şey');
            else pick.push(i);
          },
        })),
        {
          label: '',
          keep: true,
          dyn: () => (pick.length ? `🛎️ ${de ? 'Bestellen' : 'Sipariş ver'} (${pick.length}/3)` : `🛎️ ${de ? 'Bis zu 3 Sachen ankreuzen' : 'En fazla 3 şey seç'}`),
          fn: () => {
            if (!pick.length) return;
            lastOrderAt = Date.now();
            send({ type: 'order', items: [...pick] });
            closeMenu();
          },
        },
      ];
    })(),
  );
}

// ------------------------------------------------------------------ Lobby + Regeln

function renderLobby() {
  const show = !table!.started && world.seated !== null;
  const el = slot('lobby', 'lobby panel');
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const isOwner = table!.ownerId === myId;
  const r = table!.rules;
  el.innerHTML = '';
  appendAll(el, h('h2', {}, '🀄 ' + t('rules')), isOwner ? null : h('div', { class: 'muted', style: { marginBottom: '8px' } }, t('onlyOwner')));
  // Plätze
  const seats = h('div', { class: 'seats' });
  const pistiDuo = (r.mode === 'pisti' && r.pistiPlayers === 2) || r.mode === 'tavla';
  const batakSolo = r.mode === 'batak' && r.batakMode !== 'esli';
  const gommeli3 = r.mode === 'batak' && r.batakMode === 'gommeli';
  table!.seats.forEach((p, s) => {
    if (gommeli3 && s === 3) {
      seats.append(h('div', { class: 'seat off' }, h('div', { class: 'muted' }, '—'), h('span', { class: 'muted' }, getLang() === 'de' ? 'frei (zu dritt)' : 'boş (üç kişilik)')));
      return;
    }
    if (batakSolo) {
      seats.append(
        h(
          'div',
          { class: 'seat' },
          h('div', { class: 'muted' }, ['①', '②', '③', '④'][s]),
          h('b', {}, p ? p.name + (p.bot ? ' 🤖' : '') : t('empty')),
          !p && you.seat !== null ? h('button', { class: 'small ghost', onclick: () => send({ type: 'sit', seat: s }) }, t('sitHere')) : null,
          !p && isOwner && r.allowBots ? h('button', { class: 'small', onclick: () => send({ type: 'addBot', seat: s }) }, '🤖 ' + t('addBot')) : null,
          p?.bot && isOwner ? h('button', { class: 'small ghost', onclick: () => send({ type: 'removeBot', seat: s }) }, t('removeBot')) : null,
        ),
      );
      return;
    }
    if (pistiDuo && (s === 1 || s === 3)) {
      seats.append(h('div', { class: 'seat off' }, h('div', { class: 'muted' }, '—'), h('span', { class: 'muted' }, getLang() === 'de' ? 'frei (zu zweit)' : 'boş (iki kişilik)')));
      return;
    }
    seats.append(
      h(
        'div',
        { class: 'seat ' + ((pistiDuo ? s === 0 : s % 2 === 0) ? 'teamA' : 'teamB') },
        h('div', { class: 'muted' }, pistiDuo ? (s === 0 ? '①' : '②') : s % 2 === 0 ? t('teamA') : t('teamB')),
        h('b', {}, p ? p.name + (p.bot ? ' 🤖' : '') : t('empty')),
        !p && you.seat !== null ? h('button', { class: 'small ghost', onclick: () => send({ type: 'sit', seat: s }) }, t('sitHere')) : null,
        !p && isOwner && r.allowBots ? h('button', { class: 'small', onclick: () => send({ type: 'addBot', seat: s }) }, '🤖 ' + t('addBot')) : null,
        p?.bot && isOwner ? h('button', { class: 'small ghost', onclick: () => send({ type: 'removeBot', seat: s }) }, t('removeBot')) : null,
      ),
    );
  });
  el.append(seats);

  const set = (patch: any) => send({ type: 'setRules', rules: { ...r, ...patch } });
  const dis = !isOwner;
  const num = (key: string, label: string, min: number, max: number) =>
    h('label', {}, label, h('input', { type: 'number', min, max, value: r[key] ?? 0, disabled: dis, onchange: (e: Event) => set({ [key]: Number((e.target as HTMLInputElement).value) }) }));
  const chk = (key: string, label: string) =>
    h('label', {}, label, h('input', { type: 'checkbox', checked: !!r[key], disabled: dis, onchange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked }) }));

  const rules = h(
    'div',
    { class: 'rules' },
    modePicker(r.mode, dis),
  );
  if (r.mode === 'batak') {
    const de = getLang() === 'de';
    const info = () =>
      modal(
        h('h2', {}, 'ⓘ Batak'),
        h(
          'div',
          { class: 'col', style: { gap: '8px', lineHeight: '1.45' } },
          ...(de
            ? [
                'Ass ist die höchste Karte, dann K, D, B, 10 … 2.',
                'Farbe bedienen ist Pflicht – und wenn du kannst, musst du höher gehen.',
                'Hast du die Farbe nicht, musst du Koz (Trumpf) spielen – liegt schon Koz, musst du überstechen, wenn du kannst. Nur ohne Koz darfst du eine andere Farbe abwerfen.',
                'Ihale: Reihum sagt jeder, wie viele Stiche er macht (mind. das Mindestgebot), oder „Pas“. Wer am meisten bietet, wählt den Koz und spielt aus. Passen alle, bekommt der, der angefangen hat, die Ihale mit dem Mindestgebot.',
                'Schafft er sein Gebot: + Stiche. Sonst: minus Gebot (batık). Wer sonst keinen Stich macht, ist auch batık (einstellbar).',
                'Eşli: 2 gegen 2, die Karten vom Partner des Bieters liegen offen. Gömmeli: zu dritt, der Bieter nimmt 4 verdeckte Karten und legt 4 weg.',
              ]
            : [
                'En büyük kart As, sonra K, Q, J, 10 … 2.',
                'Yerdeki renge uymak zorunlu – ve varsa daha yüksek kart atmak zorunlu.',
                'Renk yoksa koz atmak zorunlu – yerde koz varsa yükseltmek zorunlu. Koz da yoksa başka renk atılır.',
                'İhale: Sırayla herkes kaç el alacağını söyler (en az minimum) ya da pas der. En yüksek ihaleyi alan kozu seçer ve ilk eli açar. Herkes pas derse ihale, ilk söyleyene minimumdan kalır.',
                'Tutturursa: aldığı el kadar artı. Tutturamazsa: ihale kadar eksi (batar). Hiç el alamayan da batar (ayarlanır).',
                'Eşli: 2’ye 2, ihaleyi alanın eşinin kartları açılır. Gömmeli: 3 kişi, ihaleyi alan 4 kapalı kartı alır ve 4 kart gömer.',
              ]
          ).map((x) => h('div', {}, x)),
        ),
      );
    rules.append(
      h(
        'label',
        {},
        h('span', {}, de ? 'Variante ' : 'Tür ', h('button', { class: 'info-i', type: 'button', title: 'Info', onclick: (e: Event) => (e.preventDefault(), info()) }, 'i')),
        h(
          'select',
          {
            disabled: dis,
            onchange: (e: Event) => {
              const m = (e.target as HTMLSelectElement).value;
              set({ batakMode: m, batakMinBid: m === 'esli' ? 8 : m === 'gommeli' ? 4 : 5 });
            },
          },
          h('option', { value: 'ihaleli', selected: r.batakMode === 'ihaleli' }, de ? 'İhaleli (jeder für sich)' : 'İhaleli (tekli)'),
          h('option', { value: 'esli', selected: r.batakMode === 'esli' }, de ? 'Eşli (2 gegen 2)' : 'Eşli (2’ye 2)'),
          h('option', { value: 'gommeli', selected: r.batakMode === 'gommeli' }, de ? 'Gömmeli (zu dritt)' : 'Gömmeli (3 kişi)'),
        ),
      ),
      h(
        'label',
        {},
        de ? 'Spielende' : 'Oyun sonu',
        h(
          'select',
          { disabled: dis, onchange: (e: Event) => set({ batakHands: (e.target as HTMLSelectElement).value === 'hands' ? r.batakHands || 10 : 0 }) },
          h('option', { value: 'points', selected: !r.batakHands }, de ? 'nach Punkten' : 'puana göre'),
          h('option', { value: 'hands', selected: !!r.batakHands }, de ? 'nach Anzahl Hände' : 'el sayısına göre'),
        ),
      ),
      r.batakHands ? num('batakHands', de ? 'Anzahl Hände' : 'El sayısı', 1, 50) : num('batakTarget', de ? 'Spiel bis (Punkte)' : 'Oyun sonu (puan)', 5, 1000),
      num('batakMinBid', de ? 'Mindestgebot' : 'En az ihale', 1, r.batakMode === 'gommeli' ? 16 : 13),
      num('batakOverLimit', de ? 'Zu viel = batık ab +Stichen (0 = aus)' : 'Fazla alırsa batar: +el (0 = kapalı)', 0, 13),
      chk('batakZeroBatar', de ? 'Kein Stich = batık' : 'Hiç el alamayan batar'),
      chk('batakRebid', de ? 'Überbieten nach Pas erlaubt' : 'Pas sonrası tekrar artırma'),
      chk('batakTrumpBreak', de ? 'Koz erst ausspielen, wenn gefallen' : 'Koz kırılmadan koz açılmaz'),
      h('label', {}, t('timer'), h('input', { type: 'number', min: 0, max: 300, value: r.turnTimerSec ?? 0, disabled: dis, onchange: (e: Event) => set({ turnTimerSec: Number((e.target as HTMLInputElement).value) || null }) })),
      chk('allowBots', t('bots')),
    );
    el.append(rules);
    if (isOwner) {
      const need = gommeli3 ? [0, 1, 2] : [0, 1, 2, 3];
      const full = need.every((i) => table!.seats[i]);
      el.append(h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'primary', disabled: !full, onclick: () => (unlockAudio(), send({ type: 'start' })) }, '▶ ' + t('startGame'))));
    }
    return;
  }
  if (r.mode === 'tavla') {
    const de = getLang() === 'de';
    rules.append(
      h(
        'label',
        {},
        de ? 'Spiel bis (Punkte)' : 'Oyun sonu (puan)',
        h(
          'select',
          { disabled: dis, onchange: (e: Event) => set({ tavlaTarget: Number((e.target as HTMLSelectElement).value) }) },
          [1, 3, 5, 7, 11].map((n) => h('option', { value: n, selected: (r.tavlaTarget ?? 5) === n }, String(n))),
        ),
      ),
      h('label', { title: de ? 'Hat der Verlierer noch keinen Pul rausgespielt, zählt der Sieg doppelt.' : 'Kaybeden hiç pul toplamadıysa galibiyet iki puan sayılır.' }, h('span', {}, de ? 'Mars zählt doppelt' : 'Mars iki puan'), h('input', { type: 'checkbox', checked: r.tavlaMars !== false, disabled: dis, onchange: (e: Event) => set({ tavlaMars: (e.target as HTMLInputElement).checked }) })),
      h('label', {}, t('timer'), h('input', { type: 'number', min: 0, max: 300, value: r.turnTimerSec ?? 0, disabled: dis, onchange: (e: Event) => set({ turnTimerSec: Number((e.target as HTMLInputElement).value) || null }) })),
      chk('allowBots', t('bots')),
      h('div', { class: 'full muted' }, de ? '🎲 Tavla wird in der Tavla-Ecke gespielt (kleiner Tisch rechts vorne). Würfeln, Pul antippen, Ziel antippen.' : '🎲 Tavla, sağ öndeki tavla köşesinde oynanır. Zar at, pula dokun, hedefe dokun.'),
    );
    el.append(rules);
    if (isOwner) {
      const full = [0, 2].every((i) => table!.seats[i]);
      el.append(h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'primary', disabled: !full, onclick: () => (unlockAudio(), send({ type: 'start' })) }, '▶ ' + t('startGame'))));
    }
    return;
  }
  if (r.mode === 'pisti') {
    const de = getLang() === 'de';
    const info = () =>
      modal(
        h('h2', {}, 'ⓘ ' + (de ? 'Kapalı Pişti (Bluff)' : 'Kapalı Pişti (Blöf)')),
        h(
          'div',
          { class: 'col', style: { gap: '8px', lineHeight: '1.45' } },
          ...(de
            ? [
                'Liegt genau eine Karte in der Mitte, darfst du eine Karte verdeckt legen und damit „Pişti“ behaupten – auch wenn sie gar nicht passt.',
                'Der nächste Spieler entscheidet: glauben oder aufdecken.',
                '• Geglaubt: Du nimmst die Mitte und bekommst 10 Punkte (liegt eine Vale in der Mitte: 20). Die Karte bleibt geheim.',
                '• Aufgedeckt und es war echt: doppelte Punkte – 20 (bei Vale 40).',
                '• Aufgedeckt und es war geblufft: Der Aufdecker bekommt 10 (bei Vale 20), deine Karte bleibt offen in der Mitte liegen.',
                'Mit der letzten Karte einer Runde ist kein Bluff möglich.',
              ]
            : [
                'Ortada tek kart varken bir kartı kapalı atıp “Pişti” diyebilirsin – kart tutmasa bile.',
                'Sıradaki oyuncu karar verir: inanır ya da açar.',
                '• İnanırsa: Ortayı alırsın, 10 puan (ortada vale varsa 20). Kart gizli kalır.',
                '• Açar ve gerçekse: puan iki katı – 20 (valede 40).',
                '• Açar ve blöfse: açan 10 puan alır (valede 20), senin kartın ortada açık kalır.',
                'Elin son kartıyla blöf yapılamaz.',
              ]
          ).map((x) => h('div', {}, x)),
        ),
      );
    rules.append(
      h(
        'label',
        {},
        de ? 'Spieler' : 'Oyuncu',
        h(
          'select',
          { disabled: dis, onchange: (e: Event) => set({ pistiPlayers: Number((e.target as HTMLSelectElement).value) }) },
          h('option', { value: 4, selected: r.pistiPlayers !== 2 }, de ? '4 (2 gegen 2)' : '4 (eşli)'),
          h('option', { value: 2, selected: r.pistiPlayers === 2 }, de ? '2 (1 gegen 1)' : '2 (teke tek)'),
        ),
      ),
      num('pistiTarget', de ? 'Spiel bis (Punkte)' : 'Oyun sonu (puan)', 10, 1000),
      h(
        'label',
        {},
        h('span', {}, de ? 'Bluff (Kapalı Pişti) ' : 'Blöf (Kapalı Pişti) ', h('button', { class: 'info-i', type: 'button', title: 'Info', onclick: (e: Event) => (e.preventDefault(), info()) }, 'i')),
        h('input', { type: 'checkbox', checked: !!r.pistiBluff, disabled: dis, onchange: (e: Event) => set({ pistiBluff: (e.target as HTMLInputElement).checked }) }),
      ),
      h(
        'label',
        { title: de ? 'Aus: Ein Pişti mit der allerletzten Karte der Runde gibt keine Pişti-Punkte (die Karten bekommt man trotzdem).' : 'Kapalı: elin son kartıyla yapılan pişti puan getirmez (kartlar yine alınır).' },
        h('span', {}, de ? 'Pişti mit letzter Karte zählt' : 'Son kartla pişti sayılır'),
        h('input', { type: 'checkbox', checked: r.pistiLastCounts !== false, disabled: dis, onchange: (e: Event) => set({ pistiLastCounts: (e.target as HTMLInputElement).checked }) }),
      ),
      h('label', {}, t('timer'), h('input', { type: 'number', min: 0, max: 300, value: r.turnTimerSec ?? 0, disabled: dis, onchange: (e: Event) => set({ turnTimerSec: Number((e.target as HTMLInputElement).value) || null }) })),
      chk('allowBots', t('bots')),
    );
    el.append(rules);
    if (isOwner) {
      const need = pistiDuo ? [0, 2] : [0, 1, 2, 3];
      const full = need.every((i) => table!.seats[i]);
      el.append(h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'primary', disabled: !full, onclick: () => (unlockAudio(), send({ type: 'start' })) }, '▶ ' + t('startGame'))));
    }
    return;
  }
  if (r.mode === 'standard') rules.append(chk('colorful', t('colorful')), num('startPoints', t('startPoints'), 2, 100));
  if (r.mode !== 'standard') rules.append(num('handCount', t('handCount'), 1, 30));
  if (r.mode === 'okey101') rules.append(num('openThreshold', 'Açma ≥', 50, 200), num('pairOpenCount', 'Çift açma', 3, 7), chk('doubling101', t('doubling101')));
  if (r.mode === 'perisan') {
    rules.append(
      h(
        'div',
        { class: 'full' },
        h('div', { style: { marginBottom: '4px' } }, t('multipliers')),
        h(
          'div',
          { class: 'mult' },
          (['red', 'black', 'yellow', 'blue'] as const).map((c) =>
            h(
              'label',
              { style: { flexDirection: 'column', alignItems: 'stretch' } },
              t(c),
              h('input', { type: 'number', min: 1, max: 50, value: r.colorMultipliers[c], disabled: dis, onchange: (e: Event) => set({ colorMultipliers: { ...r.colorMultipliers, [c]: Number((e.target as HTMLInputElement).value) } }) }),
            ),
          ),
        ),
      ),
    );
  }
  rules.append(
    chk('indicatorPairsAnything', t('indicatorPairs')),
    chk('hardMode', t('hardMode')),
    h('label', {}, t('stealing'), h('input', { type: 'checkbox', checked: r.stealing.enabled, disabled: dis, onchange: (e: Event) => set({ stealing: { ...r.stealing, enabled: (e.target as HTMLInputElement).checked } }) })),
    r.stealing.enabled
      ? h('label', {}, t('stealsPerHand'), h('input', { type: 'number', min: 1, max: 5, value: r.stealing.maxPerHand, disabled: dis, onchange: (e: Event) => set({ stealing: { ...r.stealing, maxPerHand: Number((e.target as HTMLInputElement).value) } }) }))
      : h('span'),
    h('label', {}, t('timer'), h('input', { type: 'number', min: 0, max: 300, value: r.turnTimerSec ?? 0, disabled: dis, onchange: (e: Event) => set({ turnTimerSec: Number((e.target as HTMLInputElement).value) || null }) })),
    chk('allowBots', t('bots')),
  );
  el.append(rules);
  if (isOwner) {
    const full = table!.seats.every((s) => s);
    el.append(h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } }, h('button', { class: 'primary', disabled: !full, onclick: () => (unlockAudio(), send({ type: 'start' })) }, '▶ ' + t('startGame'))));
  }
}

// ------------------------------------------------------------------ Spiel-UI

function renderGame() {
  const playing = table!.started && st;
  const top = slot('top', 'hud-top');
  const wrap = slot('istaka', 'istaka-wrap');
  const zones = slot('zones', 'dropzones');
  const result = slot('result', 'result panel');
  top.classList.toggle('hidden', !playing);
  // Partner-Karten (Batak Eşli) nur, solange sie offen liegen
  if (!(playing && st.view.kind === 'batak' && st.view.open)) els.dummy?.remove();
  wrap.classList.toggle('hidden', !playing || (you.seat === null && you.watching === null));
  if (playing && !spectHud()) {
    // Zuschauer will nur im Raum sein: keine Istaka/Karten/Punkte
    for (const e of [top, wrap, zones, result]) e.classList.add('hidden');
    els.dummy?.remove();
    document.querySelector('.bk-trick')?.classList.add('hidden');
    return;
  }
  if (!playing) {
    zones.classList.add('hidden');
    result.classList.add('hidden');
    return;
  }
  const v = st.view;
  if (v.kind === 'pisti') return renderPisti(v, top, wrap, zones, result);
  if (v.kind === 'batak') return renderBatak(v, top, wrap, zones, result);
  if (v.kind === 'tavla') return renderTavla(v, top, wrap, zones, result);
  const mine = you.seat !== null ? you.seat % 2 : -1;
  const teamName = (team: number) => [team, team + 2].map((s) => table!.seats[s]?.name ?? '?').join(' & ');
  top.innerHTML = '';
  const turnName = nameOf(v.current);
  const isMe = v.current === you.seat;
  let timer = '';
  if (st.turnDeadline) timer = ` · ${Math.max(0, Math.ceil((st.turnDeadline - Date.now()) / 1000))}s`;
  const okeyTile: Tile | null = st.okey ? { id: -1, color: st.okey.color, value: st.okey.value, fake: false } : null;
  const topToggle = h(
    'button',
    {
      class: 'small ghost toptoggle',
      title: getLang() === 'de' ? 'Anzeige oben ein-/ausblenden' : 'Üst bilgiyi aç/kapa',
      onclick: () => ((settings.hideTop = !settings.hideTop), saveSettings(), renderGame()),
    },
    settings.hideTop ? '▾' : '▴',
  );
  top.classList.toggle('mini', settings.hideTop);
  if (settings.hideTop) {
    top.append(
      h('div', { class: 'turn small' + (isMe ? ' me' : '') }, isMe ? (v.phase === 'draw' ? '①' : '②') + ' ' + (getLang() === 'de' ? 'Du' : 'Sen') : `⏳ ${turnName}`),
      topToggle,
    );
  } else top.append(
    h('div', { class: 'score' + (mine === 0 ? ' mine' : '') }, h('div', { class: 'muted' }, teamName(0)), String(v.teamScores[0])),
    v.phase === 'handOver' || v.phase === 'gameOver'
      ? h('div', { class: 'turn' }, v.gameOver ? t('gameOver') : t('handOver'))
      : h(
          'div',
          { class: 'turn' + (isMe ? ' me' : '') },
          isMe
            ? v.phase === 'draw'
              ? getLang() === 'de'
                ? '① Ziehen: Mitte oder links'
                : '① Çek: ortadan ya da soldan'
              : getLang() === 'de'
                ? '② Abwerfen ➜ rechts · oder 🏁 Mitte'
                : '② At ➜ sağa · ya da 🏁 ortaya'
            : `${t('waitingFor')}: ${turnName}`,
          timer,
        ),
    (() => {
      // statt Steinanzahl: zuletzt geworfener Stein (klein)
      const last: Tile | null = st.topDiscards?.[(v.current + 3) % 4] ?? null;
      return h(
        'div',
        { class: 'okeyinfo' },
        'Okey',
        okeyTile ? tileElement(okeyTile) : '',
        h('span', { class: 'muted lastlbl' }, getLang() === 'de' ? 'Geworfen' : 'Atılan'),
        last ? h('span', { class: 'lastthrow' }, tileElement(last)) : h('span', { class: 'muted' }, '–'),
        h('span', { class: 'muted ok-meta' }, `${t(table!.rules.mode)} · El ${v.handNo + (v.phase === 'handOver' || v.gameOver ? 0 : 1)}`),
      );
    })(),
    h('div', { class: 'score' + (mine === 1 ? ' mine' : '') }, h('div', { class: 'muted' }, teamName(1)), String(v.teamScores[1])),
    topToggle,
  );

  // Istaka + Aktionen
  wrap.innerHTML = '';
  const bar = h('div', { class: 'actions-bar', id: 'actions' });
  wrap.append(bar, istaka.el);
  if (you.seat === null) {
    wrap.prepend(
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'muted' }, t('watching') + ':'),
        [0, 1, 2, 3].map((s) => h('button', { class: 'small ' + (you.watching === s ? 'primary' : 'ghost'), onclick: () => (send({ type: 'watch', seat: s }), watchAt(s)) }, nameOf(s))),
      ),
    );
  }
  istaka.render();
  renderActions();

  zones.classList.toggle('hidden', true);
  zones.innerHTML = '';
  zones.append(h('div', { class: 'zone', 'data-zone': 'discard' }, '⬇ ' + t('discard')), h('div', { class: 'zone finish', 'data-zone': 'finish' }, '✔ ' + t('finish')));
  zones.querySelectorAll('.zone').forEach((z) => ((z as HTMLElement).dataset.zone = (z as HTMLElement).getAttribute('data-zone')!));

  // Ergebnis
  const over = (v.phase === 'handOver' || v.gameOver) && !resultHidden();
  result.classList.toggle('hidden', !over);
  if (over) {
    result.innerHTML = '';
    result.append(handsPanel(v));
    const isOwner = table!.ownerId === myId;
    if (v.gameOver) {
      const w = v.winnerTeam;
      result.append(h('h2', {}, w === null ? t('draw') : `🏆 ${t('winner')}: ${teamName(w)}`));
      const losing = w === null ? -1 : 1 - w;
      const canSign = you.seat !== null && you.seat % 2 === losing && profile.signature && !table!.signatures[you.seat];
      result.append(
        h(
          'div',
          { class: 'row', style: { justifyContent: 'center' } },
          canSign ? h('button', { class: 'primary', onclick: () => ((sheetOpen = true), send({ type: 'sign' })) }, '✍️ ' + t('sign')) : null,
          isOwner ? h('button', { class: 'primary', onclick: () => send({ type: 'rematch' }) }, '🔁 ' + t('rematch')) : null,
          isOwner ? h('button', { onclick: () => send({ type: 'backToLobby' }) }, t('toLobby')) : null,
        ),
      );
    } else {
      const lr = st.lastResult ?? {};
      const de = getLang() === 'de';
      const who =
        lr.finisher !== undefined && lr.finisher !== null
          ? `🏁 ${nameOf(lr.finisher)} ${de ? 'hat beendet' : 'bitirdi'}${lr.withOkey ? (de ? ' – mit Okey!' : ' – okeyle!') : ''}${lr.withPairs ? (de ? ' – mit Paaren (Çift)' : ' – çiftten') : ''}`
          : lr.note === 'Ortaya bitti'
            ? de
              ? '🀫 Ortaya bitti – die Mitte ist leer, niemand hat beendet'
              : '🀫 Ortaya bitti – kimse bitiremedi'
            : '';
      appendAll(result, h('h2', {}, t('handOver')), who ? h('div', { class: 'finisher' }, who) : null, h('div', { class: 'muted' }, lr.note ?? ''));
      // bereit für die nächste Hand
      const ready = new Set(table!.ready ?? []);
      const humans = table!.seats.map((p, i) => [p, i] as const).filter(([p]) => p && !p.bot);
      const iAmReady = you.seat !== null && ready.has(you.seat);
      appendAll(
        result,
        h(
          'div',
          { class: 'readyrow' },
          humans.map(([p, i]) => h('span', { class: 'rd ' + (ready.has(i) ? 'ok' : '') }, (ready.has(i) ? '✅ ' : '⏳ ') + p!.name)),
        ),
        h(
          'div',
          { class: 'row', style: { justifyContent: 'center' } },
          you.seat !== null
            ? h('button', { class: iAmReady ? 'ghost' : 'primary', onclick: () => send({ type: 'ready', ready: !iAmReady }) }, iAmReady ? (de ? '↩ Doch nicht bereit' : '↩ Hazır değilim') : de ? '✓ Bereit für die nächste Runde' : '✓ Sonraki ele hazırım')
            : null,
          isOwner ? h('button', { onclick: () => send({ type: 'nextHand' }) }, de ? '▶ Jetzt starten (Tischbesitzer)' : '▶ Hemen başlat (masa sahibi)') : null,
          isOwner
            ? h(
                'button',
                {
                  class: 'danger',
                  onclick: () =>
                    popupMenu(de ? '⏹ Ganzes Spiel beenden? Alle stehen auf.' : '⏹ Oyunu bitir? Herkes kalkar.', [
                      { label: de ? '✓ Ja, Spiel beenden' : '✓ Evet, bitir', fn: () => send({ type: 'backToLobby' }) },
                      { label: de ? '✗ Nein, weiterspielen' : '✗ Hayır, devam', fn: () => {} },
                    ]),
                },
                de ? '⏹ Spiel beenden' : '⏹ Oyunu bitir',
              )
            : null,
        ),
      );
    }
  }
}

let showHands = true;
/** Am Ende der Hand: Steine aller Spieler gut lesbar als Reihen */
function handsPanel(v: any): HTMLElement {
  const de = getLang() === 'de';
  const box = h('div', { class: 'handsbox' });
  const toggle = h('button', { class: 'small ghost', onclick: () => ((showHands = !showHands), renderGame()) }, showHands ? (de ? '▾ Hände ausblenden' : '▾ Elleri gizle') : de ? '▸ Hände aller Spieler ansehen' : '▸ Herkesin elini gör');
  box.append(toggle);
  if (!showHands) return box;
  const revealed: any[][] | null = v.revealedHands;
  const layouts: Record<number, (number | null)[]> | null = st?.layouts ?? null;
  const finisher = st?.lastResult?.finisher;
  for (let s = 0; s < 4; s++) {
    const tiles: any[] = (s === you.seat ? v.myHand : revealed?.[s]) ?? [];
    const byId = new Map(tiles.map((x: any) => [x.id, x]));
    // Anordnung wie auf dem eigenen Brett (eigenes: lokal, andere: vom Server; Bots: sortiert)
    let slots: (number | null)[] = s === you.seat ? [...istaka.slots] : layouts?.[s] ? [...layouts[s]] : [];
    slots = slots.length === 32 ? slots.map((id) => (id !== null && byId.has(id) ? id : null)) : new Array(32).fill(null);
    const placed = new Set(slots.filter((x) => x !== null));
    const rest = tiles.filter((x: any) => !placed.has(x.id)).sort((a: any, b: any) => (a.fake ? 1 : 0) - (b.fake ? 1 : 0) || String(a.color).localeCompare(String(b.color)) || a.value - b.value);
    for (const x of rest) {
      const free = slots.indexOf(null);
      if (free < 0) break;
      slots[free] = x.id;
    }
    const row = h('div', { class: 'handrow' + (s === finisher ? ' winner' : '') + (s % 2 === 0 ? ' tA' : ' tB') });
    // nur am Ende der Hand: was hatte jeder selbst noch auf der Hand?
    const pd: number[] | undefined = st?.lastResult?.playerDelta;
    const loser = finisher === undefined || finisher === null ? true : s % 2 !== finisher % 2;
    let handInfo: HTMLElement | string = '';
    if (s !== finisher && loser && tiles.length && st?.okey) {
      const ls = looseSum(tiles as any, st.okey);
      const pts = pd?.[s];
      handInfo = h('div', { class: 'hn-pts' }, (de ? 'Rest: ' : 'Elde: ') + ls, pts ? h('b', {}, ` → +${pts}`) : '');
    }
    row.append(h('div', { class: 'hn' }, h('div', {}, (s === finisher ? '🏁 ' : '') + nameOf(s)), handInfo));
    const board = h('div', { class: 'miniboard' });
    for (let r = 0; r < 2; r++) {
      const line = h('div', { class: 'mb-row' });
      for (let c = 0; c < 16; c++) {
        const id = slots[r * 16 + c];
        const cell = h('div', { class: 'mb-slot' });
        if (id !== null && byId.has(id)) {
          const el = tileElement(byId.get(id), st?.okey);
          el.classList.add('mini');
          cell.append(el);
        }
        line.append(cell);
      }
      board.append(line);
    }
    if (!tiles.length) board.append(h('div', { class: 'muted', style: { textAlign: 'center' } }, s === finisher ? (de ? 'fertig – alle Steine ausgelegt' : 'bitti') : '—'));
    row.append(board);
    box.append(row);
  }
  return box;
}

// ------------------------------------------------------------------ Pişti

let pistiBluffArmed = false;
let pistiLastSeq = -1;
let pistiPeekSeq = -1;
let pistiHandIds = new Set<number>();

/** die drei verdeckten Startkarten kurz zeigen (Vorteil für den, der sie gewonnen hat) */
function showPistiPeek(cards: PCard[]) {
  document.querySelector('.pisti-peek')?.remove();
  const de = getLang() === 'de';
  const box = h('div', { class: 'pisti-peek' }, h('div', {}, de ? '👀 Die verdeckten Karten, die du gewonnen hast:' : '👀 Kazandığın kapalı kartlar:'), h('div', { class: 'pk-cards' }, cards.map((c) => cardElement(c))));
  document.getElementById('ui')!.append(box);
  setTimeout(() => box.classList.add('out'), 3800);
  setTimeout(() => box.remove(), 4400);
}

function pistiTeamName(v: any, team: number, short = false) {
  return (v.seats as number[])
    .filter((s) => v.teamOfSeat[s] === team)
    .map((s) => {
      const n = table!.seats[s]?.name ?? '?';
      return short ? n.split(' ')[0] : n;
    })
    .join(short ? '-' : ' & ');
}

/** kleiner Hinweis unter der Anzeige oben (verschwindet von selbst) */
function pistiNote(text: string) {
  document.querySelector('.pisti-note')?.remove();
  const n = h('div', { class: 'pisti-note' }, text);
  document.getElementById('ui')!.append(n);
  setTimeout(() => n.classList.add('out'), 2400);
  setTimeout(() => n.remove(), 3000);
}

/** Töne, Gesten und Hinweise zu dem, was gerade passiert ist */
function pistiFeedback(prev: any | null, v: any) {
  const raw = v.lastEvent;
  if (!raw || raw.seq === pistiLastSeq) return;
  const first = pistiLastSeq === -1 && prev === null;
  pistiLastSeq = raw.seq;
  // Rundenende: Ton/Hinweis zum letzten Zug (z. B. Pişti mit der letzten Karte)
  const e = raw.kind === 'roundEnd' ? raw.before : raw;
  if (!e) return;
  if (first && e.kind !== 'deal') return;
  world.pistiAnimate(prev, v);
  // verdeckte Startkarten gewonnen → kurz ansehen (nur der Gewinner bekommt sie vom Server)
  if (v.peek && v.peek.seq !== pistiPeekSeq) {
    pistiPeekSeq = v.peek.seq;
    setTimeout(() => showPistiPeek(v.peek.cards), 900);
  }
  const de = getLang() === 'de';
  const who = nameOf(e.seat);
  switch (e.kind) {
    case 'deal':
      sfx.shuffle();
      break;
    case 'play':
      sfx.tile();
      break;
    case 'capture':
      sfx.slam();
      break;
    case 'pisti':
      sfx.slam();
      sayLine(e.seat, 'pisti');
      world.emote(e.seat, 'slam');
      pistiNote(`Pişti · ${who} +${e.points}`);
      break;
    case 'bluff':
      sfx.tile();
      sayLine(e.seat, 'pisti');
      pistiNote(de ? `${who}: verdeckt – „Pişti!“` : `${who}: kapalı – “Pişti!”`);
      break;
    case 'bluffBelieved':
      sfx.slam();
      pistiNote(de ? `${nameOf(e.by)} glaubt es · ${who} +${e.points}` : `${nameOf(e.by)} inandı · ${who} +${e.points}`);
      break;
    case 'bluffTrue':
      sfx.slam();
      world.emote(e.seat, 'slam');
      pistiNote(de ? `Aufgedeckt – echt! ${who} +${e.points}` : `Açıldı – gerçek! ${who} +${e.points}`);
      break;
    case 'bluffFalse':
      sfx.tile();
      world.emote(e.seat, 'headshake');
      pistiNote(de ? `Aufgedeckt – Bluff! ${nameOf(e.by)} +${e.points}` : `Açıldı – blöf! ${nameOf(e.by)} +${e.points}`);
      break;
  }
}

/** welche Austeilung gerade läuft (4 Spieler: 3×, 2 Spieler: 6×) */
/** Spielauswahl: zwei Gruppen (Okey / Kartenspiele) – gespielt wird immer genau eins */
const MODE_GROUPS: { key: string; de: string; tr: string; modes: string[] }[] = [
  { key: 'okey', de: '🀄 Okey', tr: '🀄 Okey', modes: ['standard', 'okey101', 'perisan'] },
  { key: 'cards', de: '🃏 Kartenspiele', tr: '🃏 Kart oyunları', modes: ['pisti', 'batak'] },
  { key: 'tavla', de: '🎲 Tavla', tr: '🎲 Tavla', modes: ['tavla'] },
];
function modePicker(mode: string, dis: boolean) {
  const de = getLang() === 'de';
  return h(
    'div',
    { class: 'full mode-groups' },
    MODE_GROUPS.map((g) => {
      const active = g.modes.includes(mode);
      return h(
        'label',
        { class: 'mode-group' + (active ? ' active' : '') },
        h('span', {}, de ? g.de : g.tr),
        h(
          'select',
          { disabled: dis, onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) send({ type: 'setRules', rules: { mode: v } });
          } },
          active ? null : h('option', { value: '', selected: true }, de ? '– auswählen –' : '– seç –'),
          g.modes.map((m) => h('option', { value: m, selected: m === mode }, t(m))),
        ),
      );
    }),
  );
}

// ------------------------------------------------------------------ Tavla

let tavlaSelFrom: any = null;
const tavlaPlace = (key: string): any => (key === 'bar' ? 'bar' : key === 'off' ? 'off' : Number(key.slice(1)));
const tavlaName = (seat: number) => nameOf(seat);

/** Klick aufs Brett: erst Pul antippen → alle möglichen Ziele leuchten grün (mit Würfelzahl) → Ziel antippen */
type TavlaReach = { from: any; to: any; path: { from: any; to: any; die: number }[] };
function tavlaTargets(v: any, from: any): { to: any; label: string; path: TavlaReach['path'] }[] {
  return ((v.reach ?? []) as TavlaReach[]).filter((r) => r.from === from).map((r) => ({ to: r.to, label: r.path.map((s) => s.die).join('+'), path: r.path }));
}
function tavlaSelect(v: any, from: any) {
  tavlaSelFrom = from;
  world.setTavlaSel(from, from === null ? [] : tavlaTargets(v, from));
}
function tavlaClick(key: string) {
  const v = st?.view;
  if (!v || v.kind !== 'tavla' || you.seat === null || v.current !== you.seat) return;
  if (v.phase === 'roll') return act({ action: 'roll' });
  if (v.phase !== 'move') return;
  const place = tavlaPlace(key);
  if (tavlaSelFrom !== null) {
    const t = tavlaTargets(v, tavlaSelFrom).find((x) => x.to === place);
    if (t) {
      tavlaSelect(v, null);
      if (t.path.length === 1) act({ action: 'move', from: t.path[0].from, to: t.path[0].to, die: t.path[0].die });
      else act({ action: 'moves', path: t.path });
      return;
    }
  }
  if (tavlaTargets(v, place).length) {
    tavlaSelect(v, place === tavlaSelFrom ? null : place);
    sfx.tile();
    return;
  }
  tavlaSelect(v, null);
}

function tavlaFeedback(prev: any | null, v: any) {
  const e0 = v.lastEvent;
  if (!e0 || (prev && prev.lastEvent?.seq === e0.seq)) return;
  const de = getLang() === 'de';
  const e = e0.kind === 'handEnd' ? e0.before : e0;
  if (e) {
    if (e.kind === 'roll' || e.kind === 'opening') sfx.dice();
    if (e.kind === 'move' || e.kind === 'undo') setTimeout(() => (e.hit ? sfx.slam() : sfx.checker()), 300);
    if (e.kind === 'opening') pistiNote(de ? `🎲 ${e.dice[0]} : ${e.dice[1]} – ${tavlaName(e.seat)} fängt an` : `🎲 ${e.dice[0]} : ${e.dice[1]} – ${tavlaName(e.seat)} başlıyor`);
    if (e.kind === 'pass') {
      sfx.dice();
      pistiNote(de ? `🎲 ${e.dice.join(' · ')} – ${tavlaName(e.seat)} kann nicht ziehen` : `🎲 ${e.dice.join(' · ')} – ${tavlaName(e.seat)} oynayamıyor`);
    }
  }
  if (e0.kind === 'handEnd') {
    setTimeout(() => {
      sfx.finish();
      pistiNote(e0.mars ? (de ? `🏁 ${tavlaName(e0.seat)} gewinnt mit MARS · +2` : `🏁 ${tavlaName(e0.seat)} MARS yaptı · +2`) : de ? `🏁 ${tavlaName(e0.seat)} gewinnt · +1` : `🏁 ${tavlaName(e0.seat)} kazandı · +1`);
    }, 500);
  }
}

const DIE_FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
function renderTavla(v: any, top: HTMLElement, wrap: HTMLElement, zones: HTMLElement, result: HTMLElement) {
  const de = getLang() === 'de';
  const isMe = v.current === you.seat;
  const over = v.phase === 'handOver' || v.phase === 'gameOver';
  let timer = '';
  if (st.turnDeadline) timer = ` · ${Math.max(0, Math.ceil((st.turnDeadline - Date.now()) / 1000))}s`;
  const color = (seat: number) => (seat === 0 ? '⚪' : '🟤');
  // --- oben: Stand, wer dran ist, Würfel, Pips
  top.innerHTML = '';
  top.classList.remove('mini');
  const turnText = over
    ? v.gameOver
      ? t('gameOver')
      : t('handOver')
    : isMe
      ? v.phase === 'roll'
        ? de
          ? '🎲 Du bist dran – würfeln'
          : '🎲 Sıra sende – zar at'
        : de
          ? '♟ Pul antippen – grüne Felder zeigen, wohin er kann'
          : '♟ Oyna: pula dokun, sonra hedefe'
      : `${t('waitingFor')}: ${tavlaName(v.current)}`;
  const diceTxt = v.phase === 'move' && v.dice?.length ? (v.dice as number[]).map((d) => DIE_FACE[d]).join(' ') : '';
  top.append(
    h('div', { class: 'score' + (you.seat === 0 ? ' mine' : '') }, h('div', { class: 'muted' }, `${color(0)} ${tavlaName(0)}`), String(v.scores[0])),
    h('div', { class: 'turn' + (isMe && !over ? ' me' : '') }, turnText, timer),
    h(
      'div',
      { class: 'okeyinfo tavla-info' },
      diceTxt ? h('span', { class: 'tv-dice' }, diceTxt) : null,
      h('span', { class: 'muted', title: de ? 'Pip-Zählung: wie weit jeder noch ziehen muss' : 'Pip sayısı' }, `Pip ${v.pips[0]}:${v.pips[1]}`),
      h('span', { class: 'muted ok-meta' }, `· ${de ? 'bis' : 'hedef'} ${v.target}`),
    ),
    h('div', { class: 'score' + (you.seat === 2 ? ' mine' : '') }, h('div', { class: 'muted' }, `${color(2)} ${tavlaName(2)}`), String(v.scores[1])),
  );
  // --- unten: Würfeln / Zurück / Zuschauer
  wrap.innerHTML = '';
  wrap.classList.toggle('hidden', false);
  const bar = h('div', { class: 'actions-bar tavla-bar' });
  if (you.seat === null) {
    bar.append(h('span', { class: 'muted' }, '👁 ' + t('watching')));
  } else if (!over && isMe && v.phase === 'roll') {
    bar.append(h('button', { class: 'primary tv-roll', onclick: () => act({ action: 'roll' }) }, de ? '🎲 Würfeln' : '🎲 Zar at'));
  } else if (!over && isMe && v.phase === 'move') {
    bar.append(h('span', { class: 'pb-text' }, (de ? 'Würfel: ' : 'Zar: ') + diceTxt));
    if (v.canUndo) bar.append(h('button', { class: 'ghost', onclick: () => (tavlaSelect(v, null), act({ action: 'undo' })) }, de ? '↶ Zurück' : '↶ Geri al'));
  } else if (!over) {
    bar.append(h('span', { class: 'muted' }, `${t('waitingFor')}: ${tavlaName(v.current)}`));
  }
  wrap.append(bar);
  zones.classList.add('hidden');
  // --- Ergebnis
  result.classList.toggle('hidden', !over || resultHidden());
  if (!over || resultHidden()) return;
  result.innerHTML = '';
  const isOwner = table!.ownerId === myId;
  const lr = v.lastResult;
  result.append(
    h('h2', {}, v.gameOver ? `🏆 ${t('winner')}: ${tavlaName(v.winnerTeam === 0 ? 0 : 2)}` : lr ? `🏁 ${tavlaName(lr.winner)} ${de ? 'gewinnt' : 'kazandı'}${lr.mars ? ' – MARS!' : ''}` : t('handOver')),
    h(
      'table',
      { class: 'pisti-result' },
      h('tr', {}, h('th', {}, ''), h('th', {}, `${color(0)} ${tavlaName(0)}`), h('th', {}, `${color(2)} ${tavlaName(2)}`)),
      lr ? h('tr', {}, h('td', {}, de ? 'Dieses Spiel' : 'Bu oyun'), h('td', {}, lr.winner === 0 ? '+' + lr.points : '0'), h('td', {}, lr.winner === 2 ? '+' + lr.points : '0')) : null,
      h('tr', { class: 'sum' }, h('td', {}, 'Σ'), h('td', {}, String(v.scores[0])), h('td', {}, String(v.scores[1]))),
    ),
    h('div', { class: 'muted', style: { textAlign: 'center', margin: '4px 0 8px' } }, de ? `Gespielt wird bis ${v.target} Punkte · Mars = 2 Punkte` : `${v.target} puana kadar · Mars = 2 puan`),
  );
  if (v.gameOver) {
    result.append(
      h(
        'div',
        { class: 'row', style: { justifyContent: 'center' } },
        isOwner ? h('button', { class: 'primary', onclick: () => send({ type: 'rematch' }) }, '🔁 ' + t('rematch')) : null,
        isOwner ? h('button', { onclick: () => send({ type: 'backToLobby' }) }, t('toLobby')) : null,
      ),
    );
    return;
  }
  const ready = new Set(table!.ready ?? []);
  const iAmReady = you.seat !== null && ready.has(you.seat);
  result.append(
    h(
      'div',
      { class: 'row', style: { justifyContent: 'center' } },
      you.seat !== null ? h('button', { class: iAmReady ? 'ghost' : 'primary', onclick: () => send({ type: 'ready', ready: !iAmReady }) }, iAmReady ? (de ? '↩ Doch nicht bereit' : '↩ Hazır değilim') : de ? '✓ Nächstes Spiel' : '✓ Sonraki oyun') : null,
      isOwner ? h('button', { onclick: () => send({ type: 'nextHand' }) }, de ? '▶ Jetzt starten' : '▶ Hemen başlat') : null,
    ),
  );
}

function pistiDealLabel(v: any, de: boolean) {
  const n = (v.seats as number[]).length;
  const per = n * 4;
  const total = Math.round(48 / per);
  const cur = Math.min(total, Math.max(1, Math.round((48 - v.stockCount) / per)));
  return `${de ? 'Austeilung' : 'Dağıtım'} ${cur}/${total}`;
}

function renderPisti(v: any, top: HTMLElement, wrap: HTMLElement, zones: HTMLElement, result: HTMLElement) {
  const de = getLang() === 'de';
  const myTeam = you.seat !== null ? v.teamOfSeat[you.seat] : -1;
  const isMe = v.current === you.seat;
  const over = v.phase === 'handOver' || v.phase === 'gameOver';
  let timer = '';
  if (st.turnDeadline) timer = ` · ${Math.max(0, Math.ceil((st.turnDeadline - Date.now()) / 1000))}s`;

  // --- Anzeige oben
  top.innerHTML = '';
  top.classList.remove('mini');
  const turnText = over
    ? v.gameOver
      ? t('gameOver')
      : t('handOver')
    : v.phase === 'bluff'
      ? isMe
        ? de
          ? '❓ Glauben oder aufdecken?'
          : '❓ İnanıyor musun?'
        : `${t('waitingFor')}: ${nameOf(v.current)}`
      : isMe
        ? de
          ? '🂠 Du bist dran – eine Karte legen'
          : '🂠 Sıra sende – bir kart at'
        : `${t('waitingFor')}: ${nameOf(v.current)}`;
  top.append(
    h('div', { class: 'score' + (myTeam === 0 ? ' mine' : '') }, h('div', { class: 'muted' }, pistiTeamName(v, 0)), String(v.scores[0])),
    h('div', { class: 'turn' + (isMe && !over ? ' me' : '') }, turnText, timer),
    h(
      'div',
      { class: 'okeyinfo pisti-info' },
      h('span', {}, (de ? 'Mitte ' : 'Yerde ') + v.pileCount),
      v.pile?.length ? h('span', { class: 'pisti-top' }, cardElement(v.pile[v.pile.length - 1])) : v.pileCount ? h('span', { class: 'pisti-top' }, cardElement(null)) : null,
      h('span', { class: 'muted' }, '·'),
      h('span', {}, pistiDealLabel(v, de)),
      h('span', { class: 'muted ok-meta' }, `· ${de ? 'bis' : 'hedef'} ${v.target}`),
    ),
    h('div', { class: 'score' + (myTeam === 1 ? ' mine' : '') }, h('div', { class: 'muted' }, pistiTeamName(v, 1)), String(v.scores[1])),
  );

  // --- Hand + Aktionen
  wrap.innerHTML = '';
  wrap.classList.toggle('hidden', you.seat === null && you.watching === null);
  const bar = h('div', { class: 'actions-bar pisti-bar' });
  if (you.seat === null) {
    wrap.append(
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'muted' }, t('watching') + ':'),
        (v.seats as number[]).map((s) => h('button', { class: 'small ' + (you.watching === s ? 'primary' : 'ghost'), onclick: () => (send({ type: 'watch', seat: s }), watchAt(s)) }, nameOf(s))),
      ),
    );
  }
  const canBluff = v.bluff && isMe && v.phase === 'play' && v.pileCount === 1 && v.hiddenCount === 0 && !(v.stockCount === 0 && (v.handCounts as number[]).every((n: number, s: number) => n === (s === you.seat ? 1 : 0)));
  if (!canBluff) pistiBluffArmed = false;
  if (v.phase === 'bluff' && v.pending) {
    if (isMe) {
      bar.append(
        h('span', { class: 'pb-text' }, de ? `${nameOf(v.pending.seat)} hat verdeckt gelegt und sagt „Pişti“` : `${nameOf(v.pending.seat)} kapalı attı, “Pişti” diyor`),
        h('button', { class: 'primary', onclick: () => act({ action: 'respond', believe: true }) }, de ? '✓ Glauben' : '✓ İnanıyorum'),
        h('button', { onclick: () => act({ action: 'respond', believe: false }) }, de ? '👁 Aufdecken' : '👁 Aç'),
      );
    } else bar.append(h('span', { class: 'pb-text' }, de ? `${nameOf(v.pending.seat)} sagt „Pişti“ – ${nameOf(v.current)} entscheidet…` : `${nameOf(v.pending.seat)} “Pişti” diyor – ${nameOf(v.current)} karar veriyor…`));
  } else if (canBluff) {
    bar.append(
      h(
        'button',
        { class: pistiBluffArmed ? 'primary' : 'ghost', title: de ? 'Nächste Karte verdeckt legen (Bluff)' : 'Sonraki kartı kapalı at (blöf)', onclick: () => ((pistiBluffArmed = !pistiBluffArmed), renderGame()) },
        pistiBluffArmed ? (de ? '🂠 Verdeckt: Karte wählen' : '🂠 Kapalı: kart seç') : de ? '🂠 Verdeckt legen (Bluff)' : '🂠 Kapalı at (blöf)',
      ),
    );
  }
  const hand = h('div', { class: 'pisti-hand' + (isMe && v.phase === 'play' ? ' myturn' : '') });
  const fresh = (v.myHand as PCard[]).filter((c) => !pistiHandIds.has(c.id));
  pistiHandIds = new Set((v.myHand as PCard[]).map((c) => c.id));
  (v.myHand as PCard[]).forEach((c, idx) => {
    const el = cardElement(c);
    // neu ausgeteilte Karten fliegen herein
    if (fresh.length >= 2 && fresh.some((x) => x.id === c.id)) {
      el.classList.add('dealt');
      el.style.animationDelay = `${0.35 + idx * 0.09}s`;
    }
    if (isMe && v.phase === 'play') {
      el.classList.add('playable');
      el.onclick = () => {
        el.classList.add('thrown');
        act({ action: 'play', cardId: c.id, bluff: pistiBluffArmed });
        pistiBluffArmed = false;
      };
    }
    hand.append(el);
  });
  wrap.append(bar, hand);
  zones.classList.add('hidden');

  // --- Rundenende / Spielende (kurz warten, damit man den letzten Zug noch sieht)
  result.classList.toggle('hidden', !over || resultHidden());
  if (!over || resultHidden()) return;
  result.innerHTML = '';
  const isOwner = table!.ownerId === myId;
  const lr = v.lastResult;
  if (lr) {
    const row = (label: string, key: string) =>
      h('tr', {}, h('td', {}, label), h('td', {}, String(lr.teams[0][key])), h('td', {}, String(lr.teams[1][key])));
    result.append(
      h('h2', {}, v.gameOver ? (v.winnerTeam === null ? t('draw') : `🏆 ${t('winner')}: ${pistiTeamName(v, v.winnerTeam)}`) : t('handOver')),
      h(
        'table',
        { class: 'pisti-result' },
        h('tr', {}, h('th', {}, ''), h('th', {}, pistiTeamName(v, 0, true)), h('th', {}, pistiTeamName(v, 1, true))),
        row(de ? 'Karten' : 'Kart', 'cards'),
        row(de ? 'Kartenmehrheit' : 'Kart fazlası', 'majority'),
        row(de ? 'Asse' : 'As', 'aces'),
        row(de ? 'Valen' : 'Vale', 'jacks'),
        row('♣2', 'clubs2'),
        row('♦10', 'diamonds10'),
        h('tr', {}, h('td', {}, 'Pişti'), h('td', {}, `${lr.teams[0].pistiPoints}${lr.teams[0].pistis ? ` (${lr.teams[0].pistis}×)` : ''}`), h('td', {}, `${lr.teams[1].pistiPoints}${lr.teams[1].pistis ? ` (${lr.teams[1].pistis}×)` : ''}`)),
        h('tr', { class: 'sum' }, h('td', {}, de ? 'Runde' : 'El'), h('td', {}, '+' + lr.teams[0].total), h('td', {}, '+' + lr.teams[1].total)),
        h('tr', { class: 'sum' }, h('td', {}, 'Σ'), h('td', {}, String(v.scores[0])), h('td', {}, String(v.scores[1]))),
      ),
    );
  }
  if (v.gameOver) {
    result.append(
      h(
        'div',
        { class: 'row', style: { justifyContent: 'center' } },
        isOwner ? h('button', { class: 'primary', onclick: () => send({ type: 'rematch' }) }, '🔁 ' + t('rematch')) : null,
        isOwner ? h('button', { onclick: () => send({ type: 'backToLobby' }) }, t('toLobby')) : null,
      ),
    );
    return;
  }
  const ready = new Set(table!.ready ?? []);
  const humans = table!.seats.map((p, i) => [p, i] as const).filter(([p]) => p && !p.bot);
  const iAmReady = you.seat !== null && ready.has(you.seat);
  appendAll(
    result,
    h('div', { class: 'readyrow' }, humans.map(([p, i]) => h('span', { class: 'rd ' + (ready.has(i) ? 'ok' : '') }, (ready.has(i) ? '✅ ' : '⏳ ') + p!.name))),
    h(
      'div',
      { class: 'row', style: { justifyContent: 'center' } },
      you.seat !== null
        ? h('button', { class: iAmReady ? 'ghost' : 'primary', onclick: () => send({ type: 'ready', ready: !iAmReady }) }, iAmReady ? (de ? '↩ Doch nicht bereit' : '↩ Hazır değilim') : de ? '✓ Bereit für die nächste Runde' : '✓ Sonraki ele hazırım')
        : null,
      isOwner ? h('button', { onclick: () => send({ type: 'nextHand' }) }, de ? '▶ Jetzt starten (Tischbesitzer)' : '▶ Hemen başlat (masa sahibi)') : null,
      isOwner
        ? h(
            'button',
            {
              class: 'danger',
              onclick: () =>
                popupMenu(de ? '⏹ Ganzes Spiel beenden? Alle stehen auf.' : '⏹ Oyunu bitir? Herkes kalkar.', [
                  { label: de ? '✓ Ja, Spiel beenden' : '✓ Evet, bitir', fn: () => send({ type: 'backToLobby' }) },
                  { label: de ? '✗ Nein, weiterspielen' : '✗ Hayır, devam', fn: () => {} },
                ]),
            },
            de ? '⏹ Spiel beenden' : '⏹ Oyunu bitir',
          )
        : null,
    ),
  );
}

// ------------------------------------------------------------------ Batak
let batakLastSeq = -1;
/** Stichkarten oben vergrößert (Handy: per Antippen) */
let bkTrickBig = false;
document.addEventListener('pointerdown', () => {
  if (!bkTrickBig) return;
  bkTrickBig = false;
  document.querySelectorAll('.bk-trick.big').forEach((x) => x.classList.remove('big'));
});
let batakHandNo = -1;
const batakBurySel = new Set<number>();
let batakHandIds = new Set<number>();
const suitName = (s: string, de: boolean) => (de ? { S: 'Pik', H: 'Herz', D: 'Karo', C: 'Kreuz' } : { S: 'Maça', H: 'Kupa', D: 'Karo', C: 'Sinek' })[s as 'S'] ?? s;
const suitHtml = (s: string) => h('span', { class: 'suit ' + (s === 'H' || s === 'D' ? 'red' : 'black') }, SUIT_SYM[s as 'S']);
function batakName(v: any, seatOrTeam: number, short = false) {
  if (v.team) return [seatOrTeam, seatOrTeam + 2].map((s) => (short ? (nameOf(s) ?? '?').split(' ')[0] : nameOf(s))).join(' & ');
  return short ? (nameOf(seatOrTeam) ?? '?').split(' ')[0] : nameOf(seatOrTeam);
}
/** Sprechblase über einem Spieler (Gebot / Pas) */
function batakBubble(seat: number, text: string, kind: 'pas' | 'bid' | 'win') {
  // immer an derselben Stelle: Mitte vom Tisch (die vorige Blase verschwindet sofort)
  document.querySelectorAll('.bk-bubble').forEach((x) => x.remove());
  const pos = world.screenOfTableCenter();
  const el = h('div', { class: 'bk-bubble ' + kind }, h('div', { class: 'bk-who' }, nameOf(seat) ?? ''), h('div', { class: 'bk-what' }, text));
  if (pos) {
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
  } else el.classList.add('mine');
  document.getElementById('ui')!.append(el);
  setTimeout(() => el.classList.add('out'), 1900);
  setTimeout(() => el.remove(), 2400);
}
/** großes Koz-Banner in der Mitte (Anfang jeder Hand) */
function batakTrumpBanner(suit: string, bidder: number, bid: number) {
  const de = getLang() === 'de';
  const el = h(
    'div',
    { class: 'bk-trump' },
    h('div', { class: 'muted' }, de ? `İhale: ${nameOf(bidder)} · ${bid}` : `İhale: ${nameOf(bidder)} · ${bid}`),
    h('div', { class: 'big' }, suitHtml(suit)),
    h('div', {}, 'Koz: ' + suitName(suit, de)),
  );
  document.getElementById('ui')!.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3200);
}
function batakFeedback(prev: any | null, v: any) {
  const e = v.lastEvent;
  if (!e || e.seq === batakLastSeq) return;
  const first = batakLastSeq === -1 && prev === null;
  batakLastSeq = e.seq;
  if (first && e.kind !== 'deal') return;
  world.batakAnimate(v);
  const de = getLang() === 'de';
  const who = nameOf(e.seat);
  switch (e.kind) {
    case 'deal':
      sfx.shuffle();
      break;
    case 'bid':
      sfx.tile();
      batakBubble(e.seat, e.bid === null ? 'Pas' : String(e.bid), e.bid === null ? 'pas' : 'bid');
      break;
    case 'contract':
      setTimeout(() => batakBubble(e.seat, de ? `İhale ${e.bid} ✓` : `İhale ${e.bid} ✓`, 'win'), 350);
      break;
    case 'trump':
      sfx.slam();
      batakTrumpBanner(e.suit, e.seat, v.contract?.bid ?? 0);
      break;
    case 'play':
      sfx.tile();
      break;
    case 'trick':
      setTimeout(() => sfx.slam(), 400);
      break;
    case 'handEnd': {
      const lr = v.lastResult;
      if (e.before) setTimeout(() => sfx.slam(), 400);
      if (lr) setTimeout(() => pistiNote(lr.made ? (de ? `${nameOf(lr.bidder)} hat es geschafft (${lr.bid})` : `${nameOf(lr.bidder)} tutturdu (${lr.bid})`) : de ? `${nameOf(lr.bidder)} ist batık!` : `${nameOf(lr.bidder)} battı!`), e.before ? 1500 : 0);
      break;
    }
  }
}
function renderBatak(v: any, top: HTMLElement, wrap: HTMLElement, zones: HTMLElement, result: HTMLElement) {
  const de = getLang() === 'de';
  // Eşli: beim Partner des Bieters ist der Bieter dran
  const isMe = (v.actor ?? v.current) === you.seat;
  const forDummy = isMe && v.dummy !== null && v.current === v.dummy && v.phase === 'play';
  const over = v.phase === 'handOver';
  let timer = '';
  if (st.turnDeadline) timer = ` · ${Math.max(0, Math.ceil((st.turnDeadline - Date.now()) / 1000))}s`;
  // --- oben: Stand, wer dran ist, Ihale/Koz
  top.innerHTML = '';
  top.classList.remove('mini');
  const phaseText: Record<string, [string, string]> = {
    bid: ['🗣 Ihale – wie viele Stiche?', '🗣 İhale – kaç el?'],
    trump: ['Koz wählen', 'Koz seç'],
    bury: ['4 Karten weglegen (gömmek)', '4 kart göm'],
    play: ['🂠 Du bist dran', '🂠 Sıra sende'],
  };
  const turnText = over
    ? v.gameOver
      ? t('gameOver')
      : t('handOver')
    : isMe
      ? phaseText[v.phase]?.[de ? 0 : 1] ?? ''
      : v.current === you.seat && v.dummy === you.seat
        ? de
          ? `${nameOf(v.actor)} legt deine Karte`
          : `${nameOf(v.actor)} senin kartını atıyor`
        : `${t('waitingFor')}: ${nameOf(v.actor ?? v.current)}`;
  const scoreBox = (label: string, val: number, mine: boolean) => h('div', { class: 'score' + (mine ? ' mine' : '') }, h('div', { class: 'muted' }, label), String(val));
  const info = h(
    'div',
    { class: 'okeyinfo pisti-info' },
    v.contract ? h('span', {}, `İhale: ${batakName(v, v.contract.seat, true)} ${v.contract.bid}`) : h('span', {}, de ? 'Ihale läuft' : 'İhale'),
    v.trump ? h('span', { class: 'bk-koz' }, 'Koz ', suitHtml(v.trump)) : null,
    you.seat !== null && v.phase === 'play' ? h('span', { class: 'muted' }, ` · ${de ? 'Stiche' : 'El'} ${v.team ? v.tricks[you.seat] + v.tricks[(you.seat + 2) % 4] : v.tricks[you.seat]}`) : null,
    h('span', { class: 'muted ok-meta' }, v.rules.handLimit ? ` · ${de ? 'Hand' : 'El'} ${v.history.length + (v.phase === 'handOver' ? 0 : 1)}/${v.rules.handLimit}` : ` · ${de ? 'bis' : 'hedef'} ${v.rules.target}`),
  );
  // aktueller Stich klein oben (falls man es auf dem Tisch schlecht erkennt)
  if (v.phase === 'play' && (v.trick as any[]).length) {
    info.append(
      h(
        'span',
        {
          class: 'bk-trick' + (bkTrickBig ? ' big' : ''),
          title: getLang() === 'de' ? 'Antippen zum Vergrößern' : 'Büyütmek için dokun',
          // Handy: antippen = groß, nochmal irgendwo tippen = normal (Maus: einfach drüberfahren)
          onpointerdown: (e: Event) => {
            e.stopPropagation();
            bkTrickBig = !bkTrickBig;
            (e.currentTarget as HTMLElement).classList.toggle('big', bkTrickBig);
          },
        },
        (v.trick as { seat: number; card: PCard }[]).map((tc) => h('span', { class: 'bk-tc' }, cardElement(tc.card), h('span', { class: 'bk-tn' }, (nameOf(tc.seat) ?? '?').split(' ')[0]))),
      ),
    );
  }
  if (v.team) {
    const mt = you.seat !== null ? you.seat % 2 : -1;
    top.append(scoreBox(batakName(v, 0, true), v.scores[0], mt === 0), h('div', { class: 'turn' + (isMe && !over ? ' me' : '') }, turnText, timer), info, scoreBox(batakName(v, 1, true), v.scores[1], mt === 1));
  } else {
    // alle Spieler kompakt in einem Kasten (sonst wird die Leiste zu breit)
    top.append(
      h('div', { class: 'turn' + (isMe && !over ? ' me' : '') }, turnText, timer),
      info,
      h(
        'div',
        { class: 'score batak-scores' },
        (v.seats as number[]).map((s) => h('div', { class: 'bs' + (s === you.seat ? ' mine' : '') + (v.contract?.seat === s ? ' bidder' : '') }, h('span', { class: 'muted' }, batakName(v, s, true)), h('b', {}, String(v.scores[s])), v.phase === 'play' || v.phase === 'handOver' ? h('span', { class: 'muted' }, ` (${v.tricks[s]})`) : null)),
      ),
    );
  }
  // --- Hand + Aktionen
  wrap.innerHTML = '';
  wrap.classList.toggle('hidden', you.seat === null && you.watching === null);
  const bar = h('div', { class: 'actions-bar pisti-bar' });
  if (you.seat === null) {
    wrap.append(h('div', { class: 'row' }, h('span', { class: 'muted' }, t('watching') + ':'), (v.seats as number[]).map((s) => h('button', { class: 'small ' + (you.watching === s ? 'primary' : 'ghost'), onclick: () => (send({ type: 'watch', seat: s }), watchAt(s)) }, nameOf(s)))));
  }
  // Gebote der anderen
  if (v.phase === 'bid') {
    bar.append(
      h(
        'span',
        { class: 'pb-text' },
        (v.seats as number[])
          .map((s) => {
            const b = v.bids[s];
            return `${(nameOf(s) ?? '?').split(' ')[0]}: ${b === 'wait' ? '…' : b === null ? 'Pas' : b}`;
          })
          .join(' · '),
      ),
    );
    if (isMe) {
      const btns: HTMLElement[] = [];
      for (let n = v.nextMinBid; n <= v.maxBid && btns.length < 9; n++) {
        const val = n;
        btns.push(h('button', { class: 'small primary', onclick: () => act({ action: 'bid', bid: val }) }, String(val)));
      }
      bar.append(...btns, h('button', { class: 'small', onclick: () => act({ action: 'bid', bid: null }) }, 'Pas'));
    }
  } else if (v.phase === 'trump' && isMe) {
    bar.append(h('span', { class: 'pb-text' }, de ? 'Koz wählen:' : 'Koz seç:'), ...(['S', 'H', 'C', 'D'] as const).map((su) => h('button', { class: 'suitbtn', onclick: () => act({ action: 'trump', suit: su }) }, suitHtml(su), ' ', suitName(su, de))));
  } else if (v.phase === 'bury' && isMe) {
    bar.append(
      h('span', { class: 'pb-text' }, de ? `4 Karten antippen (${batakBurySel.size}/4)` : `4 kart seç (${batakBurySel.size}/4)`),
      h('button', { class: 'primary', disabled: batakBurySel.size !== 4, onclick: () => (act({ action: 'bury', cardIds: [...batakBurySel] }), batakBurySel.clear()) }, de ? 'Weglegen' : 'Göm'),
    );
  }
  const legal = new Set<number>(v.legal ?? []);
  const hand = h('div', { class: 'pisti-hand batak-hand' + (isMe && v.phase === 'play' ? ' myturn' : '') });
  const cards = v.myHand as PCard[];
  const fresh = cards.filter((c) => !batakHandIds.has(c.id));
  batakHandIds = new Set(cards.map((c) => c.id));
  cards.forEach((c, idx) => {
    const el = cardElement(c);
    if (fresh.length >= 4 && fresh.some((x) => x.id === c.id)) {
      el.classList.add('dealt');
      el.style.animationDelay = `${0.2 + idx * 0.04}s`;
    }
    if (isMe && v.phase === 'play') {
      if (legal.has(c.id)) {
        el.classList.add('playable');
        el.onclick = () => {
          el.classList.add('thrown');
          act({ action: 'play', cardId: c.id });
        };
      } else el.classList.add('dim');
    } else if (isMe && v.phase === 'bury') {
      el.classList.add('playable');
      if (batakBurySel.has(c.id)) el.classList.add('sel');
      el.onclick = () => {
        if (batakBurySel.has(c.id)) batakBurySel.delete(c.id);
        else if (batakBurySel.size < 4) batakBurySel.add(c.id);
        renderGame();
      };
    }
    hand.append(el);
  });
  // Eşli: offene Karten vom Partner des Bieters groß für alle; legen darf nur der Bieter
  if (v.open) {
    const dl = new Set<number>(v.dummyLegal ?? []);
    const row = h('div', { class: 'pisti-hand batak-hand batak-dummy' + (forDummy ? ' myturn' : '') });
    (v.open.cards as PCard[]).forEach((c) => {
      const el = cardElement(c);
      if (forDummy) {
        if (dl.has(c.id)) {
          el.classList.add('playable');
          el.onclick = () => {
            el.classList.add('thrown');
            act({ action: 'play', cardId: c.id });
          };
        } else el.classList.add('dim');
      }
      row.append(el);
    });
    const mineBid = v.contract?.seat === you.seat;
    const label = mineBid ? (de ? 'Partner: ' : 'Eş: ') + (nameOf(v.open.seat) ?? '') : (de ? 'Offen: ' : 'Açık: ') + (nameOf(v.open.seat) ?? '') + (de ? ` (legt ${nameOf(v.contract.seat)})` : ` (${nameOf(v.contract.seat)} atar)`);
    // eigener Kasten (am Handy oben am Bildschirm, damit die Tischmitte frei bleibt)
    const box = slot('dummy', 'dummy-box');
    box.innerHTML = '';
    box.classList.toggle('myturn', forDummy);
    box.append(h('div', { class: 'dummy-label' }, label), row);
  } else {
    els.dummy?.remove();
  }
  wrap.append(bar, hand);
  zones.classList.add('hidden');
  // --- Handende (kurz warten, damit man den letzten Stich und wohin er ging noch sieht)
  result.classList.toggle('hidden', !over || resultHidden());
  if (!over || resultHidden()) return;
  result.innerHTML = '';
  const isOwner = table!.ownerId === myId;
  const lr = v.lastResult;
  if (lr) {
    const rows = v.team
      ? [0, 1].map((tm) => h('tr', {}, h('td', {}, batakName(v, tm, true)), h('td', {}, String(v.tricks[tm] + v.tricks[tm + 2])), h('td', { class: lr.points[tm] < 0 ? 'neg' : '' }, (lr.points[tm] > 0 ? '+' : '') + lr.points[tm]), h('td', {}, String(v.scores[tm]))))
      : (v.seats as number[]).map((s) => h('tr', {}, h('td', {}, batakName(v, s, true) + (s === lr.bidder ? ` (İhale ${lr.bid})` : '')), h('td', {}, String(lr.tricks[s])), h('td', { class: lr.points[s] < 0 ? 'neg' : '' }, (lr.points[s] > 0 ? '+' : '') + lr.points[s]), h('td', {}, String(v.scores[s]))));
    result.append(
      h('h2', {}, v.gameOver ? `🏆 ${t('winner')}: ${batakName(v, v.winner)}` : lr.made ? (de ? `✓ ${nameOf(lr.bidder)} hat ${lr.bid} geschafft` : `✓ ${nameOf(lr.bidder)} ${lr.bid} tutturdu`) : de ? `✗ ${nameOf(lr.bidder)} ist batık` : `✗ ${nameOf(lr.bidder)} battı`),
      h('div', { class: 'muted', style: { textAlign: 'center' } }, 'Koz ', suitHtml(lr.trump)),
      h('table', { class: 'pisti-result' }, h('tr', {}, h('th', {}, ''), h('th', {}, de ? 'Stiche' : 'El'), h('th', {}, de ? 'Runde' : 'Puan'), h('th', {}, 'Σ')), ...rows),
    );
  }
  if (v.gameOver) {
    result.append(h('div', { class: 'row', style: { justifyContent: 'center' } }, isOwner ? h('button', { class: 'primary', onclick: () => send({ type: 'rematch' }) }, '🔁 ' + t('rematch')) : null, isOwner ? h('button', { onclick: () => send({ type: 'backToLobby' }) }, t('toLobby')) : null));
    return;
  }
  const ready = new Set(table!.ready ?? []);
  const humans = table!.seats.map((p, i) => [p, i] as const).filter(([p]) => p && !p.bot);
  const iAmReady = you.seat !== null && ready.has(you.seat);
  appendAll(
    result,
    h('div', { class: 'readyrow' }, humans.map(([p, i]) => h('span', { class: 'rd ' + (ready.has(i) ? 'ok' : '') }, (ready.has(i) ? '✅ ' : '⏳ ') + p!.name))),
    h(
      'div',
      { class: 'row', style: { justifyContent: 'center' } },
      you.seat !== null ? h('button', { class: iAmReady ? 'ghost' : 'primary', onclick: () => send({ type: 'ready', ready: !iAmReady }) }, iAmReady ? (de ? '↩ Doch nicht bereit' : '↩ Hazır değilim') : de ? '✓ Bereit für die nächste Hand' : '✓ Sonraki ele hazırım') : null,
      isOwner ? h('button', { onclick: () => send({ type: 'nextHand' }) }, de ? '▶ Jetzt starten (Tischbesitzer)' : '▶ Hemen başlat (masa sahibi)') : null,
    ),
  );
}
function renderBatakSheet(el: HTMLElement, v: any) {
  el.innerHTML = '';
  const cols: number[] = v.team ? [0, 1] : v.seats;
  const tbl = h('table', {}, h('tr', {}, h('th', {}, '#'), ...cols.map((c) => h('th', {}, batakName(v, c, true)))));
  (v.history as any[]).forEach((r, i) => {
    const fresh = i >= seenRows;
    tbl.append(
      h(
        'tr',
        {},
        h('td', {}, `${i + 1}${SUIT_SYM[r.trump as 'S']}`),
        ...cols.map((c) => {
          const p = v.team ? r.points[c] : r.points[c];
          return h('td', { class: p < 0 ? 'neg' : '' }, h('span', { class: fresh ? 'write' : '', style: { animationDelay: fresh ? `${(i - seenRows) * 0.4}s` : '0s' } }, String(p)));
        }),
      ),
    );
  });
  tbl.append(h('tr', { class: 'total' }, h('td', {}, 'Σ'), ...cols.map((c) => h('td', {}, String(v.scores[c])))));
  seenRows = v.history.length;
  el.append(h('div', { class: 'tear' }, `— ✂ — Batak · ${v.rules.handLimit ? v.rules.handLimit + (getLang() === 'de' ? ' Hände' : ' el') : v.rules.target}`), tbl);
}

function renderPistiSheet(el: HTMLElement, v: any) {
  el.innerHTML = '';
  const tbl = h('table', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, pistiTeamName(v, 0, true)), h('th', {}, pistiTeamName(v, 1, true))));
  (v.history as { points: [number, number]; result: any }[]).forEach((r, i) => {
    const fresh = i >= seenRows;
    const cell = (n: number) => h('td', {}, h('span', { class: fresh ? 'write' : '', style: { animationDelay: fresh ? `${(i - seenRows) * 0.4}s` : '0s' } }, String(n)));
    tbl.append(h('tr', {}, h('td', {}, String(i + 1)), cell(r.points[0]), cell(r.points[1])));
    const notes = [0, 1].map((tm) => (r.result.teams[tm].pistis ? `${r.result.teams[tm].pistis}× Pişti` : '')).filter(Boolean);
    if (notes.length) tbl.append(h('tr', {}, h('td', {}, ''), h('td', { class: 'note', colSpan: 2 }, notes.join(' · '))));
  });
  tbl.append(h('tr', { class: 'total' }, h('td', {}, 'Σ'), h('td', {}, String(v.scores[0])), h('td', {}, String(v.scores[1]))));
  seenRows = v.history.length;
  el.append(h('div', { class: 'tear' }, `— ✂ — Pişti · ${v.target}`), tbl);
}

function renderActions() {
  if (st?.view?.kind === 'pisti' || st?.view?.kind === 'batak') return;
  const bar = document.getElementById('actions');
  if (!bar || !st) return;
  bar.innerHTML = '';
  const v = st.view;
  const r = table!.rules;
  const sel = [...istaka.selected];
  const one = sel.length === 1 ? sel[0] : null;
  const btn = (label: string, on: boolean, fn: () => void, cls = '') => h('button', { class: 'small ' + cls, disabled: !on, onclick: fn }, label);
  if (you.seat === null) return;
  if (v.phase === 'handOver' || v.gameOver) {
    if (!r.hardMode) bar.append(btn(t('sortRuns'), true, () => istaka.sortRuns(), 'ghost'), btn(t('sortPairs'), true, () => istaka.sortPairs(), 'ghost'));
    return;
  }
  const draw = myTurn('draw');
  const disc = myTurn('discard');
  // nur die Knöpfe, die gerade passen: erst ziehen, dann werfen/beenden
  if (draw)
    bar.append(
      btn('🀫 ' + t('drawPile'), true, () => act({ action: 'drawPile' }), 'primary'),
      btn('↘ ' + t('drawSide'), !!st.topDiscards[(you.seat + 3) % 4] && !v.okeyBirTile, () => act({ action: 'drawDiscard' })),
    );
  if (disc)
    bar.append(
      btn('⬇ ' + t('discard'), one !== null, () => act({ action: 'discard', tileId: one })),
      btn('🏁 ' + t('finish'), one !== null, () => tryFinish(one!), 'primary'),
    );
  if (v.current === you.seat && v.players?.[you.seat]?.discards?.length === 0) bar.append(btn('👁 ' + t('showIndicator'), true, () => act({ action: 'showIndicator' })));
  if (r.mode === 'perisan') bar.append(btn('🀄 ' + t('okeyBir'), disc && one !== null && !v.okeyBirTile, () => act({ action: 'okeyBir', tileId: one }), 'danger'));
  if (r.mode === 'okey101') {
    bar.append(
      btn('📤 ' + t('open'), disc, () => {
        const groups = istaka.groups(sel.length > 0).filter((g) => g.length >= 2);
        const melds = groups.every((g) => g.length === 2) ? groups : groups.filter((g) => g.length >= 3);
        if (!melds.length) return toast(t('selectMeld'));
        act({ action: 'open', melds });
      }),
      h('span', { class: 'muted' }, '➕ ' + t('layoff') + ': ' + t('selectMeld')),
    );
  }
  if (r.stealing?.enabled) {
    bar.append(btn('💨 ' + t('steal'), disc && one !== null, () => act({ action: 'steal', tileId: one }), 'ghost'));
    if (v.current !== you.seat) bar.append(btn('🚨 ' + t('accuse') + ' → ' + nameOf(v.current), true, () => act({ action: 'accuse', target: v.current }), 'danger'));
  }
  if (!r.hardMode) bar.append(btn(t('sortRuns'), true, () => istaka.sortRuns(), 'ghost'), btn(t('sortPairs'), true, () => istaka.sortPairs(), 'ghost'));
}
setInterval(() => {
  if (st?.turnDeadline && inCafe) renderGame();
}, 1000);

// ------------------------------------------------------------------ Zettel (Yaz-boz)

function renderSheet() {
  const el = slot('sheet', 'sheet');
  const show = sheetOpen && !!st && table!.started;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const v = st.view;
  if (v.kind === 'pisti') return renderPistiSheet(el, v);
  if (v.kind === 'batak') return renderBatakSheet(el, v);
  const rows = v.sheet as { hand: number; teamDelta: [number, number]; totals: [number, number]; notes: string[] }[];
  const short = (team: number) => [team, team + 2].map((s) => (table!.seats[s]?.name ?? '?').split(' ')[0]).join('-');
  el.innerHTML = '';
  const tbl = h('table', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, short(0)), h('th', {}, short(1))));
  const standard = table!.rules.mode === 'standard';
  if (standard) tbl.append(h('tr', {}, h('td', {}, ''), h('td', {}, String(table!.rules.startPoints)), h('td', {}, String(table!.rules.startPoints))));
  rows.forEach((r, i) => {
    const fresh = i >= seenRows;
    const cell = (n: number) => h('td', { class: n < 0 ? 'neg' : '' }, h('span', { class: fresh ? 'write' : '', style: { animationDelay: fresh ? `${(i - seenRows) * 0.4}s` : '0s' } }, String(n)));
    tbl.append(h('tr', {}, h('td', {}, String(r.hand)), cell(standard ? r.totals[0] : r.teamDelta[0]), cell(standard ? r.totals[1] : r.teamDelta[1])));
    const note = r.notes.filter(Boolean).join(', ');
    if (note) tbl.append(h('tr', {}, h('td', {}, ''), h('td', { class: 'note', colSpan: 2 }, note)));
  });
  if (!standard)
    tbl.append(h('tr', { class: 'total' }, h('td', {}, 'Σ'), h('td', {}, String(v.teamScores[0])), h('td', {}, String(v.teamScores[1]))));
  seenRows = rows.length;
  el.append(h('div', { class: 'tear' }, '— ✂ —'), tbl);
  // Unterschriften
  const sigs = h('div', { class: 'sigs' });
  for (const [seat, sig] of Object.entries(table!.signatures ?? {})) sigs.append(h('img', { src: sig, title: nameOf(Number(seat)) }));
  if (Object.keys(table!.signatures ?? {}).length) el.append(sigs);
}

// ------------------------------------------------------------------ TV / Musik

function openMedia() {
  const isOwner = table!.ownerId === myId;
  const tvInput = h('input', { placeholder: t('linkPlaceholder'), style: { flex: '1' } });
  const musicInput = h('input', { placeholder: t('linkPlaceholder') + ' / ' + t('streamPlaceholder'), style: { flex: '1' } });
  const ownInput = h('input', { placeholder: 'YouTube / Spotify / Radio-Stream', value: settings.ownMusicUrl, style: { flex: '1' } });
  const loadSrc = (kind: 'tv' | 'music', url: string) => {
    const id = parseYouTube(url);
    const ch = kind === 'tv' ? parseTwitch(url) : null;
    if (id) send({ type: kind, action: 'load', source: { kind: 'youtube', id } });
    else if (ch) send({ type: kind, action: 'load', source: { kind: 'twitch', channel: ch } });
    else if (kind === 'tv' && /^https?:\/\//.test(url)) toast(getLang() === 'de' ? 'Der Fernseher spielt YouTube- und Twitch-Links' : 'Televizyon YouTube ve Twitch linklerini oynatır');
    else if (/^https?:\/\//.test(url)) send({ type: kind, action: 'load', source: { kind: 'stream', url } });
    else toast('Link?');
  };
  const controls = (kind: 'tv' | 'music') =>
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'small', onclick: () => send({ type: kind, action: 'play' }) }, '▶ ' + t('resume')),
      h('button', { class: 'small', onclick: () => send({ type: kind, action: 'pause' }) }, '⏸ ' + t('pause')),
      h('button', { class: 'small', onclick: () => send({ type: kind, action: 'seek', position: curPos(kind) - 10 }) }, '⏪ 10s'),
      h('button', { class: 'small', onclick: () => send({ type: kind, action: 'seek', position: curPos(kind) + 10 }) }, '10s ⏩'),
      h('button', { class: 'small danger', onclick: () => send({ type: kind, action: 'stop' }) }, '⏹ ' + t('stop')),
      h('input', { type: 'range', min: 0, max: 100, value: (kind === 'tv' ? table!.tv : table!.music).volume, onchange: (e: Event) => send({ type: kind, action: 'volume', volume: Number((e.target as HTMLInputElement).value) }) }),
    );
  const modeSel = (key: 'tvMode' | 'musicMode', opts: [string, string][]) =>
    h(
      'select',
      { onchange: (e: Event) => ((settings[key] = (e.target as HTMLSelectElement).value as any), saveSettings(), applyMedia()) },
      opts.map(([v, l]) => h('option', { value: v, selected: settings[key] === v }, l)),
    );
  modal(
    h('h2', {}, '📺 ' + t('tv')),
    h('label', { class: 'row' }, t('tv') + ':', modeSel('tvMode', [['table', t('forAll')], ['own', getLang() === 'de' ? 'Eigenes Programm (nur du)' : 'Kendi yayının (sadece sen)'], ['off', t('off')]])),
    isOwner ? h('div', { class: 'col', style: { margin: '8px 0 16px' } }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, tvInput, h('button', { class: 'primary small', onclick: () => loadSrc('tv', tvInput.value) }, t('load'))), controls('tv')) : you.seat !== null ? h('div', { class: 'muted', style: { marginBottom: '14px' } }, t('onlyOwner')) : null,
    // Zuschauer (und wer „Eigenes Programm“ gewählt hat): eigenes YouTube/Twitch auf dem Fernseher, nur für sich
    you.seat === null || settings.tvMode === 'own' || !isOwner ? ownTvBlock() : null,
    h('h2', {}, '📻 Radio'),
    h(
      'div',
      { class: 'muted', style: { marginBottom: '6px' } },
      getLang() === 'de'
        ? 'Läuft automatisch im Kahvehane. Sobald Tisch-Musik, der Fernseher oder deine eigene Musik läuft, macht das Radio Platz.'
        : 'Kahvehanede kendiliğinden çalar. Masa müziği, TV ya da kendi müziğin açılınca radyo susar.',
    ),
    h('div', { class: 'row' }, radioSelect(), h('button', { class: 'small', onclick: () => bgm.nextTrack() }, '⏭'), muteButton()),
    h('h2', { style: { marginTop: '14px' } }, '🎵 ' + t('music')),
    h('label', { class: 'row' }, t('music') + ':', modeSel('musicMode', [['table', t('forAll')], ['off', t('off')], ['own', t('ownMusic')]])),
    isOwner ? h('div', { class: 'col', style: { margin: '8px 0' } }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, musicInput, h('button', { class: 'primary small', onclick: () => loadSrc('music', musicInput.value) }, t('load'))), controls('music')) : h('div', { class: 'muted' }, t('onlyOwner')),
    h(
      'div',
      { class: 'col', style: { marginTop: '10px' } },
      h('label', {}, t('ownMusic') + ' · YouTube / 🟢 Spotify'),
      h(
        'div',
        { class: 'row', style: { flexWrap: 'nowrap' } },
        ownInput,
        h('button', { class: 'small primary', onclick: () => ((settings.ownMusicUrl = ownInput.value.trim()), (settings.musicMode = 'own'), saveSettings(), applyMedia()) }, t('load')),
        h('button', { class: 'small ghost', title: 'aus', onclick: () => ((settings.musicMode = 'table'), saveSettings(), spotify.close(), applyMedia()) }, '⏹'),
      ),
      h(
        'div',
        { class: 'muted' },
        getLang() === 'de'
          ? 'Nur du hörst sie. Spotify: Playlist-Link einfügen, im Player ▶ drücken – mit Spotify-Login ganze Songs, sonst 30-s-Vorschau. Das Radio geht dabei automatisch aus.'
          : 'Sadece sen duyarsın. Spotify: liste linkini yapıştır, oynatıcıda ▶ bas – Spotify girişiyle tam şarkı, yoksa 30 sn önizleme. Radyo otomatik susar.',
      ),
    ),
  );
}

function ownTvBlock() {
  const de = getLang() === 'de';
  const input = h('input', { placeholder: 'YouTube / Twitch', value: settings.ownTvUrl, style: { flex: '1' } }) as HTMLInputElement;
  const load = () => {
    const src = ownTvSource(input.value.trim());
    if (!src) return toast(de ? 'Der Fernseher spielt YouTube- und Twitch-Links' : 'Televizyon YouTube ve Twitch linklerini oynatır');
    settings.ownTvUrl = input.value.trim();
    settings.tvMode = 'own';
    saveSettings();
    Object.assign(ownTv, { source: src, position: 0, playing: true, at: Date.now() });
    applyMedia();
    closeOverlays();
  };
  return h(
    'div',
    { class: 'col', style: { margin: '6px 0 16px' } },
    h('label', {}, '📺 ' + (de ? 'Dein eigenes Programm – nur du siehst es' : 'Kendi yayının – sadece sen görürsün')),
    h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, input, h('button', { class: 'primary small', onclick: load }, t('load'))),
    settings.tvMode === 'own' && ownTv.source
      ? h(
          'div',
          { class: 'row' },
          h('button', { class: 'small', onclick: () => ownTvDo('play') }, '▶'),
          h('button', { class: 'small', onclick: () => ownTvDo('pause') }, '⏸'),
          h('button', { class: 'small', onclick: () => ownTvDo('seek', -10) }, '⏪ 10s'),
          h('button', { class: 'small', onclick: () => ownTvDo('seek', 10) }, '10s ⏩'),
          h('button', { class: 'small danger', title: de ? 'Zurück zum gemeinsamen Programm' : 'Ortak yayına dön', onclick: () => (ownTvDo('stop'), closeOverlays()) }, '⏹'),
          h('input', { type: 'range', min: 0, max: 100, value: ownTv.volume, onchange: (e: Event) => ownTvDo('volume', Number((e.target as HTMLInputElement).value)) }),
        )
      : null,
  );
}

function curPos(kind: 'tv' | 'music') {
  const s = kind === 'tv' ? table!.tv : table!.music;
  return s.playing ? s.position + (Date.now() - s.at) / 1000 : s.position;
}

// ------------------------------------------------------------------ Start

showMenu();

// Debug-Zugriff (Konsole / automatische Tests)
// iOS ignoriert user-scalable=no: Doppeltipp- und Pinch-Zoom selbst abfangen
{
  let lastEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      const tag = (e.target as HTMLElement)?.tagName;
      if (now - lastEnd < 320 && tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault();
      lastEnd = now;
    },
    { passive: false },
  );
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false } as any);
  document.addEventListener('touchmove', (e) => (e as TouchEvent).touches.length > 1 && e.preventDefault(), { passive: false });
}
/** Emotes/Shisha mit 2 s Pause, damit niemand vollspammt */
let lastEmoteAt = 0;
function sendEmote(k: string) {
  const now = Date.now();
  if (now - lastEmoteAt < 2000) {
    toast(getLang() === 'de' ? '⏳ Kurz warten…' : '⏳ Biraz bekle…');
    return;
  }
  lastEmoteAt = now;
  send({ type: 'emote', key: k });
}
// ------------------------------------------------------------------ nur Querformat
// Android: beim ersten Tippen Vollbild + Querformat sperren. iPhone (kann nicht sperren): im Hochformat Hinweis „Handy drehen“.
{
  const isPortrait = () => innerHeight > innerWidth;
  const touchDev = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
  const cover = h('div', { class: 'rotate-cover hidden' }, h('div', { class: 'rc-icon' }, '📱'), h('div', { class: 'rc-text' }));
  document.body.append(cover);
  const sync = () => {
    const show = touchDev && isPortrait();
    cover.classList.toggle('hidden', !show);
    (cover.querySelector('.rc-text') as HTMLElement).textContent =
      getLang() === 'de' ? 'Bitte dreh dein Handy ins Querformat' : 'Lütfen telefonunu yan çevir';
  };
  const lock = async () => {
    const o: any = (screen as any).orientation;
    if (!touchDev || !o?.lock) return;
    try {
      await o.lock('landscape');
    } catch {
      // meist nur im Vollbild erlaubt → Vollbild versuchen, dann nochmal
      try {
        const el: any = document.documentElement;
        if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        await o.lock('landscape');
      } catch {}
    }
  };
  void lock(); // installierte App: klappt oft sofort
  addEventListener('pointerdown', () => void lock(), { once: true, capture: true });
  addEventListener('resize', sync);
  addEventListener('orientationchange', () => setTimeout(sync, 200));
  sync();
}
(window as any).__okey = { world, send, istaka, bgm, get state() { return st; }, get table() { return table; } };

// Sicherheitsnetz: zurück in der App → hängengebliebene, schwebende Steine/Karten entfernen
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  document.querySelectorAll('.dragghost').forEach((g) => g.remove());
  document.querySelectorAll('.tile.dragging').forEach((t) => t.classList.remove('dragging'));
  document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
});
