// Okeyhane Spielserver: HTTP (liefert den Client aus) + WebSocket (Spiel).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { OkeyGame, GameError, botTurn, defaultRules, type TableRules, type Mode } from '@okeyhane/engine';
import type { Avatar, MediaState, PlayerInfo } from './protocol.ts';
import { loadStats, recordResult, getStats } from './stats.ts';

const PORT = Number(process.env.PORT ?? 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../../client/dist');

// ------------------------------------------------------------------ Typen

interface Client {
  id: string;
  ws: WebSocket;
  info: PlayerInfo;
  table: Table | null;
  /** Platz 0..3 oder null (Zuschauer) */
  seat: number | null;
  /** Zuschauer: hinter welchem Platz */
  watching: number | null;
}

interface Seat {
  client: Client | null;
  bot: PlayerInfo | null;
}

interface Table {
  code: string;
  ownerId: string;
  isPublic: boolean;
  seats: Seat[];
  spectators: Set<Client>;
  invited: Set<string>;
  rules: TableRules;
  game: OkeyGame | null;
  started: boolean;
  tv: MediaState;
  music: MediaState;
  botTimer: NodeJS.Timeout | null;
  turnTimer: NodeJS.Timeout | null;
  turnDeadline: number | null;
  signatures: Record<number, string>;
  recorded: boolean;
  /** an welchem Tisch im Kahvehane gespielt wird (0 = Mitte, 1 = Fenster, 2/3 = Garten) */
  spot: number;
  /** nach einer Hand: wer ist bereit für die nächste (Plätze) */
  ready: Set<number>;
  /** Anordnung der Steine auf den Brettern (32 Plätze, Stein-IDs) – wird am Handende gezeigt */
  layouts: Record<number, (number | null)[]>;
}

const tables = new Map<string, Table>();
const clients = new Map<string, Client>();

// ------------------------------------------------------------------ Hilfen

const rid = () => Math.random().toString(36).slice(2, 10);
function newCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  do {
    c = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (tables.has(c));
  return c;
}

function send(c: Client, msg: unknown) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function members(t: Table): Client[] {
  const list: Client[] = [];
  for (const s of t.seats) if (s.client) list.push(s.client);
  for (const s of t.spectators) list.push(s);
  return list;
}

function broadcast(t: Table, msg: unknown, except?: Client) {
  for (const c of members(t)) if (c !== except) send(c, msg);
}

const BOT_NAMES = ['Hasan Abi', 'Kemal Usta', 'Rıza Dayı', 'Cemil', 'Nuri Bey', 'Selami', 'Fatma Teyze', 'Hatice Abla', 'Emine Hanım'];
const FEMALE_BOTS = new Set(['Fatma Teyze', 'Hatice Abla', 'Emine Hanım']);
function botInfo(seat: number, taken: string[] = []): PlayerInfo {
  const skins = ['#e0b48f', '#c99068', '#a26e4a', '#f1c9a5'];
  const avatar: Avatar = {
    skin: skins[seat % 4],
    face: (['round', 'long', 'square'] as const)[seat % 3],
    hair: (['short', 'none', 'slick', 'curly'] as const)[seat % 4],
    hairColor: ['#2b1d14', '#777777', '#1a1a1a', '#4a3020'][seat % 4],
    eyebrows: 'thick',
    beard: (['none', 'stubble', 'full', 'none'] as const)[seat % 4],
    mustache: (['thick', 'classic', 'none', 'thick'] as const)[seat % 4],
    shirt: (['gomlek', 'hirka', 'takim', 'esofman'] as const)[seat % 4],
    shirtColor: ['#6b4a3a', '#3a5a6b', '#444444', '#2d5a3a'][seat % 4],
    hat: (['kasket', 'none', 'none', 'takke'] as const)[seat % 4],
    glasses: (['none', 'reading', 'none', 'none'] as const)[seat % 4],
    accessory: (['tespih', 'none', 'toothpick', 'none'] as const)[seat % 4],
    jewelry: 'none',
  };
  const free = BOT_NAMES.filter((n) => !taken.includes(n));
  const name = free[Math.floor(Math.random() * free.length)] ?? BOT_NAMES[seat];
  if (FEMALE_BOTS.has(name)) {
    const i = BOT_NAMES.indexOf(name);
    Object.assign(avatar, {
      body: 'f',
      beard: 'none',
      mustache: 'none',
      hat: 'none',
      hair: 'bun',
      eyebrows: 'thin',
      scarf: (['tulbent', 'basortu', 'esarp'] as const)[i % 3],
      scarfColor: ['#5a2d6a', '#2f4f6f', '#7a3b2e'][i % 3],
      shirt: (['hirka', 'elbise', 'bluz'] as const)[i % 3],
      shirtColor: ['#7a5a3a', '#2d5a3a', '#8e1b1b'][i % 3],
      makeup: i % 3 === 2 ? 'light' : 'none',
      jewelry: 'bilezik',
      accessory: i % 3 === 0 ? 'tespih' : 'none',
      glasses: i % 3 === 0 ? 'reading' : 'none',
    });
  }
  return { id: 'bot-' + seat, name, avatar, signature: null, bot: true };
}

function seatInfo(s: Seat): PlayerInfo | null {
  return s.client ? s.client.info : s.bot;
}

function tableSummary(t: Table) {
  return {
    code: t.code,
    ownerId: t.ownerId,
    isPublic: t.isPublic,
    seats: t.seats.map(seatInfo),
    spectators: [...t.spectators].map((c) => ({ id: c.id, name: c.info.name, watching: c.watching })),
    rules: t.rules,
    started: t.started,
    tv: t.tv,
    music: t.music,
    signatures: t.signatures,
    spot: t.spot,
    ready: [...t.ready],
  };
}

function pushTable(t: Table) {
  const summary = tableSummary(t);
  for (const c of members(t)) send(c, { type: 'table', table: summary, you: { id: c.id, seat: c.seat, watching: c.watching } });
}

function pushState(t: Table) {
  if (!t.game) return;
  for (const c of members(t)) {
    const seat = c.seat ?? c.watching ?? 0;
    const view = t.game.viewFor(seat);
    send(c, {
      type: 'state',
      view,
      spectator: c.seat === null,
      turnDeadline: t.turnDeadline,
      topDiscards: [0, 1, 2, 3].map((s) => {
        const d = t.game!.hand.players[s].discards;
        return d.length ? d[d.length - 1] : null;
      }),
      okey: t.game.hand.okey,
      lastResult: t.game.hand.lastResult,
      // Bretter der anderen erst nach der Hand (sonst wäre es Spicken)
      layouts: t.game.hand.phase === 'handOver' || t.game.gameOver ? t.layouts : null,
    });
  }
}

function humanCount(t: Table) {
  return t.seats.filter((s) => s.client).length;
}

function removeFromTable(c: Client) {
  const t = c.table;
  if (!t) return;
  if (c.seat !== null) {
    const seat = t.seats[c.seat];
    seat.client = null;
    // Läuft ein Spiel, übernimmt ein Bot
    if (t.started) seat.bot = botInfo(c.seat, t.seats.map((x) => x.bot?.name ?? ''));
  }
  t.spectators.delete(c);
  c.table = null;
  c.seat = null;
  c.watching = null;
  if (humanCount(t) === 0 && t.spectators.size === 0) {
    if (t.botTimer) clearTimeout(t.botTimer);
    if (t.turnTimer) clearTimeout(t.turnTimer);
    tables.delete(t.code);
    return;
  }
  if (t.ownerId === c.id) {
    const next = t.seats.find((s) => s.client)?.client ?? [...t.spectators][0];
    if (next) t.ownerId = next.id;
  }
  pushTable(t);
  scheduleBots(t);
}

// ------------------------------------------------------------------ Bots & Timer

function scheduleBots(t: Table) {
  if (t.botTimer) clearTimeout(t.botTimer);
  t.botTimer = null;
  const g = t.game;
  if (!g || g.gameOver) return;
  if (g.hand.phase === 'handOver') {
    // nächste Hand erst, wenn alle Menschen bereit sind (Bots sind es sofort) oder der Tischbesitzer startet
    t.seats.forEach((s, i) => s.bot && t.ready.add(i));
    if (!t.seats.some((s) => s.client)) {
      // nur Bots/Zuschauer: kurz warten, dann weiter
      t.botTimer = setTimeout(() => maybeNextHand(t, true), 6000);
    } else maybeNextHand(t);
    pushTable(t);
    return;
  }
  const seat = g.hand.current;
  if (t.seats[seat].bot) {
    t.botTimer = setTimeout(() => {
      if (t.game !== g || g.hand.current !== seat) return;
      try {
        botTurn(g, seat);
      } catch (e) {
        console.error('Bot-Fehler', e);
      }
      afterAction(t);
    }, 900 + Math.random() * 700);
  }
}

function maybeNextHand(t: Table, force = false) {
  const g = t.game;
  if (!g || g.gameOver || g.hand.phase !== 'handOver') return;
  const all = t.seats.every((s, i) => (!s.client && !s.bot) || t.ready.has(i));
  if (!all && !force) return;
  t.ready.clear();
  t.layouts = {};
  g.nextHand();
  afterAction(t);
}

function scheduleTurnTimer(t: Table) {
  if (t.turnTimer) clearTimeout(t.turnTimer);
  t.turnTimer = null;
  t.turnDeadline = null;
  const g = t.game;
  const secs = t.rules.turnTimerSec;
  if (!g || g.gameOver || !secs || g.hand.phase === 'handOver') return;
  const seat = g.hand.current;
  if (t.seats[seat].bot) return;
  t.turnDeadline = Date.now() + secs * 1000;
  const handNo = g.handNo;
  t.turnTimer = setTimeout(() => {
    if (t.game !== g || g.handNo !== handNo || g.hand.current !== seat) return;
    try {
      botTurn(g, seat); // Zeit abgelaufen: automatischer Zug
    } catch (e) {
      console.error(e);
    }
    afterAction(t);
  }, secs * 1000);
}

function afterAction(t: Table) {
  const g = t.game;
  if (g?.gameOver && !t.recorded) {
    t.recorded = true;
    t.seats.forEach((s, seat) => {
      if (s.client && g.winnerTeam !== null) recordResult(s.client.info.name, t.rules.mode, seat % 2 === g.winnerTeam);
    });
  }
  scheduleTurnTimer(t);
  pushState(t);
  scheduleBots(t);
}

// ------------------------------------------------------------------ Nachrichten

type Msg = Record<string, any> & { type: string };

function handle(c: Client, m: Msg) {
  const t = c.table;
  switch (m.type) {
    case 'hello': {
      c.info.name = String(m.name ?? 'Oyuncu').slice(0, 20) || 'Oyuncu';
      if (m.avatar) c.info.avatar = m.avatar;
      if (typeof m.signature === 'string' && m.signature.length < 200000) c.info.signature = m.signature;
      send(c, { type: 'welcome', id: c.id, stats: getStats(c.info.name) });
      if (t) pushTable(t);
      return;
    }
    case 'createTable': {
      removeFromTable(c);
      const table: Table = {
        code: newCode(),
        ownerId: c.id,
        isPublic: !!m.isPublic,
        seats: [0, 1, 2, 3].map(() => ({ client: null, bot: null })),
        spectators: new Set(),
        invited: new Set(),
        rules: defaultRules((m.mode as Mode) ?? 'standard'),
        game: null,
        started: false,
        tv: { source: null, playing: false, position: 0, at: Date.now(), volume: 60 },
        music: { source: null, playing: false, position: 0, at: Date.now(), volume: 40 },
        botTimer: null,
        turnTimer: null,
        turnDeadline: null,
        signatures: {},
        recorded: false,
        spot: Math.max(0, Math.min(3, Number(m.spot) || 0)),
        ready: new Set(),
        layouts: {},
      };
      tables.set(table.code, table);
      table.seats[0].client = c;
      c.table = table;
      c.seat = 0;
      pushTable(table);
      return;
    }
    case 'joinTable': {
      const code = String(m.code ?? '').toUpperCase().trim();
      const table = tables.get(code);
      if (!table) return send(c, { type: 'error', key: 'noTable' });
      removeFromTable(c);
      c.table = table;
      const free = table.seats.findIndex((s) => !s.client && !s.bot);
      if (!m.spectate && free >= 0 && !table.started) {
        table.seats[free].client = c;
        c.seat = free;
      } else {
        // Zuschauer (nur mit Code = eingeladen)
        table.spectators.add(c);
        c.seat = null;
        c.watching = 0;
      }
      pushTable(table);
      if (table.game) pushState(table);
      return;
    }
    case 'findPublic': {
      const open = [...tables.values()].find(
        (x) => x.isPublic && !x.started && x.seats.some((s) => !s.client && !s.bot),
      );
      if (open) return handle(c, { type: 'joinTable', code: open.code });
      return handle(c, { type: 'createTable', isPublic: true, mode: m.mode ?? 'standard' });
    }
    case 'leaveTable':
      removeFromTable(c);
      send(c, { type: 'left' });
      return;
  }

  if (!t) return send(c, { type: 'error', key: 'noTable' });
  const isOwner = t.ownerId === c.id;

  try {
    switch (m.type) {
      case 'sit': {
        const s = Number(m.seat);
        const seat = t.seats[s];
        if (!seat || seat.client) throw new GameError('Platz besetzt');
        // Vor dem Start nur freie Plätze; im laufenden Spiel darf man einen Bot ablösen
        if (seat.bot && !t.started) throw new GameError('Platz besetzt');
        if (t.started && (!seat.bot || c.seat !== null)) throw new GameError('Spiel läuft schon');
        seat.bot = null;
        if (c.seat !== null) t.seats[c.seat].client = null;
        t.spectators.delete(c);
        seat.client = c;
        c.seat = s;
        c.watching = null;
        pushTable(t);
        return;
      }
      case 'watch': {
        if (c.seat !== null) throw new GameError('Du sitzt am Tisch');
        c.watching = Math.max(0, Math.min(3, Number(m.seat)));
        pushTable(t);
        pushState(t);
        return;
      }
      case 'setPublic':
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        t.isPublic = !!m.isPublic;
        pushTable(t);
        return;
      case 'setRules': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        if (t.started) throw new GameError('Spiel läuft schon');
        const base = defaultRules((m.rules?.mode as Mode) ?? t.rules.mode);
        const prevMode = t.rules.mode;
        t.rules = { ...base, ...(m.rules ?? {}) };
        if (m.rules?.mode && m.rules.mode !== prevMode && m.rules.handCount === undefined) {
          t.rules.handCount = base.handCount;
        }
        pushTable(t);
        return;
      }
      case 'addBot': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        if (!t.rules.allowBots) throw new GameError('Bots sind aus');
        const s = Number(m.seat);
        if (t.seats[s] && !t.seats[s].client) t.seats[s].bot = botInfo(s, t.seats.map((x) => x.bot?.name ?? ''));
        pushTable(t);
        return;
      }
      case 'removeBot': {
        if (!isOwner || t.started) throw new GameError('Nicht erlaubt');
        const s = Number(m.seat);
        if (t.seats[s]) t.seats[s].bot = null;
        pushTable(t);
        return;
      }
      case 'kick': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        const target = members(t).find((x) => x.id === m.id);
        if (target && target !== c) {
          removeFromTable(target);
          send(target, { type: 'kicked' });
        }
        return;
      }
      case 'start': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        if (t.seats.some((s) => !s.client && !s.bot)) throw new GameError('Alle 4 Plätze müssen besetzt sein');
        t.game = new OkeyGame(t.rules, Date.now() & 0x7fffffff);
        t.started = true;
        t.signatures = {};
        t.recorded = false;
        pushTable(t);
        afterAction(t);
        broadcast(t, { type: 'sfx', kind: 'shuffle' });
        return;
      }
      case 'rematch': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        if (!t.game?.gameOver) throw new GameError('Spiel läuft noch');
        t.game = new OkeyGame(t.rules, Date.now() & 0x7fffffff);
        t.ready.clear();
        t.signatures = {};
        t.recorded = false;
        pushTable(t);
        afterAction(t);
        broadcast(t, { type: 'sfx', kind: 'shuffle' });
        return;
      }
      case 'backToLobby': {
        // Spiel beenden (nach jeder Hand oder am Ende) – alle stehen auf
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        if (t.game && !t.game.gameOver && t.game.hand.phase !== 'handOver') throw new GameError('Erst nach der Hand');
        if (t.botTimer) clearTimeout(t.botTimer);
        if (t.turnTimer) clearTimeout(t.turnTimer);
        t.ready.clear();
        t.layouts = {};
        t.game = null;
        t.started = false;
        for (const s of t.seats) if (!s.client) s.bot = null;
        pushTable(t);
        broadcast(t, { type: 'lobby' });
        return;
      }
      case 'sign': {
        if (c.seat === null || !t.game?.gameOver || !c.info.signature) return;
        t.signatures[c.seat] = c.info.signature;
        pushTable(t);
        return;
      }
      case 'action': {
        const g = t.game;
        if (!g) throw new GameError('Kein Spiel');
        const seat = c.seat;
        if (seat === null) throw new GameError('Zuschauer können nicht spielen');
        doAction(t, g, seat, m);
        afterAction(t);
        return;
      }
      case 'chat': {
        const text = String(m.text ?? '').slice(0, 200).trim();
        if (!text) return;
        broadcast(t, { type: 'chat', from: c.info.name, seat: c.seat, text, spectator: c.seat === null });
        return;
      }
      case 'quick':
        broadcast(t, { type: 'quick', seat: c.seat, from: c.info.name, key: m.key });
        return;
      case 'emote':
        if (c.seat !== null) broadcast(t, { type: 'emote', seat: c.seat, key: m.key });
        return;
      case 'eye':
        if (c.seat !== null) broadcast(t, { type: 'eye', seat: c.seat, key: m.key });
        return;
      case 'pos': {
        // Laufen im Kahvehane: Position an die anderen am Tisch weitergeben
        const x = Number(m.x), z = Number(m.z), yaw = Number(m.yaw);
        if (![x, z, yaw].every(Number.isFinite)) return;
        broadcast(t, { type: 'pos', id: c.id, seat: c.seat, name: c.info.name, avatar: c.info.avatar, x, z, yaw, walking: !!m.walking }, c);
        return;
      }
      case 'layout': {
        if (c.seat === null || !Array.isArray(m.slots) || m.slots.length !== 32) return;
        t.layouts[c.seat] = m.slots.map((x: unknown) => (typeof x === 'number' ? x : null));
        return;
      }
      case 'ready': {
        // bereit für die nächste Hand
        if (c.seat === null || !t.game || t.game.hand.phase !== 'handOver') return;
        if (m.ready === false) t.ready.delete(c.seat);
        else t.ready.add(c.seat);
        pushTable(t);
        maybeNextHand(t);
        return;
      }
      case 'nextHand': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        maybeNextHand(t, true);
        return;
      }
      case 'order': {
        // Çaycı-Bestellung (rein kosmetisch)
        const items = ['cay', 'kahve', 'kuruyemis', 'su', 'oralet', 'sahlep'];
        if (c.seat === null || !items.includes(m.item)) return;
        broadcast(t, { type: 'order', seat: c.seat, item: m.item, from: c.info.name });
        return;
      }
      case 'setSpot': {
        // anderen Tisch wählen – nur vor dem Spielstart
        if (t.started) throw new GameError('Spiel läuft schon');
        t.spot = Math.max(0, Math.min(3, Number(m.spot) || 0));
        pushTable(t);
        return;
      }
      case 'tv':
      case 'music': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        const st: MediaState = m.type === 'tv' ? t.tv : t.music;
        const now = Date.now();
        const curPos = st.playing ? st.position + (now - st.at) / 1000 : st.position;
        if (m.action === 'load') {
          st.source = m.source ?? null;
          st.position = 0;
          st.playing = !!st.source;
        } else if (m.action === 'play') {
          st.position = curPos;
          st.playing = true;
        } else if (m.action === 'pause') {
          st.position = curPos;
          st.playing = false;
        } else if (m.action === 'seek') {
          st.position = Math.max(0, Number(m.position) || 0);
        } else if (m.action === 'volume') {
          st.position = curPos;
          st.volume = Math.max(0, Math.min(100, Number(m.volume) || 0));
        } else if (m.action === 'stop') {
          st.source = null;
          st.playing = false;
          st.position = 0;
        }
        st.at = now;
        broadcast(t, { type: m.type, state: st });
        return;
      }
      case 'rtc': {
        const target = members(t).find((x) => x.id === m.to);
        if (target) send(target, { type: 'rtc', from: c.id, data: m.data });
        return;
      }
    }
  } catch (e) {
    if (e instanceof GameError) send(c, { type: 'error', text: e.message });
    else {
      console.error(e);
      send(c, { type: 'error', text: 'Serverfehler' });
    }
  }
}

function doAction(t: Table, g: OkeyGame, seat: number, m: Msg) {
  switch (m.action) {
    case 'drawPile':
      g.drawPile(seat);
      broadcast(t, { type: 'sfx', kind: 'draw', seat });
      break;
    case 'drawDiscard':
      g.drawDiscard(seat);
      broadcast(t, { type: 'sfx', kind: 'draw', seat });
      break;
    case 'discard':
      g.discard(seat, Number(m.tileId));
      broadcast(t, { type: 'sfx', kind: 'discard', seat });
      break;
    case 'finish': {
      const r = g.finish(seat, Number(m.tileId));
      broadcast(t, { type: 'sfx', kind: 'finish', seat, note: r.note });
      break;
    }
    case 'showIndicator':
      g.showIndicator(seat);
      broadcast(t, { type: 'sfx', kind: 'indicator', seat });
      break;
    case 'okeyBir':
      g.okeyBir(seat, Number(m.tileId));
      broadcast(t, { type: 'sfx', kind: 'okeyBir', seat });
      break;
    case 'open':
      g.open101(seat, m.melds);
      broadcast(t, { type: 'sfx', kind: 'open', seat });
      break;
    case 'layoff':
      g.layoff(seat, Number(m.meldIndex), m.tileIds);
      broadcast(t, { type: 'sfx', kind: 'layoff', seat });
      break;
    case 'steal':
      g.steal(seat, Number(m.tileId));
      // alle sehen nur den Rauch
      broadcast(t, { type: 'emote', seat, key: 'nargile', smoke: true });
      break;
    case 'accuse': {
      const caught = g.accuse(seat, Number(m.target));
      broadcast(t, { type: 'accuse', by: seat, target: Number(m.target), caught });
      break;
    }
    default:
      throw new GameError('Unbekannte Aktion');
  }
}

// ------------------------------------------------------------------ HTTP + WS

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.end('ok');
    return;
  }
  let file = path.join(CLIENT_DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(CLIENT_DIR)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(CLIENT_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('Client nicht gebaut. Bitte "npm run build" ausführen.');
    return;
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  const ext = path.extname(file);
  if (ext === '.mp3' || ext === '.glb') res.setHeader('Cache-Control', 'public, max-age=86400');
  // Range-Anfragen (Audio-Streaming / Spulen)
  const size = fs.statSync(file).size;
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', String(size));
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const c: Client = {
    id: rid(),
    ws,
    info: { id: '', name: 'Oyuncu', avatar: botInfo(0).avatar, signature: null, bot: false },
    table: null,
    seat: null,
    watching: null,
  };
  c.info.id = c.id;
  clients.set(c.id, c);
  ws.on('message', (raw) => {
    let m: Msg;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m && typeof m.type === 'string') handle(c, m);
  });
  ws.on('close', () => {
    removeFromTable(c);
    clients.delete(c.id);
  });
});

loadStats();
server.listen(PORT, () => console.log(`Okeyhane läuft auf http://localhost:${PORT}`));
