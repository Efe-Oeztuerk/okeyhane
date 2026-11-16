// Cartoon-Charakter: sauber modelliert, Kleidung als Textur, weiche Animationen mit IK.

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
        // V-Kragen, Brustlogo (Halbmond+Stern), Nummer hinten
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(cx - 50, 55);
        g.lineTo(cx, 120);
        g.lineTo(cx + 50, 55);
        g.lineTo(cx + 36, 55);
        g.lineTo(cx, 100);
        g.lineTo(cx - 36, 55);
        g.closePath();
        g.fill();
        g.fillRect(0, 380, 512, 18);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(cx + 60, 160, 16, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = col;
        g.beginPath();
        g.arc(cx + 65, 160, 13, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.font = 'bold 150px Inter, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('10', 0, 240);
        g.fillText('10', 512, 240);
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

  constructor(public spec: Avatar, displayName: string, opts: { showName?: boolean } = {}) {
    const a = spec;
    const skin = mat(a.skin, 0.65);
    const cloth = mat('#ffffff', 0.85, { map: clothTexture(a) });
    const sleeve = mat(a.shirt === 'takim' ? a.shirtColor : a.shirtColor, 0.85);
    const hairM = mat(a.hairColor, a.hair === 'slick' ? 0.3 : 0.75, { map: hairTexture(a.hairColor) });
    this.root.add(this.body);

    // ---------- Oberkörper
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 8, 24), cloth);
    torso.scale.set(1.15, 1, 0.8);
    torso.position.y = 0.42;
    torso.castShadow = true;
    this.body.add(torso);
    // Schultern weich
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), sleeve);
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
    this.skull.scale.set(fs[0], fs[1], fs[2]);
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
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.039, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), skin);
      lid.position.copy(eye.position);
      lid.rotation.x = -1.2; // offen
      this.skull.add(lid);
      this.lids.push(lid);
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
    nose.scale.set(0.85, 1, 1.15);
    nose.position.set(0, -0.025, 0.205);
    this.skull.add(nose);
    // Mund
    const mouth = tube(
      [
        [-0.035, -0.095, 0.183],
        [0, -0.105, 0.19],
        [0.035, -0.095, 0.183],
      ],
      0.006,
      mat('#7a2a20', 0.6),
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
    const hatOn = a.hat !== 'none';
    const hr = hatOn ? 0.205 : 0.212;
    if (a.hair !== 'none') {
      const capLen = a.hair === 'long' ? 1.45 : a.hair === 'slick' ? 1.12 : 1.22;
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
      if (a.hair === 'long') {
        const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.18, 6, 16), hairM);
        back.scale.set(1.3, 1, 0.55);
        back.position.set(0, -0.12, -0.11);
        this.skull.add(back);
      }
    }

    // Kopfbedeckung
    if (a.hat === 'kasket') {
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
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, UPPER - 0.08, 6, 14), sleeve);
      upper.position.y = -UPPER / 2;
      upper.castShadow = true;
      g.add(upper);
      const fore = new THREE.Group();
      fore.position.y = -UPPER;
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), sleeve);
      fore.add(elbow);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.054, FORE - 0.09, 6, 14), sleeve);
      lower.rotation.x = Math.PI / 2;
      lower.position.z = FORE / 2 - 0.02;
      fore.add(lower);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 14), mat('#f0ece2'));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.z = FORE - 0.04;
      if (a.shirt === 'takim' || a.shirt === 'gomlek') fore.add(cuff);
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
  }

  // ------------------------------------------------------------------ API

  say(text: string) {
    if (this.bubble) this.root.remove(this.bubble);
    this.bubble = bubbleSprite(text);
    this.bubble.position.y = 1.58;
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

    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.root.remove(this.bubble);
        this.bubble = null;
      }
    }
  }
}
