// Musik im Menü und das Kahvehane-Radio.
//  - Menü: eigene Okeyhane-Melodien (Suno), weich ein-/ausgeblendet, Titel wechseln mit Überblendung
//  - Kahvehane: Radio mit festen Sendern (eigene Titel oder YouTube-Playlists).
//    Läuft am Tisch Musik/TV oder hörst du eigene Musik, wird das Radio automatisch leise und pausiert.

import { settings, vol, onSettings, saveSettings } from './settings.ts';
import { loadYT } from './media.ts';

const XFADE = 3; // Sekunden Überblendung zwischen Titeln

// ------------------------------------------------------------------ Sender

export interface Station {
  id: string;
  name: string;
  /** eigene MP3-Dateien (public/music) */
  tracks?: string[];
  /** YouTube-Playlist-ID (list=…) */
  youtubeList?: string;
}

/** Feste Radiosender – weitere Playlists hier eintragen */
export const STATIONS: Station[] = [
  { id: 'okeyhane', name: '🫖 Okeyhane Melodileri', tracks: ['/music/okeyhane_1.mp3', '/music/okeyhane_2.mp3'] },
  { id: 'arabesk', name: '🌙 Arabesk', youtubeList: 'PL7HMkQQh_K4GSJTxlk4Lr4nzOLSvnxbMT' },
  { id: 'pop', name: '🎤 Türkçe Pop', youtubeList: 'PLDIoUOhQQPlVr3qepMVRsDe4T8vNQsvno' },
];

// ------------------------------------------------------------------ Lokale Titel mit Überblendung

class TrackPlayer {
  private a: HTMLAudioElement[] = [new Audio(), new Audio()];
  private cur = 0;
  private idx = 0;
  level = 0;
  target = 0;
  blocked = false;
  constructor(private tracks: () => string[], private gain: () => number, start = 0) {
    this.idx = start;
    this.a.forEach((el) => (el.preload = 'auto'));
  }
  private src(i: number) {
    const t = this.tracks();
    return t.length ? t[((i % t.length) + t.length) % t.length] : '';
  }
  play() {
    const el = this.a[this.cur];
    if (!this.tracks().length) return;
    if (!el.src || !el.src.endsWith(this.src(this.idx))) el.src = this.src(this.idx);
    if (el.paused)
      el.play().then(
        () => (this.blocked = false),
        () => (this.blocked = true),
      );
  }
  title() {
    const t = this.tracks();
    return t.length ? `Melodi ${((this.idx % t.length) + t.length) % t.length + 1}` : '';
  }
  isPlaying() {
    return this.a.some((e) => !e.paused);
  }
  skip() {
    const el = this.a[this.cur];
    if (el.duration) el.currentTime = Math.max(0, el.duration - XFADE - 0.1);
  }
  stop() {
    this.a.forEach((e) => {
      e.pause();
      e.removeAttribute('src');
      e.load();
    });
  }
  tick(dt: number) {
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), dt * 0.6);
    const base = this.gain() * this.level;
    const el = this.a[this.cur];
    const other = this.a[1 - this.cur];
    if (this.target > 0 && el.paused && this.level > 0) this.play();
    if (el.duration && !el.paused && el.duration - el.currentTime < XFADE) {
      // nächster Titel blendet über
      if (other.paused) {
        this.idx++;
        other.src = this.src(this.idx);
        other.currentTime = 0;
        other.play().catch(() => {});
      }
      const f = Math.max(0, (el.duration - el.currentTime) / XFADE);
      el.volume = clamp(base * f);
      other.volume = clamp(base * (1 - f));
      if (el.ended || el.duration - el.currentTime < 0.15) {
        el.pause();
        this.cur = 1 - this.cur;
      }
    } else {
      el.volume = clamp(base);
      if (!other.paused && other.currentTime > XFADE) other.pause();
    }
    if (this.level === 0) this.a.forEach((e) => !e.paused && e.pause());
  }
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));

// ------------------------------------------------------------------ YouTube-Playlist (versteckt)

class YtListPlayer {
  private host: HTMLDivElement;
  private yt: any = null;
  private list = '';
  level = 0;
  target = 0;
  constructor(private gain: () => number) {
    this.host = document.createElement('div');
    this.host.style.cssText = 'position:fixed;width:2px;height:2px;left:-10px;top:-10px;overflow:hidden';
    document.body.append(this.host);
  }
  async load(list: string) {
    if (list === this.list && this.yt) return;
    this.list = list;
    await loadYT();
    if (this.yt) {
      this.yt.loadPlaylist({ list, listType: 'playlist', index: Math.floor(Math.random() * 20) });
      this.yt.setShuffle?.(true);
      return;
    }
    const mount = document.createElement('div');
    this.host.append(mount);
    this.yt = await new Promise((res) => {
      const p = new window.YT.Player(mount, {
        width: 2,
        height: 2,
        playerVars: { listType: 'playlist', list, autoplay: 1, controls: 0, loop: 1, playsinline: 1 },
        events: {
          onReady: () => {
            try {
              p.setShuffle(true);
              p.setLoop(true);
              p.setVolume(0);
            } catch {}
            res(p);
          },
        },
      });
    });
  }
  next() {
    try {
      this.yt?.nextVideo();
    } catch {}
  }
  title(): string {
    try {
      return this.yt?.getVideoData?.()?.title ?? '';
    } catch {
      return '';
    }
  }
  isPlaying() {
    try {
      return this.yt?.getPlayerState?.() === 1;
    } catch {
      return false;
    }
  }
  stop() {
    try {
      this.yt?.destroy();
    } catch {}
    this.yt = null;
    this.list = '';
    this.host.innerHTML = '';
  }
  tick(dt: number) {
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), dt * 0.6);
    if (!this.yt) return;
    try {
      this.yt.setVolume(Math.round(this.gain() * this.level * 100));
      const st = this.yt.getPlayerState?.();
      if (this.level === 0 && st === 1) this.yt.pauseVideo();
      else if (this.level > 0 && st !== 1 && st !== 3) this.yt.playVideo();
    } catch {}
  }
}

// ------------------------------------------------------------------ Steuerung

class MusicDirector {
  private menu = new TrackPlayer(
    () => STATIONS[0].tracks ?? [],
    () => vol('volMusic') * 0.95,
  );
  private radioTracks = new TrackPlayer(
    () => this.station()?.tracks ?? [],
    () => vol('volMusic') * 0.9,
    1,
  );
  private radioYt = new YtListPlayer(() => vol('volMusic') * 0.9);
  private where: 'menu' | 'cafe' | 'none' = 'none';
  /** andere Musik läuft (Tisch-Musik, TV oder eigene) */
  private busy = false;
  private unlocked = false;
  onChange: (() => void) | null = null;

  constructor() {
    const kick = () => {
      this.unlocked = true;
      this.update();
    };
    addEventListener('pointerdown', kick);
    addEventListener('keydown', kick);
    onSettings(() => this.update());
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      this.menu.tick(dt);
      this.radioTracks.tick(dt);
      this.radioYt.tick(dt);
    }, 100);
  }

  station(): Station | null {
    return STATIONS.find((s) => s.id === settings.radioStation) ?? null;
  }

  /** wo ist der Spieler gerade */
  set(where: 'menu' | 'cafe') {
    this.where = where;
    this.update();
  }
  /** Tisch-Musik / TV / eigene Musik läuft → Radio aus */
  setBusy(b: boolean) {
    if (b === this.busy) return;
    this.busy = b;
    this.update();
  }
  isBusy() {
    return this.busy;
  }

  nextTrack() {
    if (this.station()?.youtubeList) this.radioYt.next();
    else this.radioTracks.skip();
  }

  /** Anzeige im Kahvehane */
  status(): { text: string; state: 'playing' | 'busy' | 'muted' | 'off' | 'blocked' | 'loading' } {
    const st = this.station();
    if (!st) return { text: 'Radio aus', state: 'off' };
    if (settings.musicMuted) return { text: st.name, state: 'muted' };
    if (this.busy) return { text: st.name, state: 'busy' };
    const yt = !!st.youtubeList;
    const playing = yt ? this.radioYt.isPlaying() : this.radioTracks.isPlaying();
    const title = yt ? this.radioYt.title() : this.radioTracks.title();
    if (!this.unlocked || this.radioTracks.blocked) return { text: st.name, state: 'blocked' };
    return { text: st.name + (title ? ' · ' + title : ''), state: playing ? 'playing' : 'loading' };
  }

  /** Klick auf die Anzeige = Nutzergeste → Wiedergabe erlauben */
  unlock() {
    this.unlocked = true;
    this.radioTracks.blocked = false;
    this.update();
  }

  private update() {
    const on = this.unlocked && !settings.musicMuted;
    this.menu.target = on && settings.menuMusic && this.where === 'menu' ? 1 : 0;
    const st = this.station();
    const radioOn = on && this.where === 'cafe' && !this.busy && !!st;
    this.radioTracks.target = radioOn && !!st?.tracks ? 1 : 0;
    this.radioYt.target = radioOn && !!st?.youtubeList ? 1 : 0;
    if (radioOn && st?.youtubeList) this.radioYt.load(st.youtubeList);
    if (!st?.youtubeList && this.radioYt.level === 0) this.radioYt.stop();
    this.onChange?.();
  }

  toggleMute() {
    settings.musicMuted = !settings.musicMuted;
    saveSettings();
  }
}

export const music = new MusicDirector();
