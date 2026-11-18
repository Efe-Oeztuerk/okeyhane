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
import { MediaPlayer, parseYouTube } from './media.ts';
import { Voice } from './voice.ts';
import { sfx, unlockAudio } from './sound.ts';
import { settings, saveSettings, defaultAvatar, loadProfile, saveProfile, keyLabel, defaultKeys, type Profile, type KeyBinds } from './settings.ts';
import { tileElement } from './tileArt.ts';
import { CREDITS } from './models.ts';
import { setupControls, popupMenu, closeMenu, keyHintLine, touchActive, PAD_HELP } from './controls.ts';
import { SPOTS, ORDER_ITEMS, type OrderItem } from './scene.ts';

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
}

let profile: Profile = loadProfile() ?? { name: '', avatar: { ...defaultAvatar }, signature: null };
let myId = '';
let stats: Record<string, { wins: number; losses: number }> = {};
let table: TableSummary | null = null;
let you: { id: string; seat: number | null; watching: number | null } = { id: '', seat: null, watching: null };
let st: any = null; // letzter Spielzustand
let inCafe = false;
let sheetOpen = false;
let seenRows = 0;
let lastHandNo = -1;
let chatLog: HTMLElement[] = [];

const ui = document.getElementById('ui')!;
const world = new World(document.getElementById('world')!);
const tv = new MediaPlayer(world.tvHost, 'volTv', true);
const musicHost = h('div', { id: 'music-host' });
document.body.append(musicHost);
const music = new MediaPlayer(musicHost, 'volMusic', false);
const ownHost = h('div', { id: 'music-host' });
document.body.append(ownHost);
const ownMusic = new MediaPlayer(ownHost, 'volMusic', false);
const voice = new Voice();
const istaka = new Istaka();

// ------------------------------------------------------------------ Netzwerk

function hello() {
  send({ type: 'hello', name: profile.name || 'Oyuncu', avatar: profile.avatar, signature: profile.signature });
}
connect(() => {
  hello();
  // nach Verbindungsabbruch: zurück zum Tisch
  const code = sessionStorage.getItem('tableCode');
  if (code && inCafe) send({ type: 'joinTable', code });
});

on('welcome', (m) => {
  myId = m.id;
  stats = m.stats ?? {};
  voice.setMe(myId);
});
on('table', (m) => {
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
  if (!table!.started) {
    st = null;
    world.setGame(null);
    istaka.clear();
  }
  voice.syncMembers([...table!.seats.map((s) => s?.id ?? ''), ...table!.spectators.map((s) => s.id)]);
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
  world.emote(m.seat, m.key);
  if (m.seat !== null && m.seat === you.seat) selfFeedback(m.key);
  if (m.smoke) {
    setTimeout(() => world.smokeCloud(), 1400);
    addLog(h('div', { class: 'sys' }, `${nameOf(m.seat)} 💨`));
  }
});
on('order', (m) => {
  const item = m.item as OrderItem;
  world.order(m.seat, item);
  addLog(h('div', { class: 'sys' }, `${m.from}: ${orderLabel(item)} ${getLang() === 'de' ? 'bestellt' : 'söyledi'}`));
  if (m.seat === you.seat) sfx.bell();
});
on('eye', (m) => {
  world.eye(m.seat, m.key);
  if (m.seat !== null && m.seat === you.seat) eyeFeedback(m.key);
});

/** Rückmeldung für eigene Aktionen (eigener Körper ist in Ego-Perspektive unsichtbar) */
function selfFeedback(key: string) {
  if (key === 'nargile') {
    sfx.bubble();
    setTimeout(() => {
      sfx.exhale();
      world.selfPuff('smoke');
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
on('error', (m) => toast(m.text ?? (m.key === 'noTable' ? 'Masa bulunamadı / Tisch nicht gefunden' : 'Hata')));
on('kicked', () => leaveCafe());
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
    return;
  }
  tv.enabled = settings.tvMode === 'table';
  tv.apply(table.tv);
  world.setTvVisible(tv.enabled && !!table.tv.source);
  music.enabled = settings.musicMode === 'table';
  music.apply(table.music);
  if (settings.musicMode === 'own' && settings.ownMusicUrl) ownMusic.playLocal(settings.ownMusicUrl);
  else ownMusic.stopAll();
}
setInterval(() => {
  tv.tick();
  music.tick();
}, 4000);

// ------------------------------------------------------------------ Menü

function showMenu() {
  ui.innerHTML = '';
  world.sitAt(null);
  const previewBox = h('div', { class: 'preview' });
  const nameInput = h('input', { value: profile.name, placeholder: t('yourName'), maxLength: 20 });
  const codeInput = h('input', { placeholder: t('code'), maxLength: 5, style: { textTransform: 'uppercase', width: '120px' } });
  const specBox = h('input', { type: 'checkbox' });
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
        h('label', {}, t('yourName')),
        nameInput,
        h('button', { class: 'primary', onclick: () => go({ type: 'createTable', isPublic: false }) }, '🀄 ' + t('createTable')),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, codeInput, h('label', { class: 'row', style: { gap: '4px' } }, specBox, t('spectate')), h('button', { onclick: () => go({ type: 'joinTable', code: codeInput.value, spectate: specBox.checked }) }, t('join'))),
        h('button', { onclick: () => go({ type: 'findPublic' }) }, '🎲 ' + t('randomTable')),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('button', { class: 'ghost', onclick: () => openStats() }, '📊 ' + t('stats')), h('button', { class: 'ghost', onclick: () => openSettings() }, '⚙️ ' + t('settings'))),
        h('button', { class: 'ghost small', onclick: () => openCredits() }, '© Credits'),
      ),
    ),
  );
  ui.append(menu);
  if (!profile.name) setTimeout(() => nameInput.focus(), 50);
  const pv = World.preview(previewBox, profile.avatar, profile.name || '...');
  nameInput.addEventListener('input', () => pv.update(profile.avatar, nameInput.value || '...'));
  menu.addEventListener('remove', () => pv.dispose());
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
    h('div', { class: 'muted', style: { marginBottom: '8px' } }, '3D-Modelle unter CC BY 4.0 (creativecommons.org/licenses/by/4.0):'),
    h('ul', {}, CREDITS.map((c) => h('li', {}, h('a', { href: c.url, target: '_blank', rel: 'noopener', style: { color: '#e3b04b' } }, c.what), ' – ', c.author))),
    h('div', { class: 'muted' }, 'Größe/Detailgrad für das Spiel angepasst. Alles andere: Okeyhane.'),
  );
}

function modal(...children: (HTMLElement | string)[]) {
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
      range('camTilt', getLang() === 'de' ? 'Blickwinkel am Tisch (nach unten)' : 'Masada bakış açısı (aşağı)', 8, 35, '°', () => world.seated !== null && world.sitAt(world.seated)),
      range('fovWalk', getLang() === 'de' ? 'Sichtfeld beim Laufen' : 'Yürürken görüş açısı', 50, 90, '°'),
      range('sensitivity', getLang() === 'de' ? 'Empfindlichkeit (Maus/Touch/Stick)' : 'Hassasiyet (fare/dokunma/kol)', 30, 250, '%'),
      check('invertY', getLang() === 'de' ? 'Y-Achse umkehren' : 'Y eksenini ters çevir'),
      select('touchUi', getLang() === 'de' ? 'Touch-Steuerung (Handy/iPad)' : 'Dokunmatik kontrol (telefon/iPad)', [
        ['auto', t('auto')],
        ['on', getLang() === 'de' ? 'An' : 'Açık'],
        ['off', getLang() === 'de' ? 'Aus' : 'Kapalı'],
      ]),
      check('showKeyHints', getLang() === 'de' ? 'Tastenhilfe am Tisch zeigen' : 'Masada tuş ipuçlarını göster'),
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
        ['emoteTea', 'Çay trinken', 'Çay iç'],
        ['emoteNargile', 'Nargile ziehen', 'Nargile çek'],
        ['emoteSlam', 'Auf den Tisch hauen', 'Masaya vur'],
        ['emoteTespih', 'Tespih drehen', 'Tespih çek'],
        ['emoteHeadshake', 'Kopf schütteln', 'Kafa salla'],
        ['emoteRub', 'Hände reiben', 'El ovuştur'],
        ['wink', 'Zwinkern', 'Göz kırp'],
        ['blink', 'Blinzeln', 'Göz kırpıştır'],
        ['wide', 'Große Augen', 'Göz aç'],
        ['cayci', 'Çaycı rufen / bestellen', 'Çaycıyı çağır'],
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
    for (const k of Object.keys(settings.keys)) used.set(settings.keys[k as keyof KeyBinds], (used.get(settings.keys[k as keyof KeyBinds]) ?? 0) + 1);
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
  inCafe = true;
  const menu = ui.querySelector('.menu') as any;
  menu?._pv?.dispose();
  ui.innerHTML = '';
  chatLog = [];
  addLog(h('div', { class: 'sys' }, touchActive() ? (getLang() === 'de' ? 'Links: Joystick zum Laufen · rechts wischen: umschauen · Stuhl antippen: hinsetzen' : 'Sol: yürü · sağda kaydır: etrafa bak · sandalyeye dokun: otur') : t('walkHint')));
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
  world.onPile = () => act({ action: 'drawPile' });
  world.onSide = () => act({ action: 'drawDiscard' });
  world.onMeld = (index) => {
    const ids = [...istaka.selected];
    if (!ids.length) return toast(t('selectMeld'));
    act({ action: 'layoff', meldIndex: index, tileIds: ids });
  };
  istaka.isOverTable = (x, y) => world.isOverTable(x, y);
  istaka.canDiscard = () => myTurn('discard');
  world.onFocusChange = () => renderFocusBadge();
  world.onLookChange = () => renderHint();
  istaka.onDropZone = (zone, id) => {
    if (zone === 'discard') act({ action: 'discard', tileId: id });
    else if (zone === 'finish') act({ action: 'finish', tileId: id });
  };
  istaka.onChange = () => renderActions();
  renderAll();
}

function watchAt(seat: number) {
  // Zuschauer schaut aus Sicht des Spielers mit
  world.sitAt(seat);
  renderAll();
}

function leaveCafe() {
  inCafe = false;
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
  send({ type: 'action', ...m });
  if (m.action === 'discard' || m.action === 'finish' || m.action === 'okeyBir') istaka.selected.clear();
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
  const show = inCafe && world.seated !== null;
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
  el.classList.toggle('hidden', !walking);
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
  const isOwner = table!.ownerId === myId;
  el.append(
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
        h('span', {}, `${s % 2 === 0 ? '🔵' : '🔴'} ${p.name}${p.bot ? ' 🤖' : ''}${p.id === table!.ownerId ? ' 👑' : ''}${isMe ? ' (sen)' : ''}`),
        h(
          'span',
          { class: 'row', style: { gap: '4px' } },
          !isMe && !p.bot ? h('button', { class: 'small ghost', title: 'Mute', onclick: () => (voice.setMuted(p.id, !voice.isMuted(p.id)), renderLeft()) }, voice.isMuted(p.id) ? '🔇' : '🔊') : null,
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
  el.append(
    h(
      'div',
      { class: 'row', style: { marginTop: '8px' } },
      world.seated !== null && !table!.started && you.seat !== null ? h('button', { class: 'small ghost', onclick: () => (world.sitAt(null), renderAll()) }, '🚶 ' + t('leave')) : null,
      h('button', { class: 'small danger', onclick: () => send({ type: 'leaveTable' }) }, '🚪 ' + t('back')),
    ),
  );
}

function renderRight() {
  const el = slot('right', 'hud-right');
  el.innerHTML = '';
  appendAll(el,
    h('button', { class: 'small', onclick: () => openMedia() }, '📺 ' + t('tv') + ' / 🎵 ' + t('music')),
    h(
      'button',
      {
        class: 'small ' + (voice.micOn ? 'primary' : ''),
        onclick: async () => {
          try {
            await voice.enableMic(!voice.micOn);
          } catch (e: any) {
            toast(e.message);
          }
          renderRight();
        },
      },
      voice.micOn ? '🎙️ ' + t('voiceOn') : '🎙️ ' + t('voiceOff'),
    ),
    table!.started ? h('button', { class: 'small', onclick: () => ((sheetOpen = !sheetOpen), renderSheet()) }, '📝 ' + t('sheet')) : null,
    h('button', { class: 'small ghost', onclick: () => openSettings() }, '⚙️'),
  );
}

function renderChat() {
  let el = els.chat;
  if (el && el.isConnected) return;
  el = slot('chat', 'chat');
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
    if (e.key === 'Escape') input.blur();
  });
  el.append(
    log,
    h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, input, h('button', { class: 'small', onclick: sendChat }, t('send'))),
    h('div', { class: 'quick' }, ['hadi', 'okeyBende', 'caylar', 'buElBizim', 'yazik', 'helal', 'tesekkur', 'gecmisOlsun'].map((k) => h('button', { class: 'ghost', onclick: () => send({ type: 'quick', key: k }) }, t('q_' + k)))),
    h('div', { class: 'emotes' }, ['slam', 'tea', 'nargile', 'headshake', 'rubhands', 'tespih'].map((k) => h('button', { class: 'small ghost', onclick: () => send({ type: 'emote', key: k }) }, t('e_' + k)))),
    h('div', { class: 'emotes' }, ['wink', 'blink', 'wide'].map((k) => h('button', { class: 'small ghost', onclick: () => send({ type: 'eye', key: k }) }, '👁 ' + t('eye_' + k)))),
  );
  log.scrollTop = log.scrollHeight;
}

// Steuerung ohne Maus: Tastenkürzel, Controller, Touch
const ORDER_LABELS: Record<OrderItem, [string, string]> = {
  cay: ['🫖 Çay', '🫖 Çay (Tee)'],
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
setupControls(world, istaka, {
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
    if (id !== null) act({ action: 'finish', tileId: id });
  },
  indicator: () => act({ action: 'showIndicator' }),
  okeyBir: () => {
    if (table?.rules.mode !== 'perisan' || !myTurn('discard')) return;
    const id = needTile();
    if (id !== null) act({ action: 'okeyBir', tileId: id });
  },
  sortRuns: () => !table?.rules.hardMode && istaka.sortRuns(),
  sortPairs: () => !table?.rules.hardMode && istaka.sortPairs(),
  emote: (k) => send({ type: 'emote', key: k }),
  eye: (k) => send({ type: 'eye', key: k }),
  openCayci,
  openQuick: () =>
    popupMenu(
      '💬 ' + (getLang() === 'de' ? 'Sprüche' : 'Hazır sözler'),
      ['hadi', 'okeyBende', 'caylar', 'buElBizim', 'yazik', 'helal', 'tesekkur', 'gecmisOlsun'].map((k) => ({ label: t('q_' + k), fn: () => send({ type: 'quick', key: k }) })),
    ),
  openEmotes: () =>
    popupMenu('😊 Emotes', [
      ...['tea', 'nargile', 'slam', 'tespih', 'headshake', 'rubhands'].map((k) => ({ label: t('e_' + k), fn: () => send({ type: 'emote', key: k }) })),
      ...['wink', 'blink', 'wide'].map((k) => ({ label: '👁 ' + t('eye_' + k).replace(/ \(\d\)/, ''), fn: () => send({ type: 'eye', key: k }) })),
    ]),
  focusChat: () => {
    els.chat?.classList.add('open');
    (els.chat?.querySelector('input') as HTMLInputElement | null)?.focus();
  },
  toggleChat: () => els.chat?.classList.toggle('open'),
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
});

function openCayci() {
  if (you.seat === null) {
    return toast(getLang() === 'de' ? 'Setz dich erst an den Tisch – der Çaycı bringt es dann' : 'Önce masaya otur – çaycı getirsin');
  }
  sfx.spoon();
  popupMenu(
    '🫖 ' + (getLang() === 'de' ? 'Çaycı rufen – was darf es sein?' : 'Çaycı! Ne alırsın?'),
    ORDER_ITEMS.map((i) => ({ label: orderLabel(i), fn: () => send({ type: 'order', item: i }) })),
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
  top.append(
    h('div', { class: 'score' + (mine === 0 ? ' mine' : '') }, h('div', { class: 'muted' }, teamName(0)), String(v.teamScores[0])),
    v.phase === 'handOver' || v.phase === 'gameOver'
      ? h('div', { class: 'turn' }, v.gameOver ? t('gameOver') : t('handOver'))
      : h('div', { class: 'turn' + (isMe ? ' me' : '') }, isMe ? t('yourTurn') : `${t('waitingFor')}: ${turnName}`, timer),
    h('div', { class: 'okeyinfo' }, 'Okey', okeyTile ? tileElement(okeyTile) : '', h('span', { class: 'muted' }, `${t('pileLeft')}: ${v.pileCount} · ${t(table!.rules.mode)} · El ${v.handNo + (v.phase === 'handOver' || v.gameOver ? 0 : 1)}`)),
    h('div', { class: 'score' + (mine === 1 ? ' mine' : '') }, h('div', { class: 'muted' }, teamName(1)), String(v.teamScores[1])),
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

  zones.classList.toggle('hidden', !myTurn('discard'));
  zones.innerHTML = '';
  zones.append(h('div', { class: 'zone', 'data-zone': 'discard' }, '⬇ ' + t('discard')), h('div', { class: 'zone finish', 'data-zone': 'finish' }, '✔ ' + t('finish')));
  zones.querySelectorAll('.zone').forEach((z) => ((z as HTMLElement).dataset.zone = (z as HTMLElement).getAttribute('data-zone')!));

  // Ergebnis
  const over = v.phase === 'handOver' || v.gameOver;
  result.classList.toggle('hidden', !over);
  if (over) {
    result.innerHTML = '';
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
      result.append(h('h2', {}, t('handOver')), h('div', {}, st.lastResult?.note ?? ''));
    }
  }
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
  bar.append(
    btn('🀫 ' + t('drawPile'), draw, () => act({ action: 'drawPile' })),
    btn('↘ ' + t('drawSide'), draw && !!st.topDiscards[(you.seat + 3) % 4] && !v.okeyBirTile, () => act({ action: 'drawDiscard' })),
    btn('⬇ ' + t('discard'), disc && one !== null, () => act({ action: 'discard', tileId: one })),
    btn('✔ ' + t('finish'), disc && one !== null, () => act({ action: 'finish', tileId: one }), 'primary'),
    btn('👁 ' + t('showIndicator'), v.current === you.seat, () => act({ action: 'showIndicator' })),
  );
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
  const ownInput = h('input', { placeholder: t('linkPlaceholder') + ' / ' + t('streamPlaceholder'), value: settings.ownMusicUrl, style: { flex: '1' } });
  const loadSrc = (kind: 'tv' | 'music', url: string) => {
    const id = parseYouTube(url);
    if (id) send({ type: kind, action: 'load', source: { kind: 'youtube', id } });
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
    h('h2', {}, '🎵 ' + t('music')),
    h('label', { class: 'row' }, t('music') + ':', modeSel('musicMode', [['table', t('forAll')], ['off', t('off')], ['own', t('ownMusic')]])),
    isOwner ? h('div', { class: 'col', style: { margin: '8px 0' } }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, musicInput, h('button', { class: 'primary small', onclick: () => loadSrc('music', musicInput.value) }, t('load'))), controls('music')) : h('div', { class: 'muted' }, t('onlyOwner')),
    h('div', { class: 'col', style: { marginTop: '10px' } }, h('label', {}, t('ownMusic')), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, ownInput, h('button', { class: 'small', onclick: () => ((settings.ownMusicUrl = ownInput.value), (settings.musicMode = 'own'), saveSettings(), applyMedia()) }, t('load')))),
  );
}

function curPos(kind: 'tv' | 'music') {
  const s = kind === 'tv' ? table!.tv : table!.music;
  return s.playing ? s.position + (Date.now() - s.at) / 1000 : s.position;
}

// ------------------------------------------------------------------ Start

showMenu();

// Debug-Zugriff (Konsole / automatische Tests)
(window as any).__okey = { world, send, istaka, get state() { return st; }, get table() { return table; } };
