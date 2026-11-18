// Hintergrundmusik im Menü (Arabesk/Kahvehane, z. B. aus Suno): /music/menu.mp3
// Startet nach der ersten Interaktion (Browser-Autoplay-Regel), blendet weich ein/aus
// und schleift mit Überblendung, damit der Loop nicht hart springt.

import { settings, vol, onSettings } from './settings.ts';

const SRC = '/music/menu.mp3';
const XFADE = 3; // Sekunden Überblendung am Loop-Ende

class MenuMusic {
  private a: HTMLAudioElement[] = [];
  private cur = 0;
  private want = false;
  private level = 0; // 0..1 Ein-/Ausblendung
  private missing = false;
  private started = false;

  constructor() {
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = 'auto';
      el.src = SRC;
      el.addEventListener('error', () => (this.missing = true));
      this.a.push(el);
    }
    const kick = () => {
      if (this.want) this.play();
    };
    addEventListener('pointerdown', kick);
    addEventListener('keydown', kick);
    onSettings(() => this.apply());
    setInterval(() => this.tick(), 100);
  }

  /** im Menü: an · im Kahvehane: aus */
  set(on: boolean) {
    this.want = on;
    if (on) this.play();
  }

  private play() {
    if (this.missing || !settings.menuMusic) return;
    const el = this.a[this.cur];
    if (!el.paused) return;
    if (!this.started) el.currentTime = 0;
    el.play().then(
      () => (this.started = true),
      () => {},
    );
  }

  private apply() {
    if (!settings.menuMusic) this.want && this.a.forEach((e) => e.pause());
    else if (this.want) this.play();
  }

  private tick() {
    const target = this.want && settings.menuMusic ? 1 : 0;
    this.level += Math.sign(target - this.level) * Math.min(Math.abs(target - this.level), 0.06);
    const base = vol('volMusic') * 0.7 * this.level;
    const el = this.a[this.cur];
    const other = this.a[1 - this.cur];
    // Loop mit Überblendung
    if (el.duration && !el.paused && el.duration - el.currentTime < XFADE) {
      if (other.paused) {
        other.currentTime = 0;
        other.play().catch(() => {});
      }
      const f = Math.max(0, (el.duration - el.currentTime) / XFADE);
      el.volume = base * f;
      other.volume = base * (1 - f);
      if (el.ended || el.duration - el.currentTime < 0.15) {
        el.pause();
        this.cur = 1 - this.cur;
      }
    } else {
      el.volume = base;
      if (!other.paused && other.currentTime > XFADE) other.pause();
    }
    if (this.level === 0) this.a.forEach((e) => !e.paused && e.pause());
  }
}

export const menuMusic = new MenuMusic();
