// Okeyhane Client: Menü, Kahvehane, Tisch-UI

import './style.css';
import type { Tile, OkeyIdentity } from '@okeyhane/engine';
import type { MediaState, PlayerInfo } from '../../server/src/protocol.ts';
import { connect, send, on } from './net.ts';
import { h, toast } from './dom.ts';
import { t, setLang, getLang } from './i18n.ts';
import { World, type GameVisual } from './scene.ts';
import { Istaka } from './istaka.ts';
import { openEditor } from './editor.ts';
import { MediaPlayer, parseTwitch, parseYouTube } from './media.ts';
import { Voice } from './voice.ts';
import { sfx, unlockAudio } from './sound.ts';
import { settings, saveSettings, vol, defaultAvatar, loadProfile, saveProfile, keyLabel, defaultKeys, type Profile, type KeyBinds } from './settings.ts';
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
  spectators: { id: string; name: string; watching: number | null }[];
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
let stats: Record<string, { wins: number; losses: number }> = {};
let table: TableSummary | null = null;
let you: { id: string; seat: number | null; watching: number | null } = { id: '', seat: null, watching: null };
let st: any = null; // letzter Spielzustand
let inCafe = false;
  document.body.classList.remove('incafe');
let sheetOpen = false;
let seenRows = 0;
let lastHandNo = -1;
let chatLog: HTMLElement[] = [];

const ui = document.getElementById('ui')!;
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
  rejoining = false;
  const prevStarted = table?.started;
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
  if (prevStarted && !table!.started) {
    // Spiel beendet → alle stehen auf
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
  applyMedia();
  renderAll();
});
on('state', (m) => {
  const prev = st;
  st = m;
  const v = m.view;
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
    sheetOpen = true;
    if (m.lastResult?.note) toast(m.lastResult.note, '#2d5a3a');
  }
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
  if (m.smoke) {
    setTimeout(() => world.smokeCloud(), 1400);
    addLog(h('div', { class: 'sys' }, `${nameOf(m.seat)} 💨`));
  }
});
/** Ruf nach Ahmet (bei jeder Bestellung, für alle am Tisch) */
const ahmetCall = new Audio('/sfx/ahmet.mp3');
ahmetCall.preload = 'auto';
on('order', (m) => {
  const item = m.item as OrderItem;
  try {
    const a = ahmetCall.cloneNode(true) as HTMLAudioElement;
    a.volume = Math.min(1, vol('volSfx') * (m.seat === you.seat ? 1 : 0.8));
    void a.play().catch(() => {});
  } catch {}
  world.order(m.seat, item, m.variant ?? 0);
  addLog(h('div', { class: 'sys' }, `${m.from}: ${orderLabel(item)} ${getLang() === 'de' ? 'bestellt' : 'söyledi'}`));
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

function applyMedia() {
  if (!table) {
    tv.stopAll();
    music.stopAll();
    world.setTvVisible(false);
    spotify.close();
    bgm.setBusy(false);
    return;
  }
  tv.enabled = settings.tvMode === 'table';
  tv.apply(table.tv);
  world.setTvVisible(tv.enabled && !!table.tv.source);
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
  const tableTv = tv.enabled && !!table.tv.source && table.tv.playing;
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
  const modes = ['standard', 'okey101', 'perisan'];
  const rows = modes.map((m) => {
    const s = stats[m] ?? { wins: 0, losses: 0 };
    return h('tr', {}, h('td', {}, t(m)), h('td', {}, String(s.wins)), h('td', {}, String(s.losses)));
  });
  modal(
    h('h2', {}, t('stats') + ' · ' + (profile.name || '')),
    h('table', { style: { width: '100%' } }, h('tr', {}, h('th', {}, t('mode')), h('th', {}, t('wins')), h('th', {}, t('losses'))), rows),
  );
}

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
  modal(
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
      check('smoke', t('smoke')),
      check('pushToTalk', t('pushToTalk')),
      check('menuMusic', getLang() === 'de' ? '🎶 Musik im Menü' : '🎶 Menüde müzik'),
      check('musicMuted', getLang() === 'de' ? '🔇 Menümusik & Radio stumm' : '🔇 Menü müziği & radyo sessiz'),
      h('label', {}, '📻 Radio', radioSelect()),
      select('quality', t('quality'), [
        ['high', 'High'],
        ['low', 'Low'],
      ]),
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
      if (table.started && occ?.bot) send({ type: 'sit', seat });
      else {
        send({ type: 'watch', seat });
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
  if (m.action === 'drawPile' && !istaka.flyFrom) istaka.flyFrom = world.screenOf('pile');
  if (m.action === 'drawDiscard' && !istaka.flyFrom) istaka.flyFrom = world.screenOf('side');
  send({ type: 'action', ...m });
  if (m.action === 'discard' || m.action === 'finish' || m.action === 'okeyBir') istaka.selected.clear();
}

/** Beenden nur mit fertiger Hand und nach Bestätigung (nie aus Versehen) */
function tryFinish(id: number) {
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
        h('span', {}, voiceDot(p.id, isMe), `${s % 2 === 0 ? '🔵' : '🔴'} ${p.name}${p.bot ? ' 🤖' : ''}${p.id === table!.ownerId ? ' 👑' : ''}${isMe ? (getLang() === 'de' ? ' (du)' : ' (sen)') : ''}`),
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
    table!.started ? h('button', { class: 'small', title: t('sheet'), onclick: () => ((sheetOpen = !sheetOpen), renderSheet()) }, L('📝', t('sheet'))) : null,
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
  toggleSheet: () => {
    if (!table?.started) return;
    sheetOpen = !sheetOpen;
    renderSheet();
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
    ORDER_ITEMS.map((i) => ({ label: orderLabel(i), fn: () => ((lastOrderAt = Date.now()), send({ type: 'order', item: i })) })),
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
  table!.seats.forEach((p, s) => {
    seats.append(
      h(
        'div',
        { class: 'seat ' + (s % 2 === 0 ? 'teamA' : 'teamB') },
        h('div', { class: 'muted' }, s % 2 === 0 ? t('teamA') : t('teamB')),
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
    h(
      'label',
      { class: 'full' },
      t('mode'),
      h(
        'select',
        { disabled: dis, onchange: (e: Event) => send({ type: 'setRules', rules: { mode: (e.target as HTMLSelectElement).value } }) },
        ['standard', 'okey101', 'perisan'].map((m) => h('option', { value: m, selected: r.mode === m }, t(m))),
      ),
    ),
  );
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
  wrap.classList.toggle('hidden', !playing || (you.seat === null && you.watching === null));
  if (!playing) {
    zones.classList.add('hidden');
    result.classList.add('hidden');
    return;
  }
  const v = st.view;
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
  const over = v.phase === 'handOver' || v.gameOver;
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

function renderActions() {
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
    h('label', { class: 'row' }, t('tv') + ':', modeSel('tvMode', [['table', t('forAll')], ['off', t('off')]])),
    isOwner ? h('div', { class: 'col', style: { margin: '8px 0 16px' } }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, tvInput, h('button', { class: 'primary small', onclick: () => loadSrc('tv', tvInput.value) }, t('load'))), controls('tv')) : h('div', { class: 'muted', style: { marginBottom: '14px' } }, t('onlyOwner')),
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
(window as any).__okey = { world, send, istaka, bgm, get state() { return st; }, get table() { return table; } };
