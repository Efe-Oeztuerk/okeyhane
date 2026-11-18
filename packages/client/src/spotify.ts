// Spotify für die eigene Musik: offizieller Spotify-Player (Embed iFrame API).
// Mit Spotify-Login im Browser laufen ganze Songs, sonst 30-s-Vorschauen.
// Starten muss man selbst (Spotify erlaubt kein Autoplay); das Spiel merkt, wenn er läuft.

import { h } from './dom.ts';
import { getLang } from './i18n.ts';

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: any) => void;
  }
}

/** Spotify-Link → URI (Playlist, Album, Song, Künstler) */
export function parseSpotify(url: string): string | null {
  url = url.trim();
  if (/^spotify:(playlist|album|track|artist|show|episode):[A-Za-z0-9]+$/.test(url)) return url;
  const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/.exec(url);
  return m ? `spotify:${m[1]}:${m[2]}` : null;
}

let apiP: Promise<any> | null = null;
function loadApi(): Promise<any> {
  if (apiP) return apiP;
  apiP = new Promise((res) => {
    window.onSpotifyIframeApiReady = (api) => res(api);
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    document.head.append(s);
  });
  return apiP;
}

class SpotifyMini {
  private box: HTMLElement | null = null;
  private ctrl: any = null;
  private uri = '';
  playing = false;
  onPlaying: ((p: boolean) => void) | null = null;
  /** Nutzer hat den Player geschlossen */
  onClosed: (() => void) | null = null;

  /** Player einblenden und Playlist laden */
  async open(uri: string) {
    if (!this.box) {
      const mount = h('div', { class: 'sp-mount' });
      this.box = h(
        'div',
        { class: 'spotify-mini panel' },
        h(
          'div',
          { class: 'sp-head' },
          h('b', {}, '🟢 Spotify'),
          h('span', { class: 'muted' }, getLang() === 'de' ? 'nur für dich · ▶ drücken' : 'sadece sana · ▶ bas'),
          h('button', { class: 'small ghost', title: 'klein/groß', onclick: () => this.box!.classList.toggle('min') }, '▾'),
          h('button', { class: 'small ghost', title: 'schließen', onclick: () => (this.close(), this.onClosed?.()) }, '✕'),
        ),
        mount,
      );
      document.body.append(this.box);
      const api = await loadApi();
      await new Promise<void>((res) =>
        api.createController(mount, { uri, width: '100%', height: 152 }, (c: any) => {
          this.ctrl = c;
          c.addListener('playback_update', (e: any) => this.setPlaying(!e.data.isPaused));
          res();
        }),
      );
      this.uri = uri;
      return;
    }
    this.box.classList.remove('hidden');
    if (uri !== this.uri) {
      this.uri = uri;
      this.ctrl?.loadUri(uri);
    }
  }

  private setPlaying(p: boolean) {
    if (p === this.playing) return;
    this.playing = p;
    this.onPlaying?.(p);
  }

  pause() {
    try {
      this.ctrl?.pause();
    } catch {}
    this.setPlaying(false);
  }

  close() {
    this.pause();
    try {
      this.ctrl?.destroy();
    } catch {}
    this.ctrl = null;
    this.uri = '';
    this.box?.remove();
    this.box = null;
  }

  isOpen() {
    return !!this.box;
  }
}

export const spotify = new SpotifyMini();
