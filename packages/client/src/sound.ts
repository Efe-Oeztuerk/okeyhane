// Dezente Geräusche, erzeugt mit WebAudio (keine Audiodateien nötig).

import { vol } from './settings.ts';

let ctx: AudioContext | null = null;
// iPhone: Töne auch bei Lautlos-Schalter abspielen (Safari 17+), sonst bleibt WebAudio stumm
try {
  const s = (navigator as any).audioSession;
  if (s) s.type = 'playback';
} catch {}
function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  return ctx;
}
// iOS/Android lassen Audio nur nach einer Berührung starten und pausieren ihn nach Hintergrund/Anruf:
// bei jeder Berührung wieder aufwecken (kostet nichts, wenn er schon läuft)
for (const ev of ['pointerdown', 'touchend', 'keydown'] as const)
  addEventListener(ev, () => {
    const a = ac();
    if (a.state === 'running' || (a as any)._primed) return;
    // ein stiller Ton „entsperrt“ den Kontext auf iOS
    const b = a.createBuffer(1, 1, 22050);
    const src = a.createBufferSource();
    src.buffer = b;
    src.connect(a.destination);
    src.start(0);
  }, { passive: true, capture: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
});

function click(freq: number, dur: number, gain: number, type: OscillatorType = 'square') {
  const v = vol('volSfx') * gain;
  if (v <= 0) return;
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(v, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

function noise(dur: number, gain: number, lowpass = 2000, target: 'volSfx' | 'volNpc' = 'volSfx') {
  const v = vol(target) * gain;
  if (v <= 0) return;
  const a = ac();
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = v;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  tile: () => {
    click(1800, 0.04, 0.15, 'triangle');
    noise(0.05, 0.25, 4000);
  },
  draw: () => noise(0.08, 0.2, 2500),
  /** Würfel klappern auf dem Holzbrett */
  dice: () => {
    [0, 70, 150, 240, 360, 470].forEach((t, i) =>
      setTimeout(() => {
        click(1300 + Math.random() * 500, 0.03, 0.22 - i * 0.025, 'triangle');
        noise(0.03, 0.18 - i * 0.02, 3500);
      }, t),
    );
  },
  /** Pul (Holzstein) wird abgesetzt */
  checker: () => {
    click(700, 0.05, 0.28, 'triangle');
    noise(0.04, 0.22, 1800);
  },
  slam: () => {
    noise(0.25, 0.9, 600);
    click(90, 0.2, 0.5, 'sine');
  },
  finish: () => {
    for (let i = 0; i < 5; i++) setTimeout(() => sfx.tile(), i * 60);
  },
  shuffle: () => {
    for (let i = 0; i < 12; i++) setTimeout(() => noise(0.06, 0.15, 3000), i * 45);
  },
  sip: () => noise(0.3, 0.12, 900),
  smoke: () => noise(0.6, 0.12, 400),
  bell: () => {
    click(1320, 0.4, 0.08, 'sine');
    setTimeout(() => click(1760, 0.5, 0.06, 'sine'), 90);
  },
  spoon: () => {
    click(3200, 0.08, 0.05, 'sine');
    setTimeout(() => click(3400, 0.08, 0.04, 'sine'), 120);
  },
  murmur: () => noise(1.2, 0.05, 500, 'volNpc'),
  /** Nargile-Blubbern */
  bubble: () => {
    for (let i = 0; i < 9; i++)
      setTimeout(() => {
        click(140 + Math.random() * 120, 0.09, 0.22, 'sine');
        noise(0.05, 0.08, 700);
      }, i * 85 + Math.random() * 30);
  },
  /** Ausatmen */
  exhale: () => noise(1.1, 0.18, 1200),
  /** kurzes Zwinkern-Geräusch */
  wink: () => click(1500, 0.05, 0.05, 'sine'),
};

// ---------------------------------------------------------------- Audiodateien über WebAudio
// (iPhone/iPad ignorieren audio.volume – über WebAudio greifen Gesamt- und Einzel-Lautstärke überall)
const bufCache = new Map<string, Promise<AudioBuffer | null>>();
function loadBuf(url: string) {
  let p = bufCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => new Promise<AudioBuffer | null>((res) => ac().decodeAudioData(b, res, () => res(null))))
      .catch(() => null);
    bufCache.set(url, p);
  }
  return p;
}
export const preloadFile = (url: string) => void loadBuf(url);
/** spielt eine Datei; Lautstärke = Regler × gain (Dateien sind laut gemischt → Grundfaktor 0.7). Promise endet, wenn fertig. */
export function playFile(url: string, gain = 1, target: 'volSfx' | 'volChar' | 'volNpc' = 'volSfx'): Promise<void> {
  const v = vol(target) * gain * 0.7;
  if (v <= 0) return Promise.resolve();
  return loadBuf(url).then(
    (buf) =>
      new Promise<void>((res) => {
        if (!buf) return res();
        const a = ac();
        const src = a.createBufferSource();
        const g = a.createGain();
        src.buffer = buf;
        g.gain.value = Math.min(1.5, v);
        src.connect(g).connect(a.destination);
        src.onended = () => res();
        src.start();
        setTimeout(res, buf.duration * 1000 + 300);
      }),
  );
}

export function unlockAudio() {
  ac();
}
