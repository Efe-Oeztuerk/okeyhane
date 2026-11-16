// Dezente Geräusche, erzeugt mit WebAudio (keine Audiodateien nötig).

import { vol } from './settings.ts';

let ctx: AudioContext | null = null;
function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

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
};

export function unlockAudio() {
  ac();
}
