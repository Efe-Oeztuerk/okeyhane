// Okeyhane Spielserver: HTTP (liefert den Client aus) + WebSocket (Spiel).

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { OkeyGame, GameError, botTurn, defaultRules, autoLayout, rackIsFinished, isCompleteMelds, isCompletePairs, PistiGame, PistiError, pistiBotTurn, BatakGame, BatakError, batakBotTurn, TavlaGame, TavlaError, tavlaBotTurn, type TableRules, type Mode } from '@okeyhane/engine';
import type { Avatar, MediaState, PlayerInfo } from './protocol.ts';
import { loadStats, recordResult, getStats } from './stats.ts';
import { accounts, AccountError, type UserRow, type FriendRow } from './accounts.ts';

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
  /** Zuschauer: Sitzplatz im Raum (tv0/tv1 = vor dem Fernseher, c0..c3 = Ecke zwischen zwei Spielern), null = steht/läuft */
  lounge: string | null;
  /** Zuschauer: möchte nach der laufenden Runde diesen Platz (Bot) übernehmen */
  wantSeat: number | null;
  /** stabile Sitzungs-ID des Browsers/der App (überlebt Verbindungsabbrüche) */
  sid: string;
  /** angemeldeter Account (null = Gast) */
  user: UserRow | null;
  token: string | null;
  friends: FriendRow[];
  /** zuletzt gesendete Freunde-/Lobby-Liste (nur bei Änderung neu senden) */
  lastSocial: string;
  /** exklusive Figuren, die dieser Account besitzt */
  owns: Set<string>;
  /** geheimer Schlüssel nur für diesen Browser (Download exklusiver Figuren) */
  dl: string;
}

interface Seat {
  client: Client | null;
  bot: PlayerInfo | null;
  /** Sitzungs-ID des Menschen, der hier saß (für Wiederverbinden nach kurzem Abbruch) */
  sid?: string;
}

interface Table {
  code: string;
  ownerId: string;
  isPublic: boolean;
  seats: Seat[];
  spectators: Set<Client>;
  invited: Set<string>;
  rules: TableRules;
  game: OkeyGame | PistiGame | BatakGame | TavlaGame | null;
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
  closeTimer?: NodeJS.Timeout | null;
}

const tables = new Map<string, Table>();
const clients = new Map<string, Client>();

// ------------------------------------------------------------------ Exklusive Figuren
// Die Modelldatei liegt nur verschlüsselt im Repo (exclusive/<id>.bin). Der Schlüssel steht in Supabase
// und wird nur mit dem Sitzungs-Token des Besitzers herausgegeben. Andere können die Figur nicht wählen
// (Server ersetzt sie) und bekommen die Datei nur, wenn sie mit dem Besitzer am selben Tisch sind.
const EXCL_DIR = path.resolve(__dirname, '../exclusive');
const exclusive = new Set<string>(['ahmet', 'efe']);
const exclModels = new Map<string, Buffer>();
accounts
  .exclusiveModels()
  .then((l) => l.forEach((m) => exclusive.add(m)))
  .catch(() => {});
function unlockModel(model: string, keyHex: string) {
  if (exclModels.has(model) || !/^[a-z0-9_]+$/.test(model)) return;
  try {
    const raw = fs.readFileSync(path.join(EXCL_DIR, model + '.bin'));
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    exclModels.set(model, Buffer.concat([d.update(raw.subarray(28)), d.final()]));
  } catch (e) {
    console.error('Exklusive Figur konnte nicht entschlüsselt werden', model, e);
  }
}
async function loadOwned(c: Client) {
  c.owns = new Set();
  if (!c.token) return;
  try {
    for (const x of await accounts.myExclusives(c.token)) {
      c.owns.add(x.model);
      unlockModel(x.model, x.key);
    }
  } catch {}
}
/** fremde exklusive Figur → normale Figur */
function cleanAvatar(c: Client, a: Avatar): Avatar {
  if (a && a.style === 'real' && a.realBase && exclusive.has(a.realBase) && !c.owns.has(a.realBase)) return { ...a, realBase: a.body === 'f' ? 'qf' : 'qm' };
  return a;
}
/** darf dieser Browser die Figur laden? (Besitzer selbst oder am selben Tisch wie ein Träger) */
function mayDownload(c: Client, model: string) {
  if (c.owns.has(model)) return true;
  const t = c.table;
  if (!t) return false;
  const people = [...t.seats.map((s) => s.client), ...t.spectators];
  return people.some((o) => o && o.owns.has(model) && o.info.avatar?.style === 'real' && o.info.avatar.realBase === model);
}
/** Account-ID → offene Verbindungen */
const online = new Map<string, Set<Client>>();

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
/** feste Stimme je Bot-Name */
const BOT_VOICES: Record<string, string> = { 'Hasan Abi': 'abi', 'Kemal Usta': 'kayseri', 'Rıza Dayı': 'koylu', Cemil: 'genco', 'Nuri Bey': 'kayseri', Selami: 'karadeniz', 'Fatma Teyze': 'teyze', 'Hatice Abla': 'istanbullu', 'Emine Hanım': 'teyze' };
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
  avatar.voice = BOT_VOICES[name];
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
    spectators: [...t.spectators].map((c) => ({ id: c.id, name: c.info.name, watching: c.watching, lounge: c.lounge, wantSeat: c.wantSeat, avatar: c.info.avatar })),
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

/** Pişti: welche Plätze spielen mit (2 Spieler = gegenüber 0 + 2) */
/** die Tavla-Ecke (eigener kleiner Tisch mit zwei Stühlen) */
const TAVLA_SPOT = 4;
function activeSeats(t: Table): number[] {
  if (t.rules.mode === 'batak' && t.rules.batakMode === 'gommeli') return [0, 1, 2];
  if (t.rules.mode === 'tavla') return [0, 2];
  return t.rules.mode === 'pisti' && t.rules.pistiPlayers === 2 ? [0, 2] : [0, 1, 2, 3];
}
function isPisti(g: Table['game']): g is PistiGame {
  return !!g && (g as any).kind === 'pisti';
}
function isBatak(g: Table['game']): g is BatakGame {
  return !!g && (g as any).kind === 'batak';
}
function isTavla(g: Table['game']): g is TavlaGame {
  return !!g && (g as any).kind === 'tavla';
}
/** kein Okey-Brett (Kartenspiele und Tavla) */
function isCards(g: Table['game']): g is PistiGame | BatakGame | TavlaGame {
  return isPisti(g) || isBatak(g) || isTavla(g);
}

function pushState(t: Table) {
  if (!t.game) return;
  const pg = t.game;
  if (isCards(pg)) {
    for (const c of members(t)) {
      // Zuschauer sehen die Karten des Spielers, dem sie zuschauen (setzen dürfen sie sich erst nach der Runde)
      const view: any = pg.viewFor(c.seat ?? c.watching ?? 0);
      send(c, { type: 'state', view, spectator: c.seat === null, turnDeadline: t.turnDeadline, lastResult: pg.lastResult });
    }
    return;
  }
  const og = pg;
  for (const c of members(t)) {
    const seat = c.seat ?? c.watching ?? 0;
    // Zuschauer sehen die Steine des Spielers, dem sie zuschauen (setzen dürfen sie sich erst nach der Runde)
    const view: any = og.viewFor(seat);
    send(c, {
      type: 'state',
      view,
      spectator: c.seat === null,
      turnDeadline: t.turnDeadline,
      topDiscards: [0, 1, 2, 3].map((s) => {
        const d = og.hand.players[s].discards;
        return d.length ? d[d.length - 1] : null;
      }),
      okey: og.hand.okey,
      lastResult: og.hand.lastResult,
      // Bretter der anderen erst nach der Hand (sonst wäre es Spicken)
      layouts: og.hand.phase === 'handOver' || og.gameOver ? t.layouts : null,
    });
  }
}

/** Mindestabstand zwischen zwei Bestellungen desselben Spielers */
const ORDER_GAP_MS = 45_000;

/** Bots bestellen ab und zu (Çay meistens, manchmal eine Dose) – rein kosmetisch, mit Ruf in ihrer Stimme */
setInterval(() => {
  const now = Date.now();
  for (const t of tables.values()) {
    if (!t.started || !t.game) continue;
    // nicht zu oft am selben Tisch
    if (now - ((t as any).lastBotOrder ?? 0) < 90_000) continue;
    const bots = t.seats.map((s, i) => (s.bot ? i : -1)).filter((i) => i >= 0);
    if (!bots.length || Math.random() > 0.18) continue;
    const seat = bots[Math.floor(Math.random() * bots.length)];
    const info = t.seats[seat].bot!;
    const items = Math.random() < 0.3 ? ['icecek'] : ['cay'];
    const variants = items.map((x) => (x === 'icecek' ? Math.floor(Math.random() * 7) : 0));
    let reply = -1;
    if (Math.random() < 0.5) reply = (t as any).ahmetReply = (((t as any).ahmetReply ?? -1) + 1) % 2;
    (t as any).lastBotOrder = now;
    broadcast(t, { type: 'order', seat, items, item: items[0], from: info.name, variants, variant: variants[0], reply });
  }
}, 15_000);

function newGame(t: Table): OkeyGame | PistiGame | BatakGame | TavlaGame {
  if (t.rules.mode === 'tavla') return new TavlaGame({ target: t.rules.tavlaTarget || 5, mars: t.rules.tavlaMars !== false }, Date.now() ^ Math.floor(Math.random() * 1e9));
  const seed = Date.now() & 0x7fffffff;
  if (t.rules.mode === 'batak') {
    const r = t.rules;
    return new BatakGame({ mode: r.batakMode, target: r.batakTarget, handLimit: r.batakHands, minBid: r.batakMinBid, mustTrump: r.batakMustTrump, trumpBreak: r.batakTrumpBreak, overLimit: r.batakOverLimit, zeroBatar: r.batakZeroBatar, rebid: r.batakRebid }, seed);
  }
  if (t.rules.mode === 'pisti') return new PistiGame({ players: t.rules.pistiPlayers === 2 ? 2 : 4, target: t.rules.pistiTarget || 151, bluff: !!t.rules.pistiBluff, lastPisti: t.rules.pistiLastCounts !== false }, seed);
  return new OkeyGame(t.rules, seed);
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
    seat.sid = c.sid || undefined;
    // Läuft ein Spiel, übernimmt ein Bot
    if (t.started) seat.bot = botInfo(c.seat, t.seats.map((x) => x.bot?.name ?? ''));
  }
  t.spectators.delete(c);
  c.table = null;
  c.seat = null;
  c.watching = null;
  c.lounge = null;
  c.wantSeat = null;
  if (humanCount(t) === 0 && t.spectators.size === 0) {
    // kurz warten: am Handy reißt die Verbindung oft kurz ab (App im Hintergrund, Funkloch)
    if (t.closeTimer) clearTimeout(t.closeTimer);
    t.closeTimer = setTimeout(() => {
      if (humanCount(t) > 0 || t.spectators.size > 0) return;
      if (t.botTimer) clearTimeout(t.botTimer);
      if (t.turnTimer) clearTimeout(t.turnTimer);
      tables.delete(t.code);
    }, 3 * 60 * 1000);
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

/** Zuschauer, die auf einen Platz warten, setzen sich (nur zwischen zwei Runden / nach dem Spiel) */
function seatQueued(t: Table): boolean {
  let any = false;
  for (const sp of [...t.spectators]) {
    const s = sp.wantSeat;
    if (s === null) continue;
    sp.wantSeat = null;
    const seat = t.seats[s];
    if (!seat || seat.client || !seat.bot || !activeSeats(t).includes(s)) continue;
    seat.bot = null;
    seat.client = sp;
    t.spectators.delete(sp);
    t.ready.delete(s);
    sp.seat = s;
    sp.watching = null;
    sp.lounge = null;
    send(sp, { type: 'seated', seat: s });
    any = true;
  }
  return any;
}

function scheduleBots(t: Table) {
  if (t.botTimer) clearTimeout(t.botTimer);
  t.botTimer = null;
  const g = t.game;
  if (!g || g.gameOver) return;
  if (g.hand.phase === 'handOver') {
    if (seatQueued(t)) pushState(t);
    // nächste Hand erst, wenn alle Menschen bereit sind (Bots sind es sofort) oder der Tischbesitzer startet
    t.seats.forEach((s, i) => s.bot && t.ready.add(i));
    // Bots legen ihr Brett sichtbar geordnet hin (wie ein Mensch, der umgestellt hat)
    t.seats.forEach((s, i) => {
      if (!s.bot || isCards(g)) return;
      const hp = g.hand.players[i];
      t.layouts[i] = autoLayout(hp.hand, g.hand.okey, g.hand.indicator, t.rules.indicatorPairsAnything);
    });
    if (!t.seats.some((s) => s.client)) {
      // nur Bots/Zuschauer: kurz warten, dann weiter
      t.botTimer = setTimeout(() => maybeNextHand(t, true), 6000);
    } else maybeNextHand(t);
    pushTable(t);
    return;
  }
  const seat = g.hand.current;
  // Batak Eşli: beim Partner des Bieters handelt der Bieter
  const actor = isBatak(g) ? g.actor : seat;
  if (t.seats[actor].bot) {
    t.botTimer = setTimeout(() => {
      if (t.game !== g || g.hand.current !== seat || !t.seats[actor].bot) return;
      try {
        if (isPisti(g)) pistiBotTurn(g, seat);
        else if (isBatak(g)) batakBotTurn(g, seat);
        else if (isTavla(g)) tavlaBotTurn(g, seat);
        else botTurn(g, seat);
      } catch (e) {
        console.error('Bot-Fehler', e);
      }
      afterAction(t);
    }, isTavla(g) ? (g.phase === 'roll' ? 900 + Math.random() * 500 : 650 + Math.random() * 350) : isPisti(g) ? 1900 + Math.random() * 900 : isBatak(g) ? (g.phase === 'play' ? 1300 + Math.random() * 700 : 1700 + Math.random() * 900) : 900 + Math.random() * 700);
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
  if (t.seats[isBatak(g) ? g.actor : seat].bot) return;
  t.turnDeadline = Date.now() + secs * 1000;
  const handNo = g.handNo;
  t.turnTimer = setTimeout(() => {
    if (t.game !== g || g.handNo !== handNo || g.hand.current !== seat) return;
    try {
      if (isPisti(g)) pistiBotTurn(g, seat);
      else if (isBatak(g)) batakBotTurn(g, seat);
      else if (isTavla(g)) {
        // Zeit abgelaufen: den ganzen Wurf automatisch spielen
        while (g.current === seat && !g.gameOver && g.phase !== 'handOver') tavlaBotTurn(g, seat);
      } else botTurn(g, seat); // Zeit abgelaufen: automatischer Zug
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
    const winners: number[] = [];
    const losers: number[] = [];
    t.seats.forEach((s, seat) => {
      if (!activeSeats(t).includes(seat) || (!s.client && !s.bot)) return;
      const team = isPisti(g) || isTavla(g) ? g.teamOf(seat) : isBatak(g) ? (g.team ? seat % 2 : seat) : seat % 2;
      if (g.winnerTeam === null) return;
      (team === g.winnerTeam ? winners : losers).push(seat);
      const cl = s.client;
      if (cl) {
        const won = team === g.winnerTeam;
        if (cl.token) {
          // angemeldet: dauerhaft in der Datenbank (übersteht Neustarts, zählt für die Rangliste)
          accounts
            .recordResult(cl.token, t.rules.mode, won)
            .then((st) => send(cl, { type: 'stats', stats: st }))
            .catch((e) => console.error('Statistik', e));
        } else {
          recordResult(cl.info.name, t.rules.mode, won);
          send(cl, { type: 'stats', stats: getStats(cl.info.name) });
        }
      }
    });
    if (winners.length && losers.length) {
      // Verlierer zahlt den Çay: Sieger-/Verliererpose, danach bringt Ahmet allen leise einen Tee
      const payer = losers.find((s) => t.seats[s].client) ?? losers[0];
      const pname = t.seats[payer].client?.info.name ?? t.seats[payer].bot?.name ?? '';
      broadcast(t, { type: 'gameEnd', winners, losers, payer, payerName: pname });
      setTimeout(() => {
        if (t.game !== g) return;
        for (const seat of [...winners, ...losers]) broadcast(t, { type: 'order', seat, items: ['cay'], item: 'cay', from: pname, variants: [0], variant: 0, reply: -1, silent: true, treat: true });
      }, 4500);
    }
  }
  if (g?.gameOver && seatQueued(t)) pushTable(t);
  scheduleTurnTimer(t);
  pushState(t);
  scheduleBots(t);
}

// ------------------------------------------------------------------ Nachrichten

type Msg = Record<string, any> & { type: string };

// ------------------------------------------------------------------ Accounts, Freunde, Lobby-Liste

function setOnline(c: Client, on: boolean) {
  if (!c.user) return;
  const set = online.get(c.user.id) ?? new Set();
  if (on) set.add(c);
  else set.delete(c);
  if (set.size) online.set(c.user.id, set);
  else online.delete(c.user.id);
}

async function refreshFriends(c: Client) {
  if (!c.token) return;
  try {
    c.friends = await accounts.friends(c.token);
  } catch {
    c.friends = [];
  }
  c.lastSocial = '';
  pushSocial(c);
}

/** alle offenen Verbindungen eines Accounts neu laden (z. B. nach Freundschaftsanfrage) */
function refreshUser(id: string) {
  for (const o of online.get(id) ?? []) void refreshFriends(o);
}

async function handleAccount(c: Client, m: Msg) {
  try {
    if (m.type === 'logout') {
      if (c.token) accounts.logout(c.token).catch(() => {});
      const old = c.user;
      setOnline(c, false);
      c.user = null;
      c.token = null;
      c.friends = [];
      c.owns = new Set();
      c.info.avatar = cleanAvatar(c, c.info.avatar);
      send(c, { type: 'loggedOut' });
      if (c.table) pushTable(c.table);
      if (old) for (const f of friendIdsOf(old.id)) notifyPresence(f);
      return;
    }
    if (m.type === 'leaderboard') {
      const mode = ['standard', 'okey101', 'perisan', 'pisti', 'batak', 'tavla'].includes(m.mode) ? m.mode : 'standard';
      const rows = await accounts.leaderboard(mode);
      send(c, { type: 'leaderboard', mode, rows });
      return;
    }
    if (m.type === 'register' || m.type === 'login' || m.type === 'resume') {
      let res: { token: string; user: UserRow };
      if (m.type === 'register') res = await accounts.register(String(m.username ?? ''), String(m.password ?? ''), m.avatar ?? c.info.avatar);
      else if (m.type === 'login') res = await accounts.login(String(m.username ?? ''), String(m.password ?? ''));
      else res = { token: String(m.token ?? ''), user: await accounts.me(String(m.token ?? '')) };
      setOnline(c, false);
      c.user = res.user;
      c.token = res.token;
      c.info.name = res.user.username;
      await loadOwned(c);
      if (res.user.avatar) c.info.avatar = cleanAvatar(c, res.user.avatar);
      setOnline(c, true);
      send(c, { type: 'auth', token: res.token, user: { ...res.user, avatar: c.info.avatar }, owns: [...c.owns], dl: c.dl });
      accounts.myStats(res.token).then((st) => send(c, { type: 'stats', stats: st })).catch(() => {});
      if (c.table) pushTable(c.table);
      await refreshFriends(c);
      for (const f of c.friends) if (f.status === 'accepted') notifyPresence(f.id);
      return;
    }
    if (!c.token || !c.user) return send(c, { type: 'authError', key: 'needLogin' });
    if (m.type === 'friendRequest') {
      const r = await accounts.request(c.token, String(m.username ?? ''));
      send(c, { type: 'friendOk', status: r.status, name: String(m.username ?? '') });
      await refreshFriends(c);
      refreshUser(r.id);
      return;
    }
    if (m.type === 'friendRespond') {
      await accounts.respond(c.token, String(m.id), !!m.accept);
      await refreshFriends(c);
      refreshUser(String(m.id));
      return;
    }
    if (m.type === 'friendRemove') {
      await accounts.remove(c.token, String(m.id));
      await refreshFriends(c);
      refreshUser(String(m.id));
    }
  } catch (e) {
    send(c, { type: 'authError', key: e instanceof AccountError ? e.message : 'server', for: m.type });
  }
}

/** wessen Freundesliste enthält diesen Account? (nur online, aus dem Cache) */
function friendIdsOf(id: string): string[] {
  const out = new Set<string>();
  for (const [uid, set] of online) for (const o of set) if (o.friends.some((f) => f.id === id && f.status === 'accepted')) out.add(uid);
  return [...out];
}
function notifyPresence(userId: string) {
  for (const o of online.get(userId) ?? []) pushSocial(o);
}

function whereIs(userId: string) {
  for (const o of online.get(userId) ?? []) {
    const t = o.table;
    if (!t) continue;
    return {
      code: t.isPublic ? t.code : null,
      isPublic: t.isPublic,
      started: t.started,
      mode: t.rules.mode,
      free: t.seats.filter((s) => !s.client && !s.bot).length,
    };
  }
  return null;
}

function lobbyList(c: Client) {
  const friendIds = new Set(c.friends.filter((f) => f.status === 'accepted').map((f) => f.id));
  const list = [...tables.values()]
    .filter((t) => t.isPublic && t !== c.table)
    .map((t) => {
      const people = [...members(t)];
      return {
        code: t.code,
        mode: t.rules.mode,
        started: t.started,
        seats: t.seats.map((s) => (s.client ? { name: s.client.info.name, bot: false } : s.bot ? { name: s.bot.name, bot: true } : null)),
        free: t.seats.filter((s) => !s.client && !s.bot).length,
        spectators: t.spectators.size,
        friends: people.filter((p) => p.user && friendIds.has(p.user.id)).map((p) => p.info.name),
      };
    });
  list.sort((a, b) => b.friends.length - a.friends.length || (a.started ? 1 : 0) - (b.started ? 1 : 0) || a.free - b.free);
  return list.slice(0, 40);
}

function pushSocial(c: Client) {
  const friends = c.friends.map((f) => ({ ...f, online: online.has(f.id), where: f.status === 'accepted' ? whereIs(f.id) : null }));
  const msg = { type: 'social', friends, lobbies: lobbyList(c), online: clients.size };
  const json = JSON.stringify(msg);
  if (json === c.lastSocial) return;
  c.lastSocial = json;
  send(c, msg);
}
// Präsenz & Lobby-Liste regelmäßig aktualisieren (nur bei Änderung wird gesendet)
setInterval(() => {
  for (const c of clients.values()) pushSocial(c);
}, 3000);

function handle(c: Client, m: Msg) {
  const t = c.table;
  switch (m.type) {
    case 'hello': {
      if (typeof m.sid === 'string' && m.sid.length <= 64) c.sid = m.sid;
      if (!c.user) c.info.name = String(m.name ?? 'Oyuncu').slice(0, 20) || 'Oyuncu';
      if (m.avatar) {
        const av = cleanAvatar(c, m.avatar);
        c.info.avatar = av;
        if (c.token && JSON.stringify(av) !== JSON.stringify(c.user?.avatar)) {
          c.user!.avatar = av;
          accounts.saveAvatar(c.token, av).catch(() => {});
        }
      }
      if (typeof m.signature === 'string' && m.signature.length < 200000) c.info.signature = m.signature;
      send(c, { type: 'welcome', id: c.id, dl: c.dl, owns: [...c.owns], stats: c.token ? {} : getStats(c.info.name) });
      if (c.token) accounts.myStats(c.token).then((st) => send(c, { type: 'stats', stats: st })).catch(() => {});
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
        spot: (m.mode as Mode) === 'tavla' ? TAVLA_SPOT : Math.max(0, Math.min(3, Number(m.spot) || 0)),
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
      if (table.closeTimer) {
        clearTimeout(table.closeTimer);
        table.closeTimer = null;
      }
      // Wiederverbinden: derselbe Browser bekommt seinen Platz zurück (Bot geht wieder)
      const mine = c.sid ? table.seats.findIndex((s) => !s.client && s.sid === c.sid) : -1;
      if (mine >= 0 && !m.spectate) {
        table.seats[mine].client = c;
        table.seats[mine].bot = null;
        c.seat = mine;
        if (!table.seats.some((s) => s.client && s.client.id === table.ownerId)) table.ownerId = c.id;
        pushTable(table);
        if (table.game) pushState(table);
        scheduleBots(table);
        return;
      }
      const free = table.seats.findIndex((s) => !s.client && !s.bot);
      if (!m.spectate && free >= 0 && !table.started) {
        table.seats[free].client = c;
        c.seat = free;
      } else {
        // Zuschauer (nur mit Code = eingeladen)
        table.spectators.add(c);
        c.seat = null;
        c.watching = 0;
        c.lounge = null;
        c.wantSeat = null;
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
    case 'register':
    case 'login':
    case 'resume':
    case 'logout':
    case 'friendRequest':
    case 'friendRespond':
    case 'friendRemove':
    case 'leaderboard':
      void handleAccount(c, m);
      return;
    case 'lobbies':
      c.lastSocial = '';
      pushSocial(c);
      return;
    case 'invite': {
      if (!t || !c.user) return;
      const f = c.friends.find((x) => x.id === m.userId && x.status === 'accepted');
      if (!f) return;
      t.invited.add(f.id);
      for (const o of online.get(f.id) ?? []) send(o, { type: 'invite', code: t.code, from: c.user.username, mode: t.rules.mode });
      send(c, { type: 'invited', name: f.username });
      return;
    }
  }

  if (!t) return send(c, { type: 'error', key: 'noTable' });
  const isOwner = t.ownerId === c.id;

  try {
    switch (m.type) {
      case 'sit': {
        const s = Number(m.seat);
        const seat = t.seats[s];
        if (!activeSeats(t).includes(s)) throw new GameError('Dieser Platz spielt in diesem Modus nicht mit');
        if (!seat || seat.client) throw new GameError('Platz besetzt');
        // Vor dem Start nur freie Plätze; im laufenden Spiel darf man einen Bot ablösen
        if (seat.bot && !t.started) throw new GameError('Platz besetzt');
        if (t.started && (!seat.bot || c.seat !== null)) throw new GameError('Spiel läuft schon');
        // Mitten in der Runde: Platz vormerken – hingesetzt wird erst, wenn die Runde fertig ist
        const g = t.game;
        if (t.started && g && !g.gameOver && g.hand.phase !== 'handOver') {
          if ([...t.spectators].some((x) => x !== c && x.wantSeat === s)) throw new GameError('Diesen Platz hat schon jemand vorgemerkt');
          c.wantSeat = s;
          pushTable(t);
          send(c, { type: 'seatQueued', seat: s });
          return;
        }
        seat.bot = null;
        if (c.seat !== null) t.seats[c.seat].client = null;
        t.spectators.delete(c);
        t.ready.delete(s);
        seat.client = c;
        c.seat = s;
        c.watching = null;
        c.lounge = null;
        c.wantSeat = null;
        pushTable(t);
        if (t.game) {
          pushState(t);
          scheduleBots(t);
          scheduleTurnTimer(t);
        }
        return;
      }
      case 'cancelSeat':
        c.wantSeat = null;
        pushTable(t);
        return;
      case 'lounge': {
        // Zuschauer setzt sich in den Raum (Fernseher / Ecke) oder steht auf (null)
        if (c.seat !== null) throw new GameError('Du sitzt am Tisch');
        const k = m.spot === null || m.spot === undefined ? null : String(m.spot);
        if (k !== null && !['tv0', 'tv1', 'c0', 'c1', 'c2', 'c3'].includes(k)) return;
        if (k && [...t.spectators].some((x) => x !== c && x.lounge === k)) throw new GameError('Der Stuhl ist besetzt');
        c.lounge = k;
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
        t.rules.pistiPlayers = t.rules.pistiPlayers === 2 ? 2 : 4;
        t.rules.pistiTarget = Math.max(10, Math.min(1000, Math.round(Number(t.rules.pistiTarget) || 151)));
        t.rules.pistiLastCounts = t.rules.pistiLastCounts !== false;
        t.rules.tavlaTarget = Math.max(1, Math.min(31, Math.round(Number(t.rules.tavlaTarget) || 5)));
        t.rules.tavlaMars = t.rules.tavlaMars !== false;
        // Tavla wird nur in der Tavla-Ecke gespielt
        if (t.rules.mode === 'tavla') {
          for (const i of [1, 3]) t.seats[i].bot = null;
          t.spot = TAVLA_SPOT;
        } else if (t.spot === TAVLA_SPOT) t.spot = 0;
        if (t.rules.mode === 'pisti' && t.rules.pistiPlayers === 2) for (const i of [1, 3]) t.seats[i].bot = null;
        {
          const r = t.rules;
          r.batakMode = (['ihaleli', 'esli', 'gommeli'] as const).includes(r.batakMode) ? r.batakMode : 'ihaleli';
          r.batakTarget = Math.max(5, Math.min(1000, Math.round(Number(r.batakTarget) || 51)));
          r.batakHands = Math.max(0, Math.min(50, Math.round(Number(r.batakHands) || 0)));
          const maxB = r.batakMode === 'gommeli' ? 16 : 13;
          r.batakMinBid = Math.max(1, Math.min(maxB, Math.round(Number(r.batakMinBid) || 5)));
          r.batakOverLimit = Math.max(0, Math.min(13, Math.round(Number(r.batakOverLimit) || 0)));
          r.batakMustTrump = true;
          r.batakTrumpBreak = !!r.batakTrumpBreak;
          r.batakRebid = !!r.batakRebid;
          r.batakZeroBatar = r.batakZeroBatar !== false;
          if (r.mode === 'batak' && r.batakMode === 'gommeli') t.seats[3].bot = null;
        }
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
        if (!activeSeats(t).includes(s)) throw new GameError('Dieser Platz spielt in diesem Modus nicht mit');
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
      case 'giveOwner': {
        if (!isOwner) throw new GameError('Nur der Tischbesitzer');
        const target = members(t).find((x) => x.id === m.id);
        if (!target || target === c) return;
        t.ownerId = target.id;
        pushTable(t);
        broadcast(t, { type: 'ownerChanged', name: target.info.name });
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
        const act = activeSeats(t);
        if (act.some((i) => !t.seats[i].client && !t.seats[i].bot)) throw new GameError(act.length === 2 ? 'Beide Plätze müssen besetzt sein' : 'Alle 4 Plätze müssen besetzt sein');
        // Pişti zu zweit: die anderen beiden Plätze bleiben frei
        for (let i = 0; i < 4; i++) if (!act.includes(i)) t.seats[i].bot = null;
        t.game = newGame(t);
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
        t.game = newGame(t);
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
        if (isBatak(g)) {
          try {
            if (m.action === 'bid') g.bid(seat, m.bid === null || m.bid === undefined ? null : Number(m.bid));
            else if (m.action === 'trump') g.chooseTrump(seat, m.suit);
            else if (m.action === 'bury') g.bury(seat, (Array.isArray(m.cardIds) ? m.cardIds : []).map(Number));
            else if (m.action === 'play') {
              // Eşli: der Bieter spielt auch die offenen Karten seines Partners
              if (g.phase === 'play' && g.dummy !== null && g.current === g.dummy) {
                if (seat !== g.contract!.seat) throw new GameError(seat === g.dummy ? 'Dein Partner legt deine Karten' : 'Nicht dran');
                g.play(g.dummy, Number(m.cardId));
              } else g.play(seat, Number(m.cardId));
            }
            else throw new GameError('Unbekannte Aktion');
          } catch (e) {
            if (e instanceof BatakError) throw new GameError(e.message);
            throw e;
          }
          afterAction(t);
          return;
        }
        if (isTavla(g)) {
          try {
            const from = m.from === 'bar' ? 'bar' : Number(m.from);
            const to = m.to === 'off' ? 'off' : Number(m.to);
            if (m.action === 'roll') g.roll(seat);
            else if (m.action === 'move') g.move(seat, from, to, m.die === undefined ? undefined : Number(m.die));
            else if (m.action === 'undo') g.undo(seat);
            else if (m.action === 'moves' && Array.isArray(m.path)) {
              // ein Pul mit mehreren Würfeln auf einmal (z. B. 2 + 3)
              for (const st of m.path.slice(0, 4)) g.move(seat, st.from === 'bar' ? 'bar' : Number(st.from), st.to === 'off' ? 'off' : Number(st.to), Number(st.die));
            }
            else throw new GameError('Unbekannte Aktion');
          } catch (e) {
            if (e instanceof TavlaError) throw new GameError(e.message);
            throw e;
          }
          afterAction(t);
          return;
        }
        if (isPisti(g)) {
          try {
            if (m.action === 'play') g.play(seat, Number(m.cardId), !!m.bluff);
            else if (m.action === 'respond') g.respond(seat, !!m.believe);
            else throw new GameError('Unbekannte Aktion');
          } catch (e) {
            if (e instanceof PistiError) throw new GameError(e.message);
            throw e;
          }
          afterAction(t);
          return;
        }
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
      case 'emote': {
        // max. alle 2 s (gegen Spam)
        const now = Date.now();
        if (now - ((c as any).lastEmote ?? 0) < 1800) return;
        (c as any).lastEmote = now;
        if (c.seat !== null) broadcast(t, { type: 'emote', seat: c.seat, key: m.key, ring: m.key === 'nargile' && Math.random() < 0.4 });
        return;
      }
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
        const items = ['cay', 'kahve', 'kuruyemis', 'su', 'oralet', 'sahlep', 'icecek'];
        // bis zu 3 Sachen auf einmal (alte Clients schicken nur „item“)
        const list: string[] = (Array.isArray(m.items) ? m.items : [m.item]).filter((x: unknown) => typeof x === 'string' && items.includes(x)).slice(0, 3);
        if (c.seat === null || !list.length) return;
        // nicht dauernd bestellen: Abstand pro Spieler
        const now = Date.now();
        const wait = ORDER_GAP_MS - (now - ((c as any).lastOrder ?? 0));
        if (wait > 0) return send(c, { type: 'error', key: 'orderWait', secs: Math.ceil(wait / 1000) });
        (c as any).lastOrder = now;
        // İçecek: Ahmet bringt eine zufällige Dose (für alle dieselbe)
        const variants = list.map((x) => (x === 'icecek' ? Math.floor(Math.random() * 7) : 0));
        // Ahmet antwortet nur manchmal – und dann abwechselnd (für alle gleich)
        let reply = -1;
        if (Math.random() < 0.5) reply = (t as any).ahmetReply = (((t as any).ahmetReply ?? -1) + 1) % 2;
        broadcast(t, { type: 'order', seat: c.seat, items: list, item: list[0], from: c.info.name, variants, variant: variants[0], reply });
        return;
      }
      case 'setSpot': {
        // anderen Tisch wählen – nur vor dem Spielstart
        if (t.started) throw new GameError('Spiel läuft schon');
        const spot = Math.max(0, Math.min(TAVLA_SPOT, Number(m.spot) || 0));
        // Tavla-Ecke ↔ normale Tische: das Spiel wechselt mit (nur der Tischbesitzer)
        const toTavla = spot === TAVLA_SPOT && t.rules.mode !== 'tavla';
        const fromTavla = spot !== TAVLA_SPOT && t.rules.mode === 'tavla';
        if ((toTavla || fromTavla) && !isOwner) throw new GameError(toTavla ? 'Nur der Tischbesitzer kann zu Tavla wechseln' : 'Nur der Tischbesitzer kann das Spiel wechseln');
        if (toTavla || fromTavla) {
          const keep = { allowBots: t.rules.allowBots, turnTimerSec: t.rules.turnTimerSec };
          t.rules = { ...defaultRules(toTavla ? 'tavla' : 'standard'), ...keep };
          if (toTavla) for (const i of [1, 3]) t.seats[i].bot = null;
        }
        t.spot = spot;
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
      if (t.rules.mode !== 'okey101') {
        // wie am echten Tisch: nur mit richtig umgestelltem Brett
        const pl = g.hand.players[seat];
        const rest = pl.hand.filter((x) => x.id !== Number(m.tileId));
        if (Array.isArray(m.slots) && m.slots.length === 32) t.layouts[seat] = m.slots.map((x: unknown) => (typeof x === 'number' ? x : null));
        const complete = rest.length === 14 && (isCompleteMelds(rest, g.hand.okey) || isCompletePairs(rest, g.hand.okey, g.hand.indicator, t.rules.indicatorPairsAnything));
        if (complete && !rackIsFinished(t.layouts[seat], rest, g.hand.okey, g.hand.indicator, t.rules.indicatorPairsAnything)) throw new GameError('Erst richtig umstellen');
      }
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
  '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg',
  '.js.map': 'application/json',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
};

/** TURN-Zugang von Metered (Umgebungsvariablen METERED_APP + METERED_API_KEY auf Render), 1 h zwischengespeichert */
let iceCache: { at: number; ice: unknown[] } | null = null;
async function iceServers(): Promise<unknown[]> {
  // feste TURN-Zugangsdaten (Metered „Credential“) – nur als Umgebungsvariablen auf Render, nie im Code
  const user = process.env.TURN_USERNAME;
  const pass = process.env.TURN_CREDENTIAL;
  if (user && pass) {
    const host = process.env.TURN_HOST || 'global.relay.metered.ca';
    return [
      { urls: 'stun:stun.relay.metered.ca:80' },
      { urls: `turn:${host}:80`, username: user, credential: pass },
      { urls: `turn:${host}:80?transport=tcp`, username: user, credential: pass },
      { urls: `turn:${host}:443`, username: user, credential: pass },
      { urls: `turns:${host}:443?transport=tcp`, username: user, credential: pass },
    ];
  }
  const app = process.env.METERED_APP;
  const key = process.env.METERED_API_KEY;
  if (!app || !key) return [];
  if (iceCache && Date.now() - iceCache.at < 3600_000) return iceCache.ice;
  try {
    const host = app.includes('.') ? app : `${app}.metered.live`;
    const r = await fetch(`https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ice = (await r.json()) as unknown[];
    if (Array.isArray(ice) && ice.length) iceCache = { at: Date.now(), ice };
    return ice;
  } catch (e) {
    console.error('TURN-Zugang von Metered fehlgeschlagen', e);
    return iceCache?.ice ?? [];
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/ice') {
    void iceServers().then((ice) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(ice));
    });
    return;
  }
  const xm = /^\/x\/([a-z0-9_]+)\.glb$/.exec(url.pathname);
  if (xm) {
    const who = [...clients.values()].find((o) => o.dl === url.searchParams.get('k'));
    const data = exclModels.get(xm[1]);
    if (!who || !data || !mayDownload(who, xm[1])) {
      res.statusCode = 403;
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'model/gltf-binary', 'cache-control': 'private, max-age=3600', 'content-length': String(data.length) });
    res.end(data);
    return;
  }
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
    lounge: null,
    wantSeat: null,
    sid: '',
    user: null,
    token: null,
    friends: [],
    lastSocial: '',
    owns: new Set(),
    dl: crypto.randomBytes(18).toString('hex'),
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
    const u = c.user;
    setOnline(c, false);
    if (u) for (const f of friendIdsOf(u.id)) notifyPresence(f);
  });
});

loadStats();
server.listen(PORT, () => console.log(`Okeyhane läuft auf http://localhost:${PORT}`));
