// Fernseher + Musik: YouTube (synchron mit dem Tisch) und Radio-Streams.

import type { MediaState } from '../../server/src/protocol.ts';
import { settings, vol } from './settings.ts';

declare global {
  interface Window {
    YT: any;
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

  refreshVolume() {
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
    this.stopYT();
    this.stopAudio();
  }

  isActive() {
    return !!this.yt;
  }

  tick() {
    // alle paar Sekunden nachsynchronisieren
    this.syncYT();
  }
}

export function musicModeActive() {
  return settings.musicMode;
}
