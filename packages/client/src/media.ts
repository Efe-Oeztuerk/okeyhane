// Fernseher + Musik: YouTube (synchron mit dem Tisch) und Radio-Streams.

import type { MediaState } from '../../server/src/protocol.ts';
import { settings, vol } from './settings.ts';

declare global {
  interface Window {
    YT: any;
    Twitch: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let ytReady: Promise<void> | null = null;
export function loadYT(): Promise<void> {
  if (ytReady) return ytReady;
  ytReady = new Promise((res) => {
    if (window.YT?.Player) return res();
    window.onYouTubeIframeAPIReady = () => res();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  });
  return ytReady;
}

let twReady: Promise<void> | null = null;
function loadTwitch(): Promise<void> {
  if (twReady) return twReady;
  twReady = new Promise((res, rej) => {
    if (window.Twitch?.Player) return res();
    const s = document.createElement('script');
    s.src = 'https://player.twitch.tv/js/embed/v1.js';
    s.onload = () => res();
    s.onerror = () => {
      twReady = null;
      rej(new Error('twitch'));
    };
    document.head.append(s);
  });
  return twReady;
}

/** Twitch-Link → Kanalname (twitch.tv/papaplatte) */
export function parseTwitch(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/(^|\.)twitch\.tv$/.test(u.hostname)) return null;
    const ch = u.pathname.split('/').filter(Boolean)[0];
    if (!ch || ['videos', 'directory', 'search', 'settings', 'p'].includes(ch)) return null;
    return /^\w{2,25}$/.test(ch) ? ch.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** YouTube-Link → Video-ID (auch Live, Shorts, youtu.be) */
export function parseYouTube(url: string): string | null {
  url = url.trim();
  if (/^[\w-]{11}$/.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(embed|live|shorts|v)\/([\w-]{11})/);
    if (m) return m[2];
  } catch {}
  return null;
}

export class MediaPlayer {
  private yt: any = null;
  private tw: any = null;
  private twChannel: string | null = null;
  private ytId: string | null = null;
  private audio: HTMLAudioElement | null = null;
  private state: MediaState | null = null;
  private mount: HTMLElement;
  enabled = true;
  /** zusätzlicher Faktor (z. B. 0 = stumm, weil ein anderer Fernseher näher ist) */
  gain = 1;

  constructor(
    private host: HTMLElement,
    private volKey: 'volTv' | 'volMusic',
    private visible: boolean,
  ) {
    this.mount = document.createElement('div');
    this.mount.className = 'yt-mount';
    host.append(this.mount);
  }

  private targetPos(st: MediaState) {
    return st.playing ? st.position + (Date.now() - st.at) / 1000 : st.position;
  }

  private volume(st: MediaState | null) {
    return Math.round(vol(this.volKey) * ((st?.volume ?? 100) / 100) * this.gain * 100);
  }

  async apply(st: MediaState | null) {
    this.state = st;
    const src = this.enabled ? st?.source ?? null : null;
    if (!src) {
      this.stopAll();
      return;
    }
    if (src.kind === 'twitch') {
      this.stopAudio();
      this.stopYT();
      if (this.twChannel !== src.channel) {
        this.stopTwitch();
        try {
          await loadTwitch();
        } catch {
          return;
        }
        this.twChannel = src.channel;
        this.tw = new window.Twitch.Player(this.mount, {
          channel: src.channel,
          parent: [location.hostname],
          width: '100%',
          height: '100%',
          autoplay: true,
          muted: false,
        });
        this.tw.addEventListener?.(window.Twitch.Player.READY, () => this.syncTwitch());
      }
      this.host.classList.toggle('active', this.visible);
      this.syncTwitch();
      return;
    }
    this.stopTwitch();
    if (src.kind === 'youtube') {
      this.stopAudio();
      await loadYT();
      if (!this.yt) {
        this.yt = await new Promise((res) => {
          const p = new window.YT.Player(this.mount, {
            width: '100%',
            height: '100%',
            videoId: src.id,
            playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
            events: { onReady: () => res(p) },
          });
        });
        this.ytId = src.id;
        this.host.classList.toggle('active', this.visible);
      } else if (this.ytId !== src.id) {
        this.ytId = src.id;
        this.yt.loadVideoById(src.id, this.targetPos(st!));
      }
      this.host.classList.toggle('active', this.visible);
      this.syncYT();
    } else {
      this.stopYT();
      if (!this.audio) this.audio = new Audio();
      if (this.audio.src !== src.url) {
        this.audio.src = src.url;
        this.audio.crossOrigin = 'anonymous';
      }
      this.audio.volume = this.volume(st) / 100;
      if (st!.playing) this.audio.play().catch(() => {});
      else this.audio.pause();
    }
  }

  private syncYT() {
    const st = this.state;
    if (!this.yt || !st) return;
    try {
      this.yt.setVolume(this.volume(st));
      const want = this.targetPos(st);
      const have = this.yt.getCurrentTime?.() ?? 0;
      const live = this.yt.getDuration?.() === 0;
      if (!live && Math.abs(want - have) > 2.5) this.yt.seekTo(want, true);
      if (st.playing) this.yt.playVideo();
      else this.yt.pauseVideo();
    } catch {}
  }

  private syncTwitch() {
    const st = this.state;
    if (!this.tw || !st) return;
    try {
      const v = this.volume(st) / 100;
      this.tw.setMuted(v <= 0.001);
      this.tw.setVolume(v);
      if (st.playing && this.tw.isPaused?.()) this.tw.play();
      else if (!st.playing && !this.tw.isPaused?.()) this.tw.pause();
    } catch {}
  }

  private stopTwitch() {
    if (!this.tw && !this.twChannel) return;
    this.tw = null;
    this.twChannel = null;
    this.mount = document.createElement('div');
    this.mount.className = 'yt-mount';
    this.host.innerHTML = '';
    this.host.append(this.mount);
    this.host.classList.remove('active');
  }

  refreshVolume() {
    this.syncTwitch();
    if (this.audio) this.audio.volume = this.volume(this.state) / 100;
    try {
      this.yt?.setVolume(this.volume(this.state));
    } catch {}
  }

  /** Eigene Musik (nur lokal) */
  async playLocal(url: string) {
    const id = parseYouTube(url);
    const st: MediaState = id
      ? { source: { kind: 'youtube', id }, playing: true, position: 0, at: Date.now(), volume: 100 }
      : { source: { kind: 'stream', url }, playing: true, position: 0, at: Date.now(), volume: 100 };
    await this.apply(st);
  }

  private stopYT() {
    if (this.yt) {
      try {
        this.yt.destroy();
      } catch {}
      this.yt = null;
      this.ytId = null;
      this.mount = document.createElement('div');
      this.mount.className = 'yt-mount';
      this.host.innerHTML = '';
      this.host.append(this.mount);
    }
    this.host.classList.remove('active');
  }
  private stopAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }
  }
  stopAll() {
    this.stopTwitch();
    this.stopYT();
    this.stopAudio();
  }

  isActive() {
    return !!this.yt || !!this.tw;
  }

  tick() {
    // alle paar Sekunden nachsynchronisieren
    this.syncYT();
    this.syncTwitch();
  }
}

export function musicModeActive() {
  return settings.musicMode;
}
