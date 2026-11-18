// Cartoon-Charakter: sauber modelliert, Kleidung als Textur, weiche Animationen mit IK.

import { RealBody } from './realbody.ts';
import * as THREE from 'three';
import type { Avatar } from '../../server/src/protocol.ts';

// ------------------------------------------------------------------ Materialien & Texturen

const mat = (color: string, rough = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

const hairTexCache = new Map<string, THREE.Texture>();
/** Haar-Textur mit Strähnen */
function hairTexture(color: string): THREE.Texture {
  const hit = hairTexCache.get(color);
  if (hit) return hit;
  const t = canvas(256, 256, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const len = 10 + Math.random() * 26;
      g.strokeStyle = Math.random() > 0.5 ? shade(color, 1.45) + '55' : shade(color, 0.55) + '66';
      g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 3, y + len / 2, x + (Math.random() - 0.5) * 6, y + len);
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  hairTexCache.set(color, t);
  return t;
}

function stubbleTexture(color: string) {
  return canvas(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = color;
      g.globalAlpha = 0.35 + Math.random() * 0.4;
      g.fillRect(Math.random() * 128, Math.random() * 128, 1.4, 1.4);
    }
  });
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.42;
    const ang = (i * Math.PI) / 5 - Math.PI / 2;
    g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  g.closePath();
  g.fill();
}

/** Retro-Trikots in klassischen Farben (ohne Vereinswappen/Logos) */
export const KITS: Record<
  string,
  {
    label: string;
    pattern: 'plain' | 'split' | 'stripes';
    colors: (own: string) => [string, string];
    sleeves: (own: string) => [string, string];
    trim: string;
    accent: string;
    number: string;
    numberStroke: string;
    crescent?: boolean;
  }
> = {
  aYildiz: {
    label: 'Ay-Yıldız · Rot mit Halbmond',
    pattern: 'plain',
    colors: () => ['#c8102e', '#c8102e'],
    sleeves: () => ['#c8102e', '#c8102e'],
    trim: '#ffffff',
    accent: '#ffffff',
    number: '#ffffff',
    numberStroke: '#7a0a1c',
    crescent: true,
  },
  sariKirmizi: {
    label: 'Sarı-Kırmızı · Gelb-Rot geteilt',
    pattern: 'split',
    colors: () => ['#f2b705', '#a6192e'],
    sleeves: () => ['#f2b705', '#a6192e'],
    trim: '#a6192e',
    accent: '#f2b705',
    number: '#ffffff',
    numberStroke: '#6a0f1c',
  },
  sariLacivert: {
    label: 'Sarı-Lacivert · Gelb-Blau gestreift',
    pattern: 'stripes',
    colors: () => ['#002d72', '#f4d000'],
    sleeves: () => ['#002d72', '#002d72'],
    trim: '#f4d000',
    accent: '#f4d000',
    number: '#f4d000',
    numberStroke: '#001a44',
  },
  siyahBeyaz: {
    label: 'Siyah-Beyaz · Schwarz-Weiß gestreift',
    pattern: 'stripes',
    colors: () => ['#111111', '#f4f4f4'],
    sleeves: () => ['#111111', '#111111'],
    trim: '#f4f4f4',
    accent: '#f4f4f4',
    number: '#f4f4f4',
    numberStroke: '#000000',
  },
  duz: {
    label: 'Düz · Eigene Farbe',
    pattern: 'plain',
    colors: (own) => [own, own],
    sleeves: (own) => [own, own],
    trim: '#ffffff',
    accent: '#ffffff',
    number: '#ffffff',
    numberStroke: '#00000088',
  },
};

/**
 * Kleidung als Textur für den Oberkörper (Capsule). Durch offset.x = 0.5 liegt die
 * Vorderseite in der Bildmitte (x = 256), die Rückseite am Rand.
 * v: 0 = unten, 1 = oben. Brust ≈ v 0.55–0.85 → y ≈ 75–230.
 */
function clothTexture(a: Avatar): THREE.Texture {
  const col = a.shirtColor;
  const t = canvas(512, 512, (g) => {
    g.fillStyle = col;
    g.fillRect(0, 0, 512, 512);
    // feine Stoffstruktur
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const cx = 256;
    const dark = shade(col, 0.6);
    const light = shade(col, 1.35);
    switch (a.shirt) {
      case 'gomlek': {
        // Knopfleiste, Knöpfe, Kragen, Brusttasche
        g.fillStyle = shade(col, 0.9);
        g.fillRect(cx - 9, 70, 18, 330);
        g.strokeStyle = dark;
        g.lineWidth = 2;
        g.strokeRect(cx - 9, 70, 18, 330);
        g.fillStyle = '#f2ede2';
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          g.arc(cx, 100 + i * 50, 5, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = light;
        g.beginPath();
        g.moveTo(cx - 70, 60);
        g.lineTo(cx - 6, 72);
        g.lineTo(cx - 40, 110);
        g.closePath();
        g.moveTo(cx + 70, 60);
        g.lineTo(cx + 6, 72);
        g.lineTo(cx + 40, 110);
        g.closePath();
        g.fill();
        g.strokeStyle = dark;
        g.strokeRect(cx + 40, 140, 44, 46);
        break;
      }
      case 'takim': {
        // Hemd-V, Krawatte, Revers, Knöpfe
        g.fillStyle = '#f4f1ea';
        g.beginPath();
        g.moveTo(cx - 62, 55);
        g.lineTo(cx + 62, 55);
        g.lineTo(cx, 250);
        g.closePath();
        g.fill();
        g.fillStyle = '#8b1d1d';
        g.beginPath();
        g.moveTo(cx - 10, 70);
        g.lineTo(cx + 10, 70);
        g.lineTo(cx + 14, 210);
        g.lineTo(cx, 235);
        g.lineTo(cx - 14, 210);
        g.closePath();
        g.fill();
        g.strokeStyle = dark;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(cx - 62, 55);
        g.lineTo(cx - 20, 250);
        g.moveTo(cx + 62, 55);
        g.lineTo(cx + 20, 250);
        g.stroke();
        g.fillStyle = dark;
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.arc(cx, 290 + i * 50, 7, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeRect(cx - 120, 300, 60, 6);
        g.strokeRect(cx + 60, 300, 60, 6);
        break;
      }
      case 'esofman': {
        // Reißverschluss, Seitenstreifen, Kragenbund
        g.fillStyle = '#ffffff';
        for (const x of [cx - 128, cx + 128]) {
          g.fillRect(x - 14, 0, 8, 512);
          g.fillRect(x + 6, 0, 8, 512);
        }
        g.strokeStyle = '#d8d8d8';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(cx, 60);
        g.lineTo(cx, 470);
        g.stroke();
        g.fillStyle = dark;
        g.fillRect(0, 48, 512, 22);
        g.fillStyle = '#e8e8e8';
        g.fillRect(cx - 4, 70, 8, 16);
        break;
      }
      case 'trikot': {
        const kit = KITS[a.kit ?? 'duz'] ?? KITS.duz;
        const [c1, c2] = kit.colors(col);
        // Grundmuster
        if (kit.pattern === 'split') {
          // parçalı: eine Körperhälfte je Farbe (Vorne-Mitte = x 256, Rücken = Rand)
          g.fillStyle = c1;
          g.fillRect(0, 0, 256, 512);
          g.fillStyle = c2;
          g.fillRect(256, 0, 256, 512);
        } else if (kit.pattern === 'stripes') {
          g.fillStyle = c1;
          g.fillRect(0, 0, 512, 512);
          g.fillStyle = c2;
          for (let x = 0; x < 512; x += 64) g.fillRect(x + 16, 0, 32, 512);
        } else {
          g.fillStyle = c1;
          g.fillRect(0, 0, 512, 512);
        }
        // Stoffstruktur
        for (let i = 0; i < 2500; i++) {
          g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
          g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
        }
        // Retro-Polokragen + Knopfleiste
        g.fillStyle = kit.trim;
        g.fillRect(0, 40, 512, 22);
        g.beginPath();
        g.moveTo(cx - 60, 50);
        g.lineTo(cx - 8, 64);
        g.lineTo(cx - 40, 112);
        g.closePath();
        g.moveTo(cx + 60, 50);
        g.lineTo(cx + 8, 64);
        g.lineTo(cx + 40, 112);
        g.closePath();
        g.fill();
        g.fillRect(cx - 7, 60, 14, 80);
        g.fillStyle = kit.accent;
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.arc(cx, 88 + i * 30, 4, 0, Math.PI * 2);
          g.fill();
        }
        // Bündchen unten
        g.fillStyle = kit.trim;
        g.fillRect(0, 440, 512, 14);
        // Brust: Halbmond+Stern (Ay-Yıldız) oder schlichter Stern
        const bx = cx + 62;
        const by = 165;
        if (kit.crescent) {
          g.fillStyle = kit.accent;
          g.beginPath();
          g.arc(bx, by, 22, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = c1;
          g.beginPath();
          g.arc(bx + 6, by, 18, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = kit.accent;
          star(g, bx + 26, by, 9);
        } else {
          g.fillStyle = kit.accent;
          star(g, bx, by, 16);
        }
        // Rückennummer (Retro-Schrift mit Rand)
        g.font = 'bold 150px Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 8;
        g.strokeStyle = kit.numberStroke;
        g.fillStyle = kit.number;
        for (const x of [0, 512]) {
          g.strokeText('10', x, 250);
          g.fillText('10', x, 250);
        }
        break;
      }
      case 'elbise': {
        // Blumenkleid: kleine Streublumen, runder Ausschnitt, Gürtel
        const petals = [shade(col, 1.6), '#f6efe0', shade(col, 0.55)];
        for (let i = 0; i < 160; i++) {
          const x = Math.random() * 512;
          const y = Math.random() * 512;
          const r = 4 + Math.random() * 5;
          g.fillStyle = petals[i % 3];
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            g.beginPath();
            g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.6, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = '#e8b93a';
          g.beginPath();
          g.arc(x, y, r * 0.45, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = dark;
        g.beginPath();
        g.ellipse(cx, 40, 58, 40, 0, 0, Math.PI);
        g.fill();
        g.fillStyle = shade(col, 0.5);
        g.fillRect(0, 300, 512, 18);
        break;
      }
      case 'bluz': {
        // Bluse: Rüschenkragen, kleine Perlmuttknöpfe, feine Längsfalten
        g.strokeStyle = shade(col, 0.88);
        g.lineWidth = 2;
        for (let x = cx - 90; x <= cx + 90; x += 14) {
          g.beginPath();
          g.moveTo(x, 90);
          g.lineTo(x, 260);
          g.stroke();
        }
        g.fillStyle = light;
        for (let i = 0; i < 14; i++) {
          const x = cx - 78 + i * 12;
          g.beginPath();
          g.arc(x, 62 + Math.abs(i - 6.5) * 2, 9, 0, Math.PI);
          g.fill();
        }
        g.fillStyle = '#f7f2ea';
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          g.arc(cx, 95 + i * 42, 4.5, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'yelek': {
        // Weste über weißem Hemd
        g.fillStyle = '#efe9dc';
        g.fillRect(cx - 70, 0, 140, 512);
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(cx - 70, 40);
        g.lineTo(cx - 8, 230);
        g.lineTo(cx - 8, 512);
        g.lineTo(cx - 70, 512);
        g.closePath();
        g.moveTo(cx + 70, 40);
        g.lineTo(cx + 8, 230);
        g.lineTo(cx + 8, 512);
        g.lineTo(cx + 70, 512);
        g.closePath();
        g.fill();
        g.strokeStyle = shade(col, 1.6);
        g.lineWidth = 3;
        g.stroke();
        g.fillStyle = '#c9a04a';
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.arc(cx - 16, 260 + i * 45, 5, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'hirka': {
        // Strickjacke: Rippenmuster, offenes Hemd innen, Knöpfe
        g.strokeStyle = shade(col, 0.82);
        g.lineWidth = 3;
        for (let x = 0; x < 512; x += 9) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, 512);
          g.stroke();
        }
        g.fillStyle = '#ece4d2';
        g.beginPath();
        g.moveTo(cx - 40, 55);
        g.lineTo(cx + 40, 55);
        g.lineTo(cx + 16, 460);
        g.lineTo(cx - 16, 460);
        g.closePath();
        g.fill();
        g.fillStyle = shade(col, 0.75);
        g.fillRect(cx - 24, 55, 8, 410);
        g.fillRect(cx + 16, 55, 8, 410);
        g.fillStyle = '#3b2a1a';
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          g.arc(cx - 32, 140 + i * 65, 6, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.offset.x = 0.5;
  return t;
}

/** Kopftuch-Stoff: einfarbig mit Rand, Yazma mit Muster oder weißer Tülbent */
function scarfTexture(kind: string, col: string): THREE.Texture {
  return canvas(256, 256, (g) => {
    const base = kind === 'tulbent' ? '#f7f4ec' : col;
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
    }
    if (kind === 'esarp') {
      // Paisley/Yazma-Muster
      const c2 = shade(col, 1.7);
      const c3 = shade(col, 0.5);
      for (let y = 10; y < 256; y += 42) {
        for (let x = (y / 42) % 2 ? 20 : 0; x < 256; x += 42) {
          g.fillStyle = c2;
          g.beginPath();
          g.ellipse(x, y, 11, 7, 0.6, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = c3;
          g.beginPath();
          g.arc(x + 3, y - 1, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.fillStyle = '#d9b44a';
      g.fillRect(0, 0, 256, 6);
    } else if (kind === 'tulbent') {
      g.strokeStyle = 'rgba(0,0,0,0.06)';
      for (let i = 0; i < 256; i += 6) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 256);
        g.stroke();
      }
    } else {
      g.fillStyle = shade(col, 0.75);
      g.fillRect(0, 0, 256, 8);
    }
  });
}

// ------------------------------------------------------------------ Hilfen

function nameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 56px Inter, sans-serif';
  const w = Math.min(500, g.measureText(name).width + 50);
  g.fillStyle = 'rgba(20,12,8,0.72)';
  g.beginPath();
  g.roundRect((512 - w) / 2, 22, w, 84, 40);
  g.fill();
  g.fillStyle = '#ffe9c4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.7, 0.175, 1);
  s.renderOrder = 10;
  return s;
}

function bubbleSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.font = 'bold 54px Inter, sans-serif';
  const w = Math.min(740, g.measureText(text).width + 70);
  g.fillStyle = '#fffaf0';
  g.strokeStyle = '#3b2a1e';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect((768 - w) / 2, 20, w, 120, 50);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(370, 138);
  g.lineTo(384, 180);
  g.lineTo(404, 138);
  g.fill();
  g.fillStyle = '#2a1d14';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 384, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.2, 0.3, 1);
  s.renderOrder = 11;
  return s;
}

/** Kugelschale (für Haare, Mützen, Bart) */
function shell(r: number, thetaStart: number, thetaLen: number, m: THREE.Material, seg = 32) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2), 0, Math.PI * 2, thetaStart, thetaLen), m);
}

function tube(points: [number, number, number][], radius: number, m: THREE.Material, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius, 8, closed), m);
}

const smooth = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
/** 0 → 1 → 0 mit Ein-/Ausblenden: steigt bis a, hält bis b, fällt bis 1 */
const envelope = (p: number, a: number, b: number) => (p < a ? smooth(p / a) : p < b ? 1 : 1 - smooth((p - b) / (1 - b)));

// ------------------------------------------------------------------ Skelett-Maße

const SHOULDER_Y = 0.64;
const SHOULDER_X = 0.235;
const UPPER = 0.29;
const FORE = 0.27;
const HEAD_Y = 0.9;
/** Mund relativ zum Root */
const MOUTH = new THREE.Vector3(0, HEAD_Y - 0.1, 0.2);

interface Pose {
  ax: number;
  az: number;
  fx: number;
}
const REST: Pose = { ax: -0.38, az: 0, fx: 0.05 };

/** Vorwärtskinematik: Handposition (Root-Raum) für einen Arm */
function fk(side: number, p: Pose): THREE.Vector3 {
  // Hand im Arm-Raum (Unterarm zeigt bei fx=0 nach vorn)
  const v = new THREE.Vector3(0, -UPPER - FORE * Math.sin(p.fx), FORE * Math.cos(p.fx));
  v.applyEuler(new THREE.Euler(p.ax, 0, p.az, 'XYZ'));
  return v.add(new THREE.Vector3(SHOULDER_X * side, SHOULDER_Y, 0));
}

/** Einfaches numerisches IK: Arm-Winkel finden, damit die Hand am Ziel ist */
function solveIK(side: number, target: THREE.Vector3, start: Pose = REST): Pose {
  const p = { ...start };
  let err = fk(side, p).distanceTo(target);
  let step = 0.3;
  for (let it = 0; it < 120 && err > 0.004; it++) {
    let improved = false;
    for (const k of ['ax', 'az', 'fx'] as const) {
      for (const d of [step, -step]) {
        const q = { ...p, [k]: p[k] + d };
        q.fx = Math.max(-1.9, Math.min(0.3, q.fx));
        q.az = Math.max(-1.2, Math.min(1.2, q.az));
        const e = fk(side, q).distanceTo(target);
        if (e < err) {
          Object.assign(p, q);
          err = e;
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.5;
  }
  return p;
}

// Vorberechnete Posen (für alle Avatare gleich)
const POSE_MOUTH_R = solveIK(1, new THREE.Vector3(0.05, MOUTH.y - 0.06, MOUTH.z + 0.1));
const POSE_HOSE_R = solveIK(1, new THREE.Vector3(0.03, MOUTH.y - 0.02, MOUTH.z + 0.08));
const POSE_UP_R = { ax: -1.6, az: 0.05, fx: -0.2 };
const POSE_TESPIH_L = solveIK(-1, new THREE.Vector3(-0.12, 0.55, 0.32));
const POSE_RUB_L = solveIK(-1, new THREE.Vector3(-0.03, 0.58, 0.3));
const POSE_RUB_R = solveIK(1, new THREE.Vector3(0.03, 0.58, 0.3));

type Anim = { key: string; t: number; dur: number; fired?: boolean };

// ------------------------------------------------------------------ Avatar

export class Avatar3D {
  root = new THREE.Group();
  /** realistische Figur (falls gewählt) – folgt den Bewegungen dieses Avatars */
  real: RealBody | null = null;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private skull = new THREE.Group();
  private arms: { g: THREE.Group; fore: THREE.Group; side: number; pose: Pose }[] = [];
  private eyes: THREE.Group[] = [];
  private lids: THREE.Mesh[] = [];
  private tespih: THREE.Group | null = null;
  private teaGlass: THREE.Group;
  private hose: THREE.Group;
  private cigarTip: THREE.Mesh | null = null;
  private name: THREE.Sprite;
  private bubble: THREE.Sprite | null = null;
  private bubbleT = 0;
  private anim: Anim | null = null;
  private eyeAnim: Anim | null = null;
  private time = Math.random() * 10;
  private blinkIn = 2 + Math.random() * 3;
  private headRot = new THREE.Euler();
  private lookYaw = 0;
  private steamT = 0;
  /** Rauch-Callback: Position + Richtung */
  onSmoke: ((pos: THREE.Vector3, dir?: THREE.Vector3, amount?: number) => void) | null = null;
  onSlam: (() => void) | null = null;

  private legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private standing = false;
  private walkPhase = 0;
  private walkSpeed = 0;

  constructor(public spec: Avatar, displayName: string, opts: { showName?: boolean; standing?: boolean } = {}) {
    const a = spec;
    const skin = mat(a.skin, 0.65);
    const cloth = mat('#ffffff', 0.85, { map: clothTexture(a) });
    const sleeve = mat(a.shirtColor, 0.85);
    const kitDef = a.shirt === 'trikot' ? KITS[a.kit ?? 'duz'] ?? KITS.duz : null;
    const sleeveFor = (side: number) => (kitDef ? mat(kitDef.sleeves(a.shirtColor)[side === 1 ? 1 : 0], 0.85) : sleeve);
    const hairM = mat(a.hairColor, a.hair === 'slick' ? 0.3 : 0.75, { map: hairTexture(a.hairColor) });
    this.root.add(this.body);
    const fem = a.body === 'f';
    const scarfOn = !!a.scarf && a.scarf !== 'none';
    const mk = a.makeup ?? 'none';

    // ---------- Oberkörper
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 8, 24), cloth);
    torso.scale.set(fem ? 1.06 : 1.15, 1, fem ? 0.82 : 0.8);
    torso.position.y = 0.42;
    torso.castShadow = true;
    this.body.add(torso);
    this.standing = !!opts.standing;
    // ---------- Beine: sitzend (Oberschenkel nach vorn) oder stehend
    {
      const skirted = fem || a.shirt === 'elbise';
      const pantsCol = a.shirt === 'takim' ? shade(a.shirtColor, 0.9) : a.shirt === 'esofman' ? a.shirtColor : '#3a342e';
      const pants = mat(pantsCol, 0.9);
      const stock = mat(shade(a.skin, 0.75), 0.7);
      const skirtLeg = mat(a.shirt === 'elbise' ? a.shirtColor : shade(a.shirtColor, 0.55), 1);
      const shoe = mat('#1d1712', 0.45);
      for (const side of [-1, 1]) {
        const hip = new THREE.Group();
        hip.position.set(0.1 * side, 0.08, 0.0);
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(skirted && !this.standing ? 0.085 : 0.075, 0.32, 6, 12), skirted && !this.standing ? skirtLeg : skirted ? stock : pants);
        thigh.position.y = -0.2;
        thigh.castShadow = true;
        hip.add(thigh);
        const knee = new THREE.Group();
        knee.position.y = -0.41;
        const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.32, 6, 12), skirted ? stock : pants);
        shin.position.y = -0.2;
        shin.castShadow = true;
        knee.add(shin);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), shoe);
        foot.position.set(0, -0.43, 0.05);
        knee.add(foot);
        hip.add(knee);
        this.body.add(hip);
        this.legs.push({ hip, knee });
      }
      this.poseLegs(0);
    }

    // Rock / Kleid-Saum (Teyze oder Elbise)
    if (fem || a.shirt === 'elbise') {
      const skirtM = a.shirt === 'elbise' ? cloth : mat(shade(a.shirtColor, 0.55), 1);
      const skirt = new THREE.Mesh(
        new THREE.LatheGeometry(
          ([
            new THREE.Vector2(0.205, 0.36),
            new THREE.Vector2(0.222, 0.2),
            new THREE.Vector2(0.245, 0.0),
            ...(this.standing
              ? [new THREE.Vector2(0.275, -0.2), new THREE.Vector2(0.31, -0.42), new THREE.Vector2(0.3, -0.44)]
              : [new THREE.Vector2(0.26, -0.03), new THREE.Vector2(0.25, -0.05)]),
          ] as THREE.Vector2[]).reverse(),
          28,
        ),
        skirtM,
      );
      skirt.scale.set(1.05, 1, 0.95);
      skirt.position.z = 0.02;
      skirt.castShadow = true;
      this.body.add(skirt);
    }
    // Schultern weich
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), sleeveFor(s));
      sh.position.set(SHOULDER_X * s, SHOULDER_Y - 0.01, 0);
      this.body.add(sh);
    }
    // Hals
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.14, 16), skin);
    neck.position.y = 0.74;
    this.body.add(neck);
    // Kette
    if (a.jewelry === 'chain') {
      const gold = mat('#d9b44a', 0.25, { metalness: 0.9 });
      this.body.add(
        tube(
          [
            [-0.075, 0.76, -0.01],
            [-0.08, 0.7, 0.07],
            [-0.04, 0.655, 0.135],
            [0, 0.645, 0.15],
            [0.04, 0.655, 0.135],
            [0.08, 0.7, 0.07],
            [0.075, 0.76, -0.01],
          ],
          0.006,
          gold,
        ),
      );
      const pend = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20), gold);
      pend.rotation.x = Math.PI / 2 - 0.35;
      pend.position.set(0, 0.618, 0.155);
      this.body.add(pend);
    }

    // ---------- Kopf
    this.head.position.y = HEAD_Y;
    this.body.add(this.head);
    this.head.add(this.skull);
    const fs = a.face === 'long' ? [0.92, 1.12, 0.96] : a.face === 'square' ? [1.06, 0.98, 1] : [1, 1, 1];
    this.skull.scale.set(fs[0] * (fem ? 0.95 : 1), fs[1], fs[2]);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 24), skin);
    headMesh.castShadow = true;
    this.skull.add(headMesh);
    if (a.face === 'square') {
      const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 16), skin);
      jaw.scale.set(1.08, 0.62, 0.98);
      jaw.position.set(0, -0.075, 0.0);
      this.skull.add(jaw);
    }
    // Ohren
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skin);
      ear.scale.set(0.45, 1, 0.75);
      ear.position.set(0.195 * s, -0.01, 0);
      this.skull.add(ear);
    }
    // Augen mit Lidern
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), mat('#ffffff', 0.25));
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 10), mat('#3b2412', 0.3));
      iris.position.z = 0.025;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), mat('#050505', 0.2));
      pupil.position.z = 0.04;
      eye.add(white, iris, pupil);
      eye.position.set(0.07 * s, 0.03, 0.163);
      this.skull.add(eye);
      this.eyes.push(eye);
      const lidM = mk === 'full' ? mat('#8a5a7a', 0.5) : mk === 'light' ? mat(shade(a.skin, 0.85), 0.5) : skin;
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.039, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), lidM);
      lid.position.copy(eye.position);
      lid.rotation.x = -1.2; // offen
      this.skull.add(lid);
      this.lids.push(lid);
    }
    // Wimpern / Lidstrich
    if (fem || mk !== 'none') {
      const lashM = mat('#151010', 0.6);
      for (const s of [-1, 1]) {
        this.skull.add(
          tube(
            [
              [0.038 * s, 0.05, 0.19],
              [0.07 * s, 0.062, 0.197],
              [0.108 * s, 0.052, 0.178],
              [0.118 * s, 0.06, 0.17],
            ],
            mk === 'full' ? 0.0045 : 0.003,
            lashM,
          ),
        );
      }
    }
    // Rouge
    if (mk !== 'none') {
      const blushM = new THREE.MeshBasicMaterial({ color: '#e06a6a', transparent: true, opacity: mk === 'full' ? 0.35 : 0.2, depthWrite: false });
      for (const s of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), blushM);
        b.position.set(0.105 * s, -0.035, 0.17);
        b.lookAt(new THREE.Vector3(0.105 * s * 3, -0.035 * 3, 0.17 * 3));
        this.skull.add(b);
      }
    }
    // Augenbrauen (gebogen)
    const browR = a.eyebrows === 'thick' ? 0.011 : 0.006;
    for (const s of [-1, 1]) {
      const b = tube(
        [
          [0.035 * s, 0.085, 0.188],
          [0.07 * s, 0.098, 0.185],
          [0.105 * s, 0.088, 0.165],
        ],
        browR,
        mat(a.hairColor, 0.8),
      );
      this.skull.add(b);
    }
    // Nase
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), skin);
    nose.scale.set(fem ? 0.7 : 0.85, fem ? 0.85 : 1, fem ? 1.0 : 1.15);
    nose.position.set(0, -0.025, 0.205);
    this.skull.add(nose);
    // Mund
    const mouth = tube(
      [
        [-0.035, -0.095, 0.183],
        [0, -0.105, 0.19],
        [0.035, -0.095, 0.183],
      ],
      mk !== 'none' ? (mk === 'full' ? 0.011 : 0.008) : 0.006,
      mat(mk !== 'none' ? a.lipColor ?? '#b8434e' : fem ? '#a5524a' : '#7a2a20', mk === 'full' ? 0.25 : 0.6),
    );
    this.skull.add(mouth);

    // Bart
    if (a.beard !== 'none') {
      const stubble = a.beard === 'stubble';
      const bm = stubble
        ? new THREE.MeshStandardMaterial({ map: stubbleTexture(a.hairColor), transparent: true, depthWrite: false, roughness: 1 })
        : hairM;
      const beard = shell(0.203, Math.PI * 0.52, Math.PI * 0.4, bm);
      beard.rotation.x = 0.25;
      beard.scale.set(1.01, stubble ? 1 : 1.06, stubble ? 1.01 : 1.05);
      this.skull.add(beard);
      if (!stubble) {
        const chin = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), hairM);
        chin.scale.set(1.3, 1, 0.9);
        chin.position.set(0, -0.17, 0.12);
        this.skull.add(chin);
      }
    }
    // Schnurrbart
    if (a.mustache !== 'none') {
      const thick = a.mustache === 'thick';
      const pts: [number, number, number][] = thick
        ? [
            [-0.075, -0.115, 0.165],
            [-0.06, -0.075, 0.19],
            [-0.025, -0.062, 0.205],
            [0, -0.065, 0.208],
            [0.025, -0.062, 0.205],
            [0.06, -0.075, 0.19],
            [0.075, -0.115, 0.165],
          ]
        : [
            [-0.05, -0.08, 0.19],
            [-0.022, -0.066, 0.205],
            [0, -0.068, 0.208],
            [0.022, -0.066, 0.205],
            [0.05, -0.08, 0.19],
          ];
      this.skull.add(tube(pts, thick ? 0.017 : 0.01, mat(a.hairColor, 0.75)));
    }

    // Haare
    const hatOn = a.hat !== 'none' && !scarfOn;
    const hr = hatOn ? 0.205 : 0.212;
    if (a.hair !== 'none' && !scarfOn) {
      const capLen = a.hair === 'long' || a.hair === 'wavy' ? 1.45 : a.hair === 'slick' ? 1.12 : a.hair === 'bun' ? 1.3 : 1.22;
      const cap = shell(hr, 0, capLen, hairM);
      cap.rotation.x = -0.5;
      cap.castShadow = true;
      this.skull.add(cap);
      if (a.hair === 'slick' && !hatOn) {
        const pomp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), hairM);
        pomp.scale.set(1.25, 0.55, 0.9);
        pomp.position.set(0.02, 0.19, 0.06);
        this.skull.add(pomp);
        const part = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, 0.16), mat(shade(a.hairColor, 0.5)));
        part.position.set(-0.07, 0.2, 0.01);
        part.rotation.z = 0.35;
        this.skull.add(part);
      }
      if (a.hair === 'curly') {
        // Locken auf der Kappe verteilt (Fibonacci)
        const n = hatOn ? 18 : 46;
        for (let i = 0; i < n; i++) {
          const y = 1 - (i / (n - 1)) * 1.05;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const th = i * 2.399;
          const p = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
          p.applyEuler(new THREE.Euler(-0.5, 0, 0));
          if (hatOn && p.y > 0.15) continue;
          if (p.z > 0.55 && p.y < 0.75) continue; // Stirn frei
          const c = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), hairM);
          c.position.copy(p.multiplyScalar(hr + 0.012));
          this.skull.add(c);
        }
      }
      if (a.hair === 'bun' && !hatOn) {
        // Topuz: Dutt hinten oben, Haar glatt zurück
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 14), hairM);
        bun.position.set(0, 0.13, -0.17);
        this.skull.add(bun);
        const tie = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 8, 20), mat('#8e1b1b', 0.6));
        tie.position.set(0, 0.105, -0.13);
        tie.rotation.x = 0.9;
        this.skull.add(tie);
      }
      if (a.hair === 'wavy') {
        // Wellen bis auf die Schultern
        for (const sx of [-1, 0, 1]) {
          for (let k = 0; k < 4; k++) {
            const w = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), hairM);
            w.position.set(sx * 0.13 + Math.sin(k * 1.7) * 0.015, -0.03 - k * 0.07, sx === 0 ? -0.15 : -0.07 + Math.abs(sx) * 0.0);
            w.scale.set(1.15, 1, 0.8);
            this.skull.add(w);
          }
        }
      }
      if (a.hair === 'long') {
        const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.18, 6, 16), hairM);
        back.scale.set(1.3, 1, 0.55);
        back.position.set(0, -0.12, -0.11);
        this.skull.add(back);
      }
    }

    // Kopftuch (ersetzt Haare und Mütze)
    if (scarfOn) this.buildScarf(a.scarf!, a.scarfColor ?? '#2f4f6f');

    // Kopfbedeckung
    if (!hatOn) {
      // nichts
    } else if (a.hat === 'kasket') {
      const capM = mat('#5b4a3a', 0.9, { map: hairTexture('#5b4a3a') });
      const crown = shell(0.222, 0, 1.12, capM);
      crown.rotation.x = -0.32;
      crown.scale.set(1.04, 0.9, 1.08);
      crown.position.set(0, 0.012, 0.005);
      this.skull.add(crown);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 10), capM);
      top.scale.set(1.08, 0.32, 1.18);
      top.position.set(0, 0.16, 0.035);
      this.skull.add(top);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.012, 24, 1, false, -Math.PI / 2, Math.PI), mat('#4a3a2a', 0.8));
      brim.position.set(0, 0.125, 0.15);
      brim.rotation.x = 0.18;
      this.skull.add(brim);
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), capM);
      btn.position.set(0, 0.215, 0.05);
      this.skull.add(btn);
    } else if (a.hat === 'takke') {
      const tm = mat('#f5f1e6', 0.9, {
        map: canvas(128, 128, (g) => {
          g.fillStyle = '#f5f1e6';
          g.fillRect(0, 0, 128, 128);
          g.strokeStyle = '#dcd4c0';
          for (let i = 0; i < 128; i += 8) {
            g.beginPath();
            g.arc(64, 64, i, 0, Math.PI * 2);
            g.stroke();
          }
        }),
      });
      const tk = shell(0.214, 0, 0.78, tm);
      tk.rotation.x = -0.35;
      this.skull.add(tk);
    } else if (a.hat === 'bere') {
      const bm = mat('#2a3550', 0.95, { map: hairTexture('#2a3550') });
      const b = shell(0.222, 0, 1.22, bm);
      b.rotation.x = -0.42;
      b.scale.set(1.02, 1.08, 1.02);
      this.skull.add(b);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.022, 10, 40), mat('#243049', 0.95));
      band.rotation.x = Math.PI / 2 - 0.42;
      band.position.set(0, 0.075, -0.035);
      this.skull.add(band);
    }

    // Brille
    if (a.glasses !== 'none') {
      const sun = a.glasses === 'sun';
      const frame = mat(sun ? '#151515' : '#b08a3a', 0.3, { metalness: sun ? 0.2 : 0.8 });
      const lens = new THREE.MeshStandardMaterial({ color: sun ? '#101010' : '#dfeaf0', transparent: true, opacity: sun ? 0.85 : 0.18, roughness: 0.05 });
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.0055, 8, 24), frame);
        ring.position.set(0.07 * s, 0.03, 0.205);
        this.skull.add(ring);
        const l = new THREE.Mesh(new THREE.CircleGeometry(0.041, 24), lens);
        l.position.set(0.07 * s, 0.03, 0.204);
        this.skull.add(l);
        this.skull.add(
          tube(
            [
              [0.11 * s, 0.035, 0.2],
              [0.19 * s, 0.035, 0.11],
              [0.2 * s, 0.025, 0.0],
            ],
            0.004,
            frame,
          ),
        );
      }
      this.skull.add(
        tube(
          [
            [-0.028, 0.035, 0.208],
            [0, 0.045, 0.215],
            [0.028, 0.035, 0.208],
          ],
          0.004,
          frame,
        ),
      );
    }

    // Ohrringe
    if (a.jewelry === 'earrings') {
      const gold = mat('#d9b44a', 0.25, { metalness: 0.9 });
      for (const s of [-1, 1]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 8, 18), gold);
        hoop.position.set(0.2 * s, -0.07, 0.01);
        hoop.rotation.y = Math.PI / 2;
        this.skull.add(hoop);
      }
    }

    // Zubehör im Mund
    if (a.accessory === 'cigar') {
      const cg = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.11, 12), mat('#5a3a20', 0.8));
      c.rotation.x = Math.PI / 2;
      c.position.z = 0.055;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.012, 12), mat('#c9a04a', 0.4));
      band.rotation.x = Math.PI / 2;
      band.position.z = 0.02;
      this.cigarTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }));
      this.cigarTip.position.z = 0.11;
      cg.add(c, band, this.cigarTip);
      cg.position.set(0.04, -0.1, 0.18);
      cg.rotation.set(0.25, 0.35, 0);
      this.skull.add(cg);
    } else if (a.accessory === 'toothpick') {
      const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.075, 6), mat('#e6cf9a', 0.7));
      tp.rotation.set(Math.PI / 2, 0, 0);
      tp.rotation.z = 0.5;
      tp.position.set(0.045, -0.1, 0.215);
      this.skull.add(tp);
    }

    // ---------- Arme
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(SHOULDER_X * side, SHOULDER_Y, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, UPPER - 0.08, 6, 14), sleeveFor(side));
      upper.position.y = -UPPER / 2;
      upper.castShadow = true;
      g.add(upper);
      const fore = new THREE.Group();
      fore.position.y = -UPPER;
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), sleeveFor(side));
      fore.add(elbow);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.054, FORE - 0.09, 6, 14), sleeveFor(side));
      lower.rotation.x = Math.PI / 2;
      lower.position.z = FORE / 2 - 0.02;
      fore.add(lower);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 14), mat('#f0ece2'));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.z = FORE - 0.04;
      if (a.shirt === 'takim' || a.shirt === 'gomlek') fore.add(cuff);
      if (kitDef) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.025, 14), mat(kitDef.trim, 0.8));
        band.rotation.x = Math.PI / 2;
        band.position.z = FORE - 0.06;
        fore.add(band);
      }
      // Hand mit Daumen
      const hand = new THREE.Group();
      hand.position.z = FORE;
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 12), skin);
      palm.scale.set(1, 0.75, 1.15);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), skin);
      thumb.position.set(-0.04 * side, 0.01, 0.01);
      thumb.rotation.z = 0.8 * side;
      hand.add(palm, thumb);
      fore.add(hand);
      if (side === 1 && a.jewelry === 'ring') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 16), mat('#d9b44a', 0.25, { metalness: 0.9 }));
        ring.position.set(0.02, 0, 0.04);
        ring.rotation.y = Math.PI / 2;
        hand.add(ring);
      }
      if (a.jewelry === 'bilezik') {
        // Altın bilezik: mehrere Goldreifen am Handgelenk
        const gold = mat('#e0b84a', 0.2, { metalness: 0.95 });
        for (let i = 0; i < 3; i++) {
          const b = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.006, 8, 22), gold);
          b.position.z = FORE - 0.035 - i * 0.016;
          fore.add(b);
        }
      }
      if (side === -1 && a.jewelry === 'watch') {
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.011, 8, 20), mat('#3a2a1a', 0.6));
        strap.position.z = FORE - 0.06;
        fore.add(strap);
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 16), mat('#c0c0c0', 0.2, { metalness: 0.9 }));
        face.position.set(0, 0.06, FORE - 0.06);
        fore.add(face);
      }
      if (side === -1 && a.accessory === 'tespih') {
        // Tespih hängt sichtbar aus der linken Hand
        const tg = new THREE.Group();
        const beadM = mat('#9b2a1e', 0.25, { metalness: 0.1 });
        const n = 17;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 10, 8), beadM);
          bead.position.set(Math.sin(ang) * 0.045, -0.06 - Math.cos(ang) * 0.06, 0);
          tg.add(bead);
        }
        const imame = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.035, 10), beadM);
        imame.position.set(0, -0.14, 0);
        const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 10), mat('#c9a04a', 0.6));
        tassel.position.set(0, -0.18, 0);
        tassel.rotation.x = Math.PI;
        tg.add(imame, tassel);
        tg.position.set(0, -0.02, 0.02);
        hand.add(tg);
        this.tespih = tg;
      }
      g.add(fore);
      this.body.add(g);
      this.arms.push({ g, fore, side, pose: { ...REST } });
    }

    // Teeglas (rechte Hand)
    this.teaGlass = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.018, 0),
          new THREE.Vector2(0.024, 0.02),
          new THREE.Vector2(0.018, 0.045),
          new THREE.Vector2(0.026, 0.085),
        ],
        16,
      ),
      new THREE.MeshStandardMaterial({ color: '#b5361b', transparent: true, opacity: 0.85, roughness: 0.05, side: THREE.DoubleSide }),
    );
    glass.position.y = -0.02;
    this.teaGlass.add(glass);
    this.teaGlass.position.set(0, 0.02, 0.03);
    this.teaGlass.visible = false;
    this.arms[1].fore.children[this.arms[1].fore.children.length - 1].add(this.teaGlass);

    // Nargile-Schlauch (Mundstück in rechter Hand, Schlauch nach unten)
    this.hose = new THREE.Group();
    const mouthpiece = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.09, 10), mat('#c9a04a', 0.3, { metalness: 0.8 }));
    mouthpiece.rotation.x = Math.PI / 2;
    mouthpiece.position.z = -0.03;
    this.hose.add(mouthpiece);
    this.hose.add(
      tube(
        [
          [0, 0, 0.01],
          [0.03, -0.1, 0.03],
          [0.12, -0.38, 0.06],
          [0.28, -0.8, 0.02],
        ],
        0.012,
        mat('#2f4a2a', 0.6),
      ),
    );
    this.hose.visible = false;
    this.arms[1].fore.children[this.arms[1].fore.children.length - 1].add(this.hose);

    this.name = nameSprite(displayName);
    this.name.position.y = 1.36;
    this.name.visible = opts.showName !== false;
    this.root.add(this.name);
    this.applyArm(this.arms[0], REST);
    this.applyArm(this.arms[1], REST);

    // Realistische Figur: Cartoon-Körper unsichtbar (bewegt sich aber weiter), Requisiten bleiben
    if (a.style === 'real') {
      const props = new Set<THREE.Object3D>([this.teaGlass, this.hose]);
      if (this.tespih) props.add(this.tespih);
      const isProp = (o: THREE.Object3D | null) => {
        for (let p = o; p; p = p.parent) if (props.has(p)) return true;
        return false;
      };
      this.body.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !isProp(o)) o.visible = false;
      });
      if (this.tespih) this.tespih.visible = false;
      this.real = new RealBody(a);
      this.root.add(this.real.group);
      this.name.position.y = 1.24;
    }
  }

  dispose() {
    this.real?.dispose();
  }

  /** Başörtüsü / Tülbent / Eşarp: Kopf und Hals bedeckt, Gesicht frei, Tuch fällt über die Schultern */
  private buildScarf(kind: string, color: string) {
    const tex = scarfTexture(kind, color);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    const m = mat('#ffffff', kind === 'esarp' ? 0.45 : 0.85, { map: tex, side: THREE.DoubleSide });
    const R = 0.228;
    const FOREHEAD = 0.98; // Rand über den Augenbrauen
    const CHIN = 2.38; // Rand unter dem Kinn
    const HALF = 0.6; // halbe Gesichtsbreite (Winkel)
    // Kappe oben
    const top = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 12, 0, Math.PI * 2, 0, FOREHEAD), m);
    top.castShadow = true;
    this.skull.add(top);
    // Seiten + Hinterkopf mit Gesichtsöffnung
    const sides = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 16, Math.PI / 2 + HALF, Math.PI * 2 - HALF * 2, FOREHEAD, Math.PI - 0.12 - FOREHEAD),
      m,
    );
    sides.castShadow = true;
    this.skull.add(sides);
    // unter dem Kinn
    const chin = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 6, 0, Math.PI * 2, CHIN, Math.PI - 0.12 - CHIN), m);
    this.skull.add(chin);
    if (kind === 'tulbent') {
      // Oya: kleine bunte Häkelblüten genau am Rand der Gesichtsöffnung
      const cols = ['#c0392b', '#e8b93a', '#2d7a4a', '#2f6fb0'];
      const onSphere = (phi: number, th: number) =>
        new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)).multiplyScalar(R + 0.006);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) pts.push(onSphere(Math.PI / 2 - HALF + (i / 8) * HALF * 2, FOREHEAD));
      for (let i = 1; i <= 6; i++) {
        const th = FOREHEAD + (i / 7) * (CHIN - 0.25 - FOREHEAD);
        pts.push(onSphere(Math.PI / 2 - HALF, th), onSphere(Math.PI / 2 + HALF, th));
      }
      pts.forEach((p, i) => {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 8, 6), mat(cols[i % cols.length], 0.5));
        f.position.copy(p);
        this.skull.add(f);
      });
    }
    // Knoten/Nadel unter dem Kinn
    if (kind === 'tulbent') {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), m);
      knot.scale.set(1.3, 0.8, 1);
      knot.position.set(0.05, -0.2, 0.13);
      this.skull.add(knot);
    } else {
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat('#d9b44a', 0.2, { metalness: 0.9 }));
      pin.position.set(-0.11, -0.13, 0.17);
      this.skull.add(pin);
    }
    // Tuch fällt über Hals und Schultern
    const drape = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.11, 0.86),
          new THREE.Vector2(0.13, 0.78),
          new THREE.Vector2(0.19, 0.69),
          new THREE.Vector2(0.27, 0.6),
          new THREE.Vector2(kind === 'tulbent' ? 0.29 : 0.3, kind === 'tulbent' ? 0.56 : 0.5),
        ],
        32,
      ),
      m,
    );
    drape.scale.set(1, 1, 0.82);
    drape.castShadow = true;
    this.body.add(drape);
  }

  /** Beine setzen: Sitzen (Knie 90°) oder Gehen (Schwingen) */
  private poseLegs(swing: number) {
    this.legs.forEach((l, i) => {
      if (!this.standing) {
        l.hip.rotation.x = -Math.PI / 2 + 0.08;
        l.knee.rotation.x = Math.PI / 2 - 0.05;
      } else {
        const s = Math.sin(this.walkPhase + (i ? Math.PI : 0)) * swing;
        l.hip.rotation.x = -s * 0.5;
        l.knee.rotation.x = Math.max(0, s) * 0.6;
      }
    });
  }

  /** Gehgeschwindigkeit (m/s) für die Schrittanimation */
  setWalking(speed: number) {
    this.walkSpeed = speed;
  }

  // ------------------------------------------------------------------ API

  say(text: string) {
    if (this.bubble) this.root.remove(this.bubble);
    this.bubble = bubbleSprite(text);
    this.bubble.position.y = this.real ? 1.3 : 1.58;
    this.root.add(this.bubble);
    this.bubbleT = 4;
  }

  emote(key: string) {
    const durs: Record<string, number> = { slam: 1.1, tea: 3.0, nargile: 4.2, headshake: 1.4, rubhands: 1.8, tespih: 2.6 };
    this.anim = { key, t: 0, dur: durs[key] ?? 1.4 };
  }

  eye(key: string) {
    this.eyeAnim = { key, t: 0, dur: key === 'blink' ? 1.2 : key === 'wide' ? 1.5 : 0.7 };
  }

  /** Kopf dreht sich sanft in diese Richtung (Weltwinkel relativ zur Blickrichtung) */
  lookAtYaw(yaw: number) {
    this.lookYaw = Math.max(-0.9, Math.min(0.9, yaw));
  }

  setNameVisible(v: boolean) {
    this.name.visible = v;
  }

  /** Für Tests: Animation auf Fortschritt p setzen */
  pose(key: string, p: number) {
    this.emote(key);
    this.anim!.t = this.anim!.dur * p;
    for (let i = 0; i < 60; i++) this.update(0.05, true);
  }

  private mouthWorld() {
    const v = MOUTH.clone().add(new THREE.Vector3(0, 0, 0.04));
    return this.root.localToWorld(v);
  }

  private applyArm(arm: { g: THREE.Group; fore: THREE.Group; side: number; pose: Pose }, p: Pose) {
    arm.pose = p;
    arm.g.rotation.set(p.ax, 0, p.az, 'XYZ');
    arm.fore.rotation.x = p.fx;
  }

  // ------------------------------------------------------------------ Update

  update(dt: number, frozen = false) {
    if (!frozen) this.time += dt;
    const k = 1 - Math.exp(-dt * 10); // weiches Nachziehen
    const breathe = Math.sin(this.time * 1.5);
    this.body.position.y = breathe * 0.004;
    if (this.standing) {
      this.walkPhase += dt * this.walkSpeed * 7;
      const sw = Math.min(1, this.walkSpeed * 1.2);
      this.poseLegs(sw);
      this.body.position.y += Math.abs(Math.sin(this.walkPhase)) * 0.025 * sw;
    }
    this.body.rotation.x = breathe * 0.01;

    // Zielposen
    const tL: Pose = { ...REST, fx: REST.fx + Math.sin(this.time * 0.7) * 0.03 };
    const tR: Pose = { ...REST, fx: REST.fx + Math.sin(this.time * 0.6 + 1) * 0.03 };
    const head = { x: Math.sin(this.time * 0.35) * 0.03, y: this.lookYaw + Math.sin(this.time * 0.27) * 0.08, z: 0 };
    let showGlass = false;
    let showHose = false;
    let tespihSwing = Math.sin(this.time * 2.2) * 0.25;

    const mix = (a: Pose, b: Pose, w: number): Pose => ({ ax: a.ax + (b.ax - a.ax) * w, az: a.az + (b.az - a.az) * w, fx: a.fx + (b.fx - a.fx) * w });

    if (this.anim) {
      const a = this.anim;
      if (!frozen) a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      switch (a.key) {
        case 'slam': {
          // ausholen, dann schnell runter
          const up = p < 0.45 ? smooth(p / 0.45) : p < 0.55 ? 1 - smooth((p - 0.45) / 0.1) : 0;
          Object.assign(tR, mix(REST, POSE_UP_R, up));
          head.x += up * -0.1;
          if (!a.fired && p >= 0.55) {
            a.fired = true;
            this.onSlam?.();
          }
          break;
        }
        case 'tea': {
          const w = envelope(p, 0.28, 0.72);
          showGlass = true;
          Object.assign(tR, mix(REST, POSE_MOUTH_R, w));
          head.x += -w * 0.22; // Kopf leicht nach hinten beim Trinken
          // Dampf vom Glas
          this.steamT -= dt;
          if (this.steamT <= 0 && !frozen) {
            this.steamT = 0.25;
            const pos = new THREE.Vector3();
            this.teaGlass.getWorldPosition(pos);
            pos.y += 0.07;
            this.onSmoke?.(pos, new THREE.Vector3(0, 0.25, 0), 0.4);
          }
          break;
        }
        case 'nargile': {
          // ziehen (0.15–0.5), absetzen, ausatmen (0.6–0.9)
          const w = envelope(p, 0.18, 0.5);
          showHose = p < 0.6;
          Object.assign(tR, mix(REST, POSE_HOSE_R, w));
          head.x += w * 0.08;
          if (p > 0.6 && p < 0.92) {
            head.x += -0.18 * envelope((p - 0.6) / 0.32, 0.2, 0.7);
            this.steamT -= dt;
            if (this.steamT <= 0 && !frozen) {
              this.steamT = 0.06;
              const dir = new THREE.Vector3(0, 0.22, 0.5).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
              this.onSmoke?.(this.mouthWorld(), dir, 1);
            }
          }
          break;
        }
        case 'headshake':
          head.y += Math.sin(a.t * 14) * 0.38 * envelope(p, 0.15, 0.75);
          head.x += 0.05;
          break;
        case 'rubhands': {
          const w = envelope(p, 0.2, 0.8);
          Object.assign(tL, mix(REST, POSE_RUB_L, w));
          Object.assign(tR, mix(REST, POSE_RUB_R, w));
          tL.az += Math.sin(a.t * 18) * 0.06 * w;
          tR.az -= Math.sin(a.t * 18) * 0.06 * w;
          break;
        }
        case 'tespih': {
          const w = envelope(p, 0.2, 0.8);
          Object.assign(tL, mix(REST, POSE_TESPIH_L, w));
          tespihSwing = Math.sin(a.t * 9) * 0.9 * w + tespihSwing * (1 - w);
          head.x += w * 0.15;
          head.y += -w * 0.25;
          break;
        }
      }
      if (a.t >= a.dur) this.anim = null;
    }

    // weich zu den Zielen bewegen
    const kk = frozen ? 1 : k;
    for (const arm of this.arms) {
      const tgt = arm.side === -1 ? tL : tR;
      this.applyArm(arm, mix(arm.pose, tgt, kk));
    }
    this.headRot.x += (head.x - this.headRot.x) * kk;
    this.headRot.y += (head.y - this.headRot.y) * kk;
    this.head.rotation.set(this.headRot.x, this.headRot.y, head.z);
    this.teaGlass.visible = showGlass;
    this.hose.visible = showHose;
    if (showHose && this.hose.parent) {
      // Schlauch hängt immer nach unten (unabhängig von der Handdrehung)
      const pq = this.hose.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.hose.quaternion.copy(pq.multiply(this.root.getWorldQuaternion(new THREE.Quaternion())));
    }
    if (this.tespih) this.tespih.rotation.z = tespihSwing;
    if (this.cigarTip) (this.cigarTip.material as THREE.MeshBasicMaterial).color.setHSL(0.05, 1, 0.45 + Math.sin(this.time * 2) * 0.1);

    // Augen
    let open = 1;
    let wide = 1;
    let wink = false;
    this.blinkIn -= dt;
    if (this.blinkIn < 0) {
      if (this.blinkIn > -0.13) open = 0;
      else this.blinkIn = 2 + Math.random() * 4;
    }
    if (this.eyeAnim) {
      const e = this.eyeAnim;
      if (!frozen) e.t += dt;
      if (e.key === 'wink') wink = e.t > 0.1 && e.t < 0.55;
      if (e.key === 'blink') open = Math.floor(e.t * 9) % 2 === 0 ? 0 : 1;
      if (e.key === 'wide') wide = 1.35;
      if (e.t > e.dur) this.eyeAnim = null;
    }
    this.lids.forEach((lid, i) => {
      const closed = open === 0 || (wink && i === 1);
      const target = closed ? 0.25 : wide > 1 ? -1.9 : -1.2;
      lid.rotation.x += (target - lid.rotation.x) * (frozen ? 1 : Math.min(1, dt * 35));
    });
    this.eyes.forEach((e) => e.scale.setScalar(1 + (wide - 1) * 0.6));

    if (this.real) this.real.sync({ root: this.root, body: this.body, head: this.head, arms: this.arms, legs: this.legs });

    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.root.remove(this.bubble);
        this.bubble = null;
      }
    }
  }
}
