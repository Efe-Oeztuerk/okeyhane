// Cartoon-Charakter aus einfachen Formen, mit Emotes und Augen-Signalen.

import * as THREE from 'three';
import type { Avatar } from '../../server/src/protocol.ts';

const mat = (color: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function nameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 56px Inter, sans-serif';
  const w = Math.min(500, g.measureText(name).width + 50);
  g.fillStyle = 'rgba(20,12,8,0.7)';
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
  s.scale.set(0.8, 0.2, 1);
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

type Anim = { key: string; t: number; dur: number };

export class Avatar3D {
  root = new THREE.Group();
  private head = new THREE.Group();
  private torso!: THREE.Mesh;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private eyes: THREE.Group[] = [];
  private prop: THREE.Object3D | null = null;
  private teaGlass: THREE.Mesh;
  private nargileHose: THREE.Mesh;
  private name: THREE.Sprite;
  private bubble: THREE.Sprite | null = null;
  private bubbleT = 0;
  private anim: Anim | null = null;
  private eyeAnim: Anim | null = null;
  private time = Math.random() * 10;
  private blinkIn = 2 + Math.random() * 3;
  onSmoke: ((pos: THREE.Vector3) => void) | null = null;
  onSlam: (() => void) | null = null;

  constructor(public spec: Avatar, displayName: string, opts: { seated?: boolean; showName?: boolean } = {}) {
    const a = spec;
    const skin = mat(a.skin, 0.7);
    const shirt = mat(a.shirtColor);
    // Oberkörper
    const torsoGeo = new THREE.CapsuleGeometry(0.2, 0.32, 6, 12);
    this.torso = new THREE.Mesh(torsoGeo, shirt);
    this.torso.scale.set(1.15, 1, 0.8);
    this.torso.position.y = 0.42;
    this.torso.castShadow = true;
    this.root.add(this.torso);
    // Kleidungsdetails
    if (a.shirt === 'takim') {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.02), mat('#8b1d1d'));
      tie.position.set(0, 0.5, 0.17);
      this.root.add(tie);
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.02), mat('#f2f2f2'));
      collar.position.set(0, 0.64, 0.15);
      this.root.add(collar);
    } else if (a.shirt === 'gomlek') {
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.03), shirt);
      collar.position.set(0, 0.66, 0.13);
      this.root.add(collar);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.012), mat('#eee'));
        b.position.set(0, 0.58 - i * 0.08, 0.165);
        this.root.add(b);
      }
    } else if (a.shirt === 'esofman') {
      for (const x of [-0.24, 0.24]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.02), mat('#ffffff'));
        stripe.position.set(x, 0.42, 0.05);
        this.root.add(stripe);
      }
    } else if (a.shirt === 'trikot') {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.06, 0.34), mat('#ffffff'));
      band.position.set(0, 0.48, 0);
      this.root.add(band);
    } else if (a.shirt === 'hirka') {
      const open = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.02), mat('#e8e0d0'));
      open.position.set(0, 0.45, 0.165);
      this.root.add(open);
    }
    if (a.jewelry === 'chain') {
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 24), mat('#d4af37', 0.3));
      chain.rotation.x = Math.PI / 2.4;
      chain.position.set(0, 0.62, 0.08);
      this.root.add(chain);
    }

    // Kopf
    this.head.position.y = 0.88;
    this.root.add(this.head);
    const headGeo = new THREE.SphereGeometry(0.2, 24, 18);
    const headMesh = new THREE.Mesh(headGeo, skin);
    const fs = a.face === 'long' ? [0.9, 1.15, 0.95] : a.face === 'square' ? [1.05, 1, 1] : [1, 1, 1];
    headMesh.scale.set(fs[0], fs[1], fs[2]);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12), skin);
    neck.position.y = -0.2;
    this.head.add(neck);
    // Ohren
    for (const x of [-0.19, 0.19]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045), skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(x * fs[0], 0, 0);
      this.head.add(ear);
    }
    // Augen
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Group();
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), mat('#ffffff', 0.3));
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mat('#1b120c', 0.3));
      pupil.position.z = 0.028;
      eye.add(white, pupil);
      eye.position.set(x, 0.03, 0.17 * fs[2]);
      this.head.add(eye);
      this.eyes.push(eye);
    }
    // Augenbrauen
    const browH = a.eyebrows === 'thick' ? 0.022 : 0.011;
    for (const x of [-0.07, 0.07]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.075, browH, 0.02), mat(a.hairColor));
      brow.position.set(x, 0.09, 0.185 * fs[2]);
      brow.rotation.z = x < 0 ? 0.12 : -0.12;
      this.head.add(brow);
    }
    // Nase
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), skin);
    nose.scale.set(0.8, 1, 1.2);
    nose.position.set(0, -0.02, 0.2 * fs[2]);
    this.head.add(nose);
    // Mund
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.01), mat('#6b2a20'));
    mouth.position.set(0, -0.1, 0.18 * fs[2]);
    this.head.add(mouth);
    // Schnurrbart
    if (a.mustache !== 'none') {
      const thick = a.mustache === 'thick';
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(thick ? 0.025 : 0.015, 0.09, 4, 8), mat(a.hairColor));
      m.rotation.z = Math.PI / 2;
      m.position.set(0, -0.065, 0.195 * fs[2]);
      this.head.add(m);
      if (thick) {
        for (const x of [-0.06, 0.06]) {
          const end = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.04, 4, 6), mat(a.hairColor));
          end.position.set(x, -0.09, 0.185 * fs[2]);
          this.head.add(end);
        }
      }
    }
    // Bart
    if (a.beard !== 'none') {
      const beardMat = mat(a.hairColor);
      if (a.beard === 'stubble') {
        beardMat.transparent = true;
        beardMat.opacity = 0.35;
      }
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.4), beardMat);
      beard.scale.set(fs[0] * 1.02, fs[1] * (a.beard === 'full' ? 1.12 : 1.02), fs[2] * 1.03);
      this.head.add(beard);
    }
    // Haare
    if (a.hair !== 'none') {
      const hairMat = mat(a.hairColor);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.21, 20, 12, 0, Math.PI * 2, 0, a.hair === 'long' ? Math.PI * 0.62 : Math.PI * 0.45),
        hairMat,
      );
      cap.scale.set(fs[0] * 1.02, fs[1] * (a.hair === 'slick' ? 0.98 : 1.05), fs[2] * 1.02);
      cap.rotation.x = -0.25;
      this.head.add(cap);
      if (a.hair === 'curly') {
        for (let i = 0; i < 14; i++) {
          const curl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), hairMat);
          const ang = (i / 14) * Math.PI * 2;
          curl.position.set(Math.cos(ang) * 0.15 * fs[0], 0.13 + Math.sin(i) * 0.02, Math.sin(ang) * 0.13 - 0.02);
          this.head.add(curl);
        }
      }
    }
    // Kopfbedeckung
    if (a.hat === 'kasket') {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.07, 20), mat('#5a4a3a'));
      top.position.set(0, 0.17, 0.01);
      top.scale.z = 1.1;
      this.head.add(top);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.1), mat('#4a3a2a'));
      brim.position.set(0, 0.14, 0.2);
      this.head.add(brim);
    } else if (a.hat === 'takke') {
      const tk = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.3), mat('#f4f1ea'));
      tk.position.y = 0.06;
      this.head.add(tk);
    } else if (a.hat === 'bere') {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), mat('#2a3550'));
      b.position.y = 0.03;
      this.head.add(b);
    }
    // Brille
    if (a.glasses !== 'none') {
      const gm = a.glasses === 'sun' ? mat('#111', 0.2) : mat('#3a2a1a', 0.4);
      for (const x of [-0.07, 0.07]) {
        const ring = new THREE.Mesh(
          a.glasses === 'sun' ? new THREE.CylinderGeometry(0.045, 0.045, 0.01, 16) : new THREE.TorusGeometry(0.045, 0.007, 6, 18),
          gm,
        );
        if (a.glasses === 'sun') ring.rotation.x = Math.PI / 2;
        ring.position.set(x, 0.03, 0.205 * fs[2]);
        this.head.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.008), gm);
      bridge.position.set(0, 0.04, 0.21 * fs[2]);
      this.head.add(bridge);
    }

    // Arme
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(0.26 * side, 0.62, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.22, 4, 8), shirt);
      upper.position.y = -0.15;
      arm.add(upper);
      const fore = new THREE.Group();
      fore.position.y = -0.3;
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), shirt);
      lower.position.z = 0.12;
      lower.rotation.x = Math.PI / 2;
      fore.add(lower);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
      hand.position.z = 0.27;
      fore.add(hand);
      if (side === 1 && a.jewelry === 'ring') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 12), mat('#d4af37', 0.3));
        ring.position.z = 0.29;
        fore.add(ring);
      }
      if (side === -1 && a.jewelry === 'watch') {
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 6, 14), mat('#c0c0c0', 0.3));
        w.position.z = 0.21;
        fore.add(w);
      }
      arm.userData.fore = fore;
      arm.add(fore);
      arm.rotation.x = -0.35;
      this.root.add(arm);
    }
    // Zubehör
    const foreR: THREE.Group = this.armR.userData.fore;
    const foreL: THREE.Group = this.armL.userData.fore;
    if (a.accessory === 'tespih') {
      const t = new THREE.Group();
      for (let i = 0; i < 11; i++) {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), mat('#7a1f1f', 0.3));
        const ang = (i / 11) * Math.PI * 2;
        bead.position.set(Math.cos(ang) * 0.05, -0.04 + Math.sin(ang) * 0.05 - 0.03, 0);
        t.add(bead);
      }
      t.position.z = 0.28;
      foreL.add(t);
      this.prop = t;
    } else if (a.accessory === 'cigar' || a.accessory === 'toothpick') {
      const cig = new THREE.Mesh(
        new THREE.CylinderGeometry(a.accessory === 'cigar' ? 0.014 : 0.004, a.accessory === 'cigar' ? 0.014 : 0.004, a.accessory === 'cigar' ? 0.12 : 0.08),
        mat(a.accessory === 'cigar' ? '#5a3a20' : '#e8d2a0'),
      );
      cig.rotation.z = Math.PI / 2.3;
      cig.position.set(0.06, -0.1, 0.2 * fs[2]);
      this.head.add(cig);
    }
    // Teeglas (für Emote)
    this.teaGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.08, 12), new THREE.MeshStandardMaterial({ color: '#b5361b', transparent: true, opacity: 0.85, roughness: 0.1 }));
    this.teaGlass.position.z = 0.3;
    this.teaGlass.visible = false;
    foreR.add(this.teaGlass);
    this.nargileHose = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25), mat('#3b5b2b'));
    this.nargileHose.rotation.x = Math.PI / 2;
    this.nargileHose.position.z = 0.35;
    this.nargileHose.visible = false;
    foreR.add(this.nargileHose);

    this.name = nameSprite(displayName);
    this.name.position.y = 1.32;
    this.name.visible = opts.showName !== false;
    this.root.add(this.name);
  }

  say(text: string) {
    if (this.bubble) this.root.remove(this.bubble);
    this.bubble = bubbleSprite(text);
    this.bubble.position.y = 1.55;
    this.root.add(this.bubble);
    this.bubbleT = 4;
  }

  emote(key: string) {
    const durs: Record<string, number> = { slam: 1.0, tea: 2.2, nargile: 2.4, headshake: 1.2, rubhands: 1.4, tespih: 2.0 };
    this.anim = { key, t: 0, dur: durs[key] ?? 1.2 };
  }

  eye(key: string) {
    this.eyeAnim = { key, t: 0, dur: key === 'blink' ? 1.2 : key === 'wide' ? 1.4 : 0.6 };
  }

  setNameVisible(v: boolean) {
    this.name.visible = v;
  }

  update(dt: number) {
    this.time += dt;
    // Atmen / Idle
    this.torso.scale.y = 1 + Math.sin(this.time * 1.6) * 0.012;
    this.head.rotation.y = Math.sin(this.time * 0.4) * 0.12;
    this.head.rotation.x = 0;
    this.head.rotation.z = 0;
    this.armL.rotation.set(-0.35, 0, 0);
    this.armR.rotation.set(-0.35, 0, 0);
    this.teaGlass.visible = false;
    this.nargileHose.visible = false;
    if (this.prop) this.prop.rotation.z = Math.sin(this.time * 3) * 0.3;

    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const p = a.t / a.dur;
      const s = Math.sin(p * Math.PI);
      switch (a.key) {
        case 'slam': {
          const up = p < 0.5 ? p * 2 : 1 - (p - 0.5) * 2;
          this.armR.rotation.x = -0.35 - up * 1.4;
          if (a.t - dt < a.dur * 0.5 && a.t >= a.dur * 0.5) this.onSlam?.();
          break;
        }
        case 'tea':
          this.teaGlass.visible = true;
          this.armR.rotation.x = -0.35 - s * 1.5;
          this.armR.rotation.z = s * 0.4;
          this.head.rotation.x = -s * 0.25;
          break;
        case 'nargile':
          this.nargileHose.visible = true;
          this.armR.rotation.x = -0.35 - s * 1.6;
          this.armR.rotation.z = s * 0.5;
          if (a.t - dt < a.dur * 0.7 && a.t >= a.dur * 0.7) {
            const pos = new THREE.Vector3();
            this.head.getWorldPosition(pos);
            this.onSmoke?.(pos);
          }
          break;
        case 'headshake':
          this.head.rotation.y = Math.sin(a.t * 18) * 0.35 * s;
          break;
        case 'rubhands':
          this.armL.rotation.z = Math.sin(a.t * 20) * 0.15;
          this.armR.rotation.z = -Math.sin(a.t * 20) * 0.15;
          this.armL.rotation.x = this.armR.rotation.x = -0.9;
          break;
        case 'tespih':
          this.armL.rotation.x = -0.35 - s * 0.9;
          if (this.prop) this.prop.rotation.z = a.t * 12;
          break;
      }
      if (a.t >= a.dur) this.anim = null;
    }

    // Augen
    let eyeL = 1;
    let eyeR = 1;
    let eyeScale = 1;
    this.blinkIn -= dt;
    if (this.blinkIn < 0) {
      if (this.blinkIn > -0.12) eyeL = eyeR = 0.1;
      else this.blinkIn = 2 + Math.random() * 4;
    }
    if (this.eyeAnim) {
      const e = this.eyeAnim;
      e.t += dt;
      if (e.key === 'wink') eyeR = e.t < 0.45 ? 0.08 : 1;
      if (e.key === 'blink') eyeL = eyeR = Math.floor(e.t * 10) % 2 === 0 ? 0.08 : 1;
      if (e.key === 'wide') eyeScale = 1.45;
      if (e.t > e.dur) this.eyeAnim = null;
    }
    this.eyes[0].scale.set(eyeScale, eyeL * eyeScale, eyeScale);
    this.eyes[1].scale.set(eyeScale, eyeR * eyeScale, eyeScale);

    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.root.remove(this.bubble);
        this.bubble = null;
      }
    }
  }
}
