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
};

export const settings: Settings = { ...defaults, ...JSON.parse(localStorage.getItem('settings') || '{}') };
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
