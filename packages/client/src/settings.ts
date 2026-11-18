// Persönliche Einstellungen (lokal gespeichert)

import type { Avatar } from '../../server/src/protocol.ts';

export interface Settings {
  volMaster: number;
  volSfx: number;
  volVoice: number;
  volTv: number;
  volMusic: number;
  volNpc: number;
  smoke: boolean;
  quality: 'low' | 'high';
  timeOfDay: 'auto' | 'day' | 'evening' | 'night';
  tvMode: 'table' | 'off';
  musicMode: 'table' | 'off' | 'own';
  ownMusicUrl: string;
  pushToTalk: boolean;
  keys: KeyBinds;
  /** Sichtfeld am Tisch / beim Laufen (Grad, vertikal) */
  fovTable: number;
  fovWalk: number;
  /** Blickwinkel am Tisch nach unten (Grad) */
  camTilt: number;
  /** Maus/Touch/Stick-Empfindlichkeit in % */
  sensitivity: number;
  invertY: boolean;
  /** Touch-Steuerung: auto = bei Touchscreen */
  touchUi: 'auto' | 'on' | 'off';
  /** Tastenkürzel-Hilfe unten einblenden */
  showKeyHints: boolean;
  /** Arabesk-Melodie im Menü */
  menuMusic: boolean;
  /** Spielerliste links eingeklappt */
  hudCompact: boolean;
  /** Anzeige oben (Punkte/Okey) ausgeblendet */
  hideTop: boolean;
  /** Chat ausgeblendet */
  hideChat: boolean;
  /** Kahvehane-Radio: Sender-ID oder 'off' */
  radioStation: string;
  /** Menümusik + Radio stumm */
  musicMuted: boolean;
}

export interface KeyBinds {
  // Bewegung / Ansicht
  forward: string;
  back: string;
  left: string;
  right: string;
  look: string;
  zoom: string;
  thirdBack: string;
  thirdFront: string;
  // Spielzüge
  drawPile: string;
  drawSide: string;
  discard: string;
  finish: string;
  indicator: string;
  okeyBir: string;
  select: string;
  flip: string;
  sortRuns: string;
  sortPairs: string;
  // Emotes & Kahvehane
  emoteWheel: string;
  emoteTea: string;
  emoteNargile: string;
  emoteSlam: string;
  emoteTespih: string;
  emoteHeadshake: string;
  emoteRub: string;
  wink: string;
  blink: string;
  wide: string;
  cayci: string;
  quick: string;
  chat: string;
  sheet: string;
  media: string;
  ptt: string;
}

export const defaultKeys: KeyBinds = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  look: 'Space',
  zoom: 'KeyC',
  thirdBack: 'KeyB',
  thirdFront: 'KeyN',
  drawPile: 'KeyQ',
  drawSide: 'KeyW',
  discard: 'KeyF',
  finish: 'KeyG',
  indicator: 'KeyI',
  okeyBir: 'KeyO',
  select: 'KeyR',
  flip: 'KeyX',
  sortRuns: 'KeyH',
  sortPairs: 'KeyJ',
  emoteWheel: 'KeyE',
  emoteTea: 'Digit4',
  emoteNargile: 'Digit5',
  emoteSlam: 'Digit6',
  emoteTespih: 'Digit7',
  emoteHeadshake: 'Digit8',
  emoteRub: 'Digit9',
  wink: 'Digit1',
  blink: 'Digit2',
  wide: 'Digit3',
  cayci: 'KeyK',
  quick: 'KeyT',
  chat: 'Enter',
  sheet: 'KeyY',
  media: 'KeyM',
  ptt: 'KeyV',
};

/** Lesbarer Name einer Taste */
export function keyLabel(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: '␣', ShiftLeft: 'Shift', ControlLeft: 'Strg', AltLeft: 'Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '^', Enter: 'Enter', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return map[code] ?? code;
}

const defaults: Settings = {
  volMaster: 80,
  volSfx: 70,
  volVoice: 90,
  volTv: 60,
  volMusic: 50,
  volNpc: 30,
  smoke: true,
  quality: 'high',
  timeOfDay: 'auto',
  tvMode: 'table',
  musicMode: 'table',
  ownMusicUrl: '',
  pushToTalk: false,
  keys: { ...defaultKeys },
  fovTable: 62,
  fovWalk: 66,
  camTilt: 0,
  sensitivity: 100,
  invertY: false,
  touchUi: 'auto',
  showKeyHints: false,
  menuMusic: true,
  hudCompact: false,
  hideTop: false,
  hideChat: false,
  radioStation: 'okeyhane',
  musicMuted: false,
};
/** Touchgerät (Handy/Tablet) */
export const isTouch = typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1);
if (isTouch) {
  defaults.quality = 'low';
  defaults.hudCompact = true;
  defaults.hideChat = true;
}

const stored = JSON.parse(localStorage.getItem('settings') || '{}');
export const settings: Settings = { ...defaults, ...stored, keys: { ...defaultKeys, ...(stored.keys ?? {}) } };
// Migration: Kamera am Tisch wieder klassisch (v2)
if ((stored.v ?? 1) < 2) {
  settings.fovTable = 62;
  settings.camTilt = 0;
}
// v3: Tasten-/Bedienhinweise standardmäßig aus (über ❔ einblendbar)
if ((stored.v ?? 1) < 3) settings.showKeyHints = false;
// v4: E öffnet das Emote-Rad, „von der Seite“ wandert auf W
if ((stored.v ?? 1) < 4) {
  if (settings.keys.drawSide === 'KeyE') settings.keys.drawSide = 'KeyW';
  settings.keys.emoteWheel = 'KeyE';
}
(settings as any).v = 4;
const listeners = new Set<() => void>();

export function saveSettings() {
  localStorage.setItem('settings', JSON.stringify(settings));
  listeners.forEach((l) => l());
}
export function onSettings(l: () => void) {
  listeners.add(l);
}

export const defaultAvatar: Avatar = {
  skin: '#d9a77c',
  face: 'round',
  hair: 'short',
  hairColor: '#2b1d14',
  eyebrows: 'thick',
  beard: 'stubble',
  mustache: 'classic',
  shirt: 'gomlek',
  shirtColor: '#7a3b2e',
  hat: 'none',
  glasses: 'none',
  accessory: 'tespih',
  jewelry: 'none',
  shisha: 'classic',
};

export interface Profile {
  name: string;
  avatar: Avatar;
  signature: string | null;
}

export function loadProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem('profile') || 'null');
  } catch {
    return null;
  }
}
export function saveProfile(p: Profile) {
  localStorage.setItem('profile', JSON.stringify(p));
}

export const vol = (k: 'volSfx' | 'volVoice' | 'volTv' | 'volMusic' | 'volNpc') =>
  (settings[k] / 100) * (settings.volMaster / 100);
