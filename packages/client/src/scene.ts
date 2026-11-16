// Die 3D-Welt: Kahvehane, Tisch, Spieler, NPCs, Rauch, Fernseher.

import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Tile } from '@okeyhane/engine';
import type { Avatar, PlayerInfo } from '../../server/src/protocol.ts';
import { Avatar3D } from './avatar.ts';
import { tileMesh } from './tileArt.ts';
import * as D from './decor.ts';
import { settings, onSettings } from './settings.ts';
import { sfx } from './sound.ts';
import { makeShisha, animateShisha, type ShishaStyle } from './props.ts';
import { placeModel } from './models.ts';

const TABLE_Y = 0.74;
const FLAT = 1.7;
const SEAT_R = 0.92;
export const seatPos = (s: number) => {
  const dirs = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  return new THREE.Vector3(dirs[s][0], 0, dirs[s][1]);
};

function facing(obj: THREE.Object3D, x: number, z: number) {
  obj.rotation.y = Math.atan2(-x, -z);
}

const ROOM = { w: 10, d: 9, h: 3.4 };

export interface GameVisual {
  mySeat: number | null;
  viewSeat: number;
  current: number;
  pileCount: number;
  indicator: Tile | null;
  okeyBirTile: Tile | null;
  rackCounts: number[];
  discards: Tile[][];
  tableMelds: { owner: number; tiles: Tile[] }[];
  revealed: Tile[][] | null;
}

export class World {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.05, 50);
  renderer: THREE.WebGLRenderer;
  css: CSS3DRenderer;
  private clock = new THREE.Clock();
  private avatars: (Avatar3D | null)[] = [null, null, null, null];
  private avatarSpecs: string[] = ['', '', '', ''];
  private chairs: THREE.Group[] = [];
  private gameGroup = new THREE.Group();
  private clickables: THREE.Object3D[] = [];
  private smoke: { s: THREE.Sprite; v: THREE.Vector3; life: number; max: number; amount: number }[] = [];
  private smokeTex = D.smokeSprite();
  private npcs: Avatar3D[] = [];
  private cayci!: Avatar3D;
  private cayciState = { t: 20, phase: 'idle' as 'idle' | 'go' | 'serve' | 'back', pos: new THREE.Vector3(3.6, 0, -3.2) };
  private teaGlasses: THREE.Group[] = [];
  private fan!: THREE.Object3D;
  private clockHands: { h: THREE.Object3D; m: THREE.Object3D } | null = null;
  private windowMesh!: THREE.Mesh;
  private ambient!: THREE.HemisphereLight;
  private lamps: THREE.PointLight[] = [];
  private tvCss!: CSS3DObject;
  private tvScreen!: THREE.Mesh;
  private tvHole!: THREE.Mesh;
  tvHost: HTMLDivElement;
  private dayMode = '';
  // Bewegung
  seated: number | null = null;
  private walkPos = new THREE.Vector3(0, 1.6, 3.4);
  private yaw = 0;
  private pitch = -0.1;
  private keys = new Set<string>();
  private camTarget: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private camLook = new THREE.Vector3(0, 1, 0);
  // Callbacks
  onChair: ((seat: number) => void) | null = null;
  onPile: (() => void) | null = null;
  onSide: (() => void) | null = null;
  onMeld: ((index: number) => void) | null = null;
  private hoverChair = -1;
  private visual: GameVisual | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = settings.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : 1));
    this.css = new CSS3DRenderer();
    this.css.domElement.className = 'css3d';
    this.renderer.domElement.className = 'gl';
    container.append(this.css.domElement, this.renderer.domElement);

    this.tvHost = document.createElement('div');
    this.tvHost.className = 'tv-host';

    this.buildRoom();
    this.buildTable();
    this.buildNpcs();
    this.scene.add(this.gameGroup);
    this.applyTimeOfDay();
    onSettings(() => {
      this.applyTimeOfDay();
      this.renderer.shadowMap.enabled = settings.quality === 'high';
    });

    addEventListener('resize', () => this.resize());
    this.resize();
    this.bindInput();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ Raum

  private buildRoom() {
    const { w, d, h } = ROOM;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: D.woodFloor(), roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#d8c9a8' }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = h;
    this.scene.add(ceil);
    // Holzbalken
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.18), new THREE.MeshStandardMaterial({ color: '#5a3a22' }));
      beam.position.set(0, h - 0.07, i * 1.8);
      this.scene.add(beam);
    }
    const wallMat = new THREE.MeshStandardMaterial({ color: '#e6d6b4', roughness: 0.95 });
    const tileMat = new THREE.MeshStandardMaterial({ map: D.wallTiles(), roughness: 0.6 });
    const walls: [number, number, number, number][] = [
      [0, -d / 2, 0, w],
      [0, d / 2, Math.PI, w],
      [-w / 2, 0, Math.PI / 2, d],
      [w / 2, 0, -Math.PI / 2, d],
    ];
    for (const [x, z, ry, len] of walls) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wallMat);
      wall.position.set(x, h / 2, z);
      wall.rotation.y = ry;
      wall.receiveShadow = true;
      this.scene.add(wall);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), tileMat);
      band.position.set(x * 0.999, 0.55, z * 0.999);
      band.rotation.y = ry;
      this.scene.add(band);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: '#5a3a22' }));
      rail.position.set(x * 0.995, 1.12, z * 0.995);
      rail.rotation.y = ry;
      this.scene.add(rail);
    }
    // Fenster (Ostwand)
    this.windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshBasicMaterial({ map: D.cityWindow('day') }));
    this.windowMesh.position.set(w / 2 - 0.01, 1.9, 0.5);
    this.windowMesh.rotation.y = -Math.PI / 2;
    this.scene.add(this.windowMesh);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.75, 2.55), new THREE.MeshStandardMaterial({ color: '#5a3a22' }));
    frame.position.set(w / 2 - 0.02, 1.9, 0.5);
    this.scene.add(frame);
    this.windowMesh.position.x -= 0.03;

    // Schild über der Theke
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: D.signText('OKEYHANE'), emissive: '#3a1008', emissiveIntensity: 0.4 }));
    sign.position.set(2.8, 2.7, -d / 2 + 0.02);
    this.scene.add(sign);

    // Theke mit Semaver
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1.05, 0.7), new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.6 }));
    counter.position.set(2.8, 0.525, -d / 2 + 0.6);
    counter.castShadow = counter.receiveShadow = true;
    this.scene.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.05, 0.8), new THREE.MeshStandardMaterial({ color: '#3b2414', roughness: 0.3 }));
    top.position.set(2.8, 1.07, -d / 2 + 0.6);
    this.scene.add(top);
    this.scene.add(this.semaver(2.0, 1.1, -d / 2 + 0.55));
    for (let i = 0; i < 8; i++) this.scene.add(this.teaGlassMesh(new THREE.Vector3(2.6 + i * 0.12, 1.1, -d / 2 + 0.75)));
    // Regal
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.3), new THREE.MeshStandardMaterial({ color: '#5a3a22' }));
    shelf.position.set(2.8, 1.85, -d / 2 + 0.17);
    this.scene.add(shelf);
    for (let i = 0; i < 9; i++) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12), new THREE.MeshStandardMaterial({ color: ['#a0522d', '#d4a017', '#2e5e3e'][i % 3], roughness: 0.3, transparent: true, opacity: 0.85 }));
      jar.position.set(1.7 + i * 0.27, 1.98, -d / 2 + 0.17);
      this.scene.add(jar);
    }

    // Bilder an der Nordwand
    const picFrame = (tex: THREE.Texture, x: number, y: number, z: number, ry: number, pw: number, ph: number) => {
      const g = new THREE.Group();
      const fr = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.08, ph + 0.08, 0.03), new THREE.MeshStandardMaterial({ color: '#3b2414' }));
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
      pic.position.z = 0.017;
      g.add(fr, pic);
      g.position.set(x, y, z);
      g.rotation.y = ry;
      this.scene.add(g);
    };
    picFrame(D.flag(), -3.4, 2.3, -d / 2 + 0.03, 0, 1.2, 0.8);
    for (let i = 0; i < 3; i++) picFrame(D.portrait(i + 1), -w / 2 + 0.03, 2.1, -2.4 + i * 1.1, Math.PI / 2, 0.55, 0.72);
    for (let i = 0; i < 2; i++) picFrame(D.portrait(i + 7), w / 2 - 0.03, 2.1, -2.8 + i * 1.0, -Math.PI / 2, 0.5, 0.66);
    // Kilims
    const k1 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.1), new THREE.MeshStandardMaterial({ map: D.kilim(1), roughness: 1 }));
    k1.position.set(-w / 2 + 0.02, 1.7, 2.2);
    k1.rotation.y = Math.PI / 2;
    this.scene.add(k1);
    const k2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), new THREE.MeshStandardMaterial({ map: D.kilim(2), roughness: 1 }));
    k2.rotation.x = -Math.PI / 2;
    k2.rotation.z = Math.PI / 2;
    k2.position.set(0, 0.005, 0);
    k2.receiveShadow = true;
    this.scene.add(k2);

    // Uhr
    const clk = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), new THREE.MeshStandardMaterial({ map: D.clockFace() }));
    clk.add(face);
    const hand = (len: number, wd: number) => {
      const p = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(wd, len, 0.01), new THREE.MeshStandardMaterial({ color: '#1a1a1a' }));
      m.position.y = len / 2;
      p.add(m);
      p.position.z = 0.01;
      clk.add(p);
      return p;
    };
    this.clockHands = { h: hand(0.15, 0.025), m: hand(0.22, 0.015) };
    clk.position.set(0.2, 2.6, -d / 2 + 0.02);
    this.scene.add(clk);

    // Fernseher (Nordwand, links)
    const tvW = 2.0;
    const tvH = 1.125;
    const tvX = -1.2;
    const tvY = 2.25;
    const tvZ = -d / 2 + 0.12;
    const body = new THREE.Mesh(new THREE.BoxGeometry(tvW + 0.12, tvH + 0.12, 0.08), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.4 }));
    body.position.set(tvX, tvY, tvZ - 0.05);
    this.scene.add(body);
    this.tvScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(tvW, tvH),
      new THREE.MeshBasicMaterial({ map: D.tvStandby() }),
    );
    this.tvScreen.position.set(tvX, tvY, tvZ - 0.005);
    this.scene.add(this.tvScreen);
    this.tvHole = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending }));
    this.tvHole.position.set(tvX, tvY, tvZ);
    this.tvHole.visible = false;
    this.scene.add(this.tvHole);
    this.tvHost.style.width = '960px';
    this.tvHost.style.height = '540px';
    this.tvCss = new CSS3DObject(this.tvHost);
    this.tvCss.position.set(tvX, tvY, tvZ);
    this.tvCss.scale.setScalar(tvW / 960);
    this.tvCss.visible = false;
    this.scene.add(this.tvCss);

    // Deckenventilator
    this.fan = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12), new THREE.MeshStandardMaterial({ color: '#3b2a1a' }));
    this.fan.add(hub);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.015, 0.14), new THREE.MeshStandardMaterial({ color: '#6b4a2a' }));
      blade.position.x = 0.38;
      const p = new THREE.Group();
      p.add(blade);
      p.rotation.y = (i * Math.PI) / 2;
      this.fan.add(p);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5), new THREE.MeshStandardMaterial({ color: '#333' }));
    rod.position.y = 0.3;
    this.fan.add(rod);
    this.fan.position.set(0, ROOM.h - 0.55, 0);
    this.scene.add(this.fan);

    // Licht
    this.ambient = new THREE.HemisphereLight('#fff1d6', '#3a2a1a', 0.7);
    this.scene.add(this.ambient);
    const lampPositions = [
      [0, 0],
      [-3, 2],
      [3, 2],
      [-3, -2],
    ];
    for (const [x, z] of lampPositions) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.1), new THREE.MeshStandardMaterial({ color: '#222' }));
      cord.position.set(x + 0.6, ROOM.h - 0.55, z);
      this.scene.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#2f5e46', side: THREE.DoubleSide, roughness: 0.5 }));
      shade.position.set(x + 0.6, ROOM.h - 1.15, z);
      this.scene.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshBasicMaterial({ color: '#ffe0a0' }));
      bulb.position.set(x + 0.6, ROOM.h - 1.22, z);
      this.scene.add(bulb);
      const l = new THREE.PointLight('#ffcf8a', 2.2, 7, 1.6);
      l.position.set(x + 0.6, ROOM.h - 1.3, z);
      l.castShadow = x === 0 && z === 0;
      if (l.castShadow) l.shadow.mapSize.set(1024, 1024);
      this.scene.add(l);
      this.lamps.push(l);
    }
    // Eingangstür (Südwand)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.06), new THREE.MeshStandardMaterial({ color: '#4a2e1a' }));
    door.position.set(0, 1.1, d / 2 - 0.03);
    this.scene.add(door);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), new THREE.MeshStandardMaterial({ color: '#c8dde8', emissive: '#556070', transparent: true, opacity: 0.7 }));
    glass.position.set(0, 1.55, d / 2 - 0.07);
    glass.rotation.y = Math.PI;
    this.scene.add(glass);
    // Lokum-Teller auf der Theke (Sketchfab: nur_ay)
    const lokum = new THREE.Group();
    placeModel(lokum, 'lokum', 0.45, 'width');
    lokum.position.set(1.75, 1.1, -d / 2 + 0.72);
    this.scene.add(lokum);
    // Läufer am Eingang (Sketchfab: mfb64)
    const runner = new THREE.Group();
    placeModel(runner, 'carpet', 2.6, 'width', { layFlat: true });
    runner.position.set(0, 0.006, 2.95);
    this.scene.add(runner);
    // Nargile am Rand
    for (const [x, z, st] of [
      [1.6, 1.2, 'ruby'],
      [-3.6, -0.6, 'classic'],
      [3.9, 2.0, 'emerald'],
    ] as [number, number, ShishaStyle][]) {
      const sh = makeShisha(st);
      sh.position.set(x, 0, z);
      sh.rotation.y = x;
      this.scene.add(sh);
      this.decoShishas.push(sh);
    }
  }

  private semaver(x: number, y: number, z: number) {
    const g = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a04a', metalness: 0.8, roughness: 0.3 });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 20), brass);
    b.position.y = 0.2;
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10), new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.3 }));
    t.position.y = 0.5;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12), brass);
    spout.rotation.z = Math.PI / 2;
    spout.position.set(0.22, 0.12, 0);
    g.add(b, t, spout);
    g.position.set(x, y, z);
    return g;
  }

  private nargile(x: number, y: number, z: number) {
    const g = new THREE.Group();
    const glassM = new THREE.MeshStandardMaterial({ color: '#2a6a8a', transparent: true, opacity: 0.7, roughness: 0.1 });
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), glassM);
    base.position.y = 0.16;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.55), new THREE.MeshStandardMaterial({ color: '#b08a3a', metalness: 0.7, roughness: 0.3 }));
    stem.position.y = 0.55;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.07), new THREE.MeshStandardMaterial({ color: '#7a3a1a' }));
    bowl.position.y = 0.85;
    const coal = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }));
    coal.position.y = 0.895;
    g.add(base, stem, bowl, coal);
    g.position.set(x, y, z);
    return g;
  }

  private teaGlassMesh(pos: THREE.Vector3) {
    const g = new THREE.Group();
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.008, 20), new THREE.MeshStandardMaterial({ color: '#d33', roughness: 0.4 }));
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.02, 0.075, 14), new THREE.MeshStandardMaterial({ color: '#a8331a', transparent: true, opacity: 0.85, roughness: 0.05 }));
    glass.position.y = 0.04;
    g.add(saucer, glass);
    g.position.copy(pos);
    return g;
  }

  // ------------------------------------------------------------ Tisch + Stühle

  private buildTable() {
    const wood = new THREE.MeshStandardMaterial({ color: '#5b3a22', roughness: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 1.2), wood);
    top.position.y = TABLE_Y - 0.03;
    top.castShadow = top.receiveShadow = true;
    top.userData.table = true;
    this.tableMeshes.push(top);
    this.scene.add(top);
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.08), new THREE.MeshStandardMaterial({ map: D.feltTexture(), roughness: 1 }));
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = TABLE_Y - 0.004;
    felt.receiveShadow = true;
    felt.userData.table = true;
    this.tableMeshes.push(felt);
    this.scene.add(felt);
    for (const [x, z] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, TABLE_Y, 0.06), wood);
      leg.position.set(x, TABLE_Y / 2, z);
      leg.castShadow = true;
      this.scene.add(leg);
    }
    for (let s = 0; s < 4; s++) {
      const dir = seatPos(s);
      const chair = this.chair();
      chair.position.set(dir.x * 1.07, 0, dir.z * 1.07);
      facing(chair, dir.x, dir.z);
      chair.userData.seat = s;
      chair.traverse((o) => (o.userData.seat = s));
      this.scene.add(chair);
      this.chairs.push(chair);
    }
  }

  private chair() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#7a4b2a', roughness: 0.7 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: '#9a6a3a' }));
    seat.position.y = 0.45;
    g.add(seat);
    for (const [x, z] of [
      [-0.18, -0.18],
      [0.18, -0.18],
      [-0.18, 0.18],
      [0.18, 0.18],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.45), wood);
      leg.position.set(x, 0.225, z);
      g.add(leg);
    }
    for (const x of [-0.18, 0.18]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5), wood);
      post.position.set(x, 0.7, 0.19);
      g.add(post);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.02), wood);
    back.position.set(0, 0.85, 0.19);
    g.add(back);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return g;
  }

  // ------------------------------------------------------------ NPCs

  private randomSpec(i: number): Avatar {
    const pick = <T,>(arr: readonly T[]) => arr[(i * 7 + arr.length * 3) % arr.length];
    return {
      skin: ['#e0b48f', '#c99068', '#a26e4a', '#f1c9a5', '#b98058'][i % 5],
      face: pick(['round', 'long', 'square'] as const),
      hair: (['short', 'none', 'slick', 'curly', 'short'] as const)[i % 5],
      hairColor: ['#2b1d14', '#888', '#1a1a1a', '#5a4030', '#ccc'][i % 5],
      eyebrows: 'thick',
      beard: (['none', 'stubble', 'full'] as const)[i % 3],
      mustache: (['thick', 'classic', 'none', 'thick'] as const)[i % 4],
      shirt: (['gomlek', 'hirka', 'takim', 'esofman', 'gomlek'] as const)[i % 5],
      shirtColor: ['#5a4a3a', '#3a4a5b', '#444', '#2d4a3a', '#6a3a2a'][i % 5],
      hat: (['kasket', 'none', 'takke', 'none', 'kasket'] as const)[i % 5],
      glasses: (['none', 'reading', 'none'] as const)[i % 3],
      accessory: (['tespih', 'none', 'toothpick', 'none'] as const)[i % 4],
      jewelry: 'none',
    };
  }

  private buildNpcs() {
    // zwei Nebentische mit Tavla / Zeitung
    const spots = [
      { x: -3.2, z: 2.6 },
      { x: 3.2, z: 2.8 },
      { x: -3.3, z: -2.4 },
    ];
    spots.forEach((sp, ti) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 24), new THREE.MeshStandardMaterial({ color: '#5b3a22' }));
      t.position.set(sp.x, 0.72, sp.z);
      t.castShadow = true;
      this.scene.add(t);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.72), new THREE.MeshStandardMaterial({ color: '#3b2414' }));
      leg.position.set(sp.x, 0.36, sp.z);
      this.scene.add(leg);
      if (ti !== 2) {
        // Tavla-Brett
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.34), new THREE.MeshStandardMaterial({ color: '#8a5a2a' }));
        board.position.set(sp.x, 0.755, sp.z);
        this.scene.add(board);
      } else {
        const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshStandardMaterial({ color: '#efe9da' }));
        paper.rotation.x = -Math.PI / 2;
        paper.position.set(sp.x, 0.745, sp.z);
        this.scene.add(paper);
      }
      this.scene.add(this.teaGlassMesh(new THREE.Vector3(sp.x + 0.25, 0.74, sp.z + 0.1)));
      const n = ti === 2 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const side = k === 0 ? -1 : 1;
        const chair = this.chair();
        chair.position.set(sp.x + side * 0.65, 0, sp.z);
        facing(chair, side, 0);
        this.scene.add(chair);
        const a = new Avatar3D(this.randomSpec(ti * 2 + k + 3), '', { showName: false });
        a.root.position.set(sp.x + side * 0.62, 0.45, sp.z);
        facing(a.root, side, 0);
        a.root.scale.setScalar(1);
        a.onSmoke = (p, d, amt) => this.puff(p, d ? 2 : 6, d, amt ?? 0.6);
        this.scene.add(a.root);
        this.npcs.push(a);
      }
    });
    // Çaycı
    this.cayci = new Avatar3D(
      { ...this.randomSpec(11), shirt: 'gomlek', shirtColor: '#f2efe6', hat: 'none', mustache: 'thick', accessory: 'none' },
      'Çaycı',
      { showName: true },
    );
    this.cayci.root.position.copy(this.cayciState.pos);
    this.scene.add(this.cayci.root);
    // Tablett
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.01, 20), new THREE.MeshStandardMaterial({ color: '#c0c0c0', metalness: 0.8, roughness: 0.3 }));
    tray.position.set(0.25, 0.85, 0.3);
    this.cayci.root.add(tray);
    for (let i = 0; i < 3; i++) {
      const tg = this.teaGlassMesh(new THREE.Vector3(0.2 + i * 0.05, 0.86, 0.3));
      this.cayci.root.add(tg);
    }
  }

  // ------------------------------------------------------------ Tageszeit

  applyTimeOfDay() {
    let mode = settings.timeOfDay as string;
    if (mode === 'auto') {
      const h = new Date().getHours();
      mode = h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'evening' : 'night';
    }
    if (mode === this.dayMode) return;
    this.dayMode = mode;
    (this.windowMesh.material as THREE.MeshBasicMaterial).map = D.cityWindow(mode as any);
    (this.windowMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    this.ambient.intensity = mode === 'day' ? 0.95 : mode === 'evening' ? 0.6 : 0.35;
    this.ambient.color.set(mode === 'day' ? '#fff6e6' : mode === 'evening' ? '#ffd9b0' : '#b8c0ff');
    for (const l of this.lamps) l.intensity = mode === 'day' ? 1.4 : 2.6;
  }

  // ------------------------------------------------------------ Spieler

  private mySeat: number | null = null;
  setPlayers(seats: (PlayerInfo | null)[], mySeat: number | null) {
    this.mySeat = mySeat;
    this.avatars.forEach((a, s) => a && (a.root.visible = s !== mySeat));
    for (let s = 0; s < 4; s++) {
      const p = seats[s];
      const key = p ? p.id + JSON.stringify(p.avatar) + p.name : '';
      if (key === this.avatarSpecs[s]) continue;
      this.avatarSpecs[s] = key;
      const old = this.avatars[s];
      if (old) this.scene.remove(old.root);
      this.avatars[s] = null;
      if (this.seatShishas[s]) this.scene.remove(this.seatShishas[s]!);
      this.seatShishas[s] = null;
      if (!p) continue;
      const a = new Avatar3D(p.avatar, p.name);
      const dir = seatPos(s);
      a.root.position.set(dir.x * 1.04, 0.45, dir.z * 1.04);
      facing(a.root, dir.x, dir.z);
      a.onSmoke = (pos, d, amt) => {
        if (s === this.mySeat) return; // eigener Rauch kommt über selfPuff
        this.puff(pos, d ? 2 : 10, d, amt ?? 1);
      };
      a.onSlam = () => {
        sfx.slam();
        this.shakeT = 0.25;
      };
      a.root.visible = s !== mySeat;
      this.scene.add(a.root);
      this.avatars[s] = a;
      // eigene Nargile neben dem Stuhl (Seite des Schlauchs)
      a.root.updateMatrixWorld(true);
      const sh = makeShisha((p.avatar.shisha as ShishaStyle) ?? 'classic');
      const wp = a.root.localToWorld(new THREE.Vector3(0.5, -0.45, 0.02));
      sh.position.copy(wp);
      sh.rotation.y = a.root.rotation.y + Math.PI / 2;
      this.scene.add(sh);
      this.seatShishas[s] = sh;
    }
  }

  private shakeT = 0;
  private decoShishas: THREE.Group[] = [];
  private seatShishas: (THREE.Group | null)[] = [null, null, null, null];

  emote(seat: number, key: string) {
    this.avatars[seat]?.emote(key);
    if (key === 'tea') setTimeout(() => sfx.sip(), 800);
    if (key === 'nargile') setTimeout(() => sfx.smoke(), 1500);
  }
  eye(seat: number, key: string) {
    this.avatars[seat]?.eye(key);
  }
  say(seat: number, text: string) {
    this.avatars[seat]?.say(text);
  }

  puff(pos: THREE.Vector3, n = 10, dir?: THREE.Vector3, amount = 1) {
    if (!settings.smoke) return;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0.6 * amount }));
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.03));
      s.scale.setScalar(0.06 + 0.06 * amount);
      this.scene.add(s);
      const max = (1.6 + Math.random() * 1.2) * (0.6 + amount * 0.5);
      const v = dir
        ? dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.08, Math.random() * 0.05, (Math.random() - 0.5) * 0.08))
        : new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.15 + Math.random() * 0.15, (Math.random() - 0.5) * 0.15);
      this.smoke.push({ s, v, life: 0, max, amount });
    }
  }

  /** Eigener Rauch/Dampf direkt vor der Kamera (Ego-Perspektive) */
  selfPuff(kind: 'smoke' | 'steam') {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const pos = this.camera.position.clone().add(fwd.clone().multiplyScalar(0.42)).add(new THREE.Vector3(0, 0.02, 0));
    if (kind === 'smoke') {
      let n = 0;
      const iv = setInterval(() => {
        this.puff(pos.clone().add(fwd.clone().multiplyScalar(n * 0.01)), 3, fwd.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, 0.16, 0)), 1.5);
        if (++n > 14) clearInterval(iv);
      }, 70);
    } else {
      let n = 0;
      const iv = setInterval(() => {
        this.puff(pos.clone().add(new THREE.Vector3(0.08, -0.05, 0)), 1, new THREE.Vector3(0, 0.18, 0), 0.7);
        if (++n > 10) clearInterval(iv);
      }, 160);
    }
  }

  /** Kamera kurz wackeln lassen */
  shake(t = 0.25) {
    this.shakeT = t;
  }

  /** Großer Rauch über dem Tisch (Taş Çalma) */
  smokeCloud() {
    if (!settings.smoke) return;
    for (let i = 0; i < 40; i++) {
      this.puff(new THREE.Vector3((Math.random() - 0.5) * 0.8, TABLE_Y + 0.15, (Math.random() - 0.5) * 0.8), 1);
    }
  }

  // ------------------------------------------------------------ Kamera / Bewegung

  /** im Sitzen: true = auf das Brett fixiert, false = frei umschauen */
  focus = true;
  private seatYaw = 0;
  private seatPitch = 0;
  onFocusChange: ((focus: boolean) => void) | null = null;

  setFocus(f: boolean) {
    if (this.focus === f) return;
    this.focus = f;
    if (f) {
      this.seatYaw = 0;
      this.seatPitch = 0;
    }
    this.onFocusChange?.(f);
  }

  sitAt(seat: number | null) {
    this.seated = seat;
    if (seat === null) {
      this.camTarget = null;
      this.walkPos.set(0, 1.6, 2.2);
      this.yaw = 0;
      this.pitch = -0.15;
    } else {
      const dir = seatPos(seat);
      this.camTarget = {
        pos: new THREE.Vector3(dir.x * 1.18, 1.5, dir.z * 1.18),
        look: new THREE.Vector3(dir.x * 0.12, TABLE_Y - 0.12, dir.z * 0.12),
      };
      this.focus = true;
      this.seatYaw = 0;
      this.seatPitch = 0;
      this.onFocusChange?.(true);
    }
    this.avatars.forEach((a, s) => a && (a.root.visible = s !== this.mySeat));
  }

  private bindInput() {
    const el = this.container;
    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.seated !== null) {
        e.preventDefault();
        this.setFocus(!this.focus);
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // Umschauen: Maus gedrückt halten und ziehen (kein Pointer-Lock, UI bleibt klickbar)
    let down: { x: number; y: number; moved: boolean } | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      down = { x: e.clientX, y: e.clientY, moved: false };
    });
    addEventListener('pointermove', (e) => {
      if (!down || !(e.buttons & 3)) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 5) return;
      if (!down.moved) {
        down.moved = true;
        if (this.seated !== null) this.setFocus(false);
      }
      down.x = e.clientX;
      down.y = e.clientY;
      const sens = 0.0042;
      if (this.seated === null) {
        this.yaw -= dx * sens;
        this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * sens));
      } else {
        this.seatYaw = Math.max(-2.6, Math.min(2.6, this.seatYaw - dx * sens));
        this.seatPitch = Math.max(-0.9, Math.min(1.0, this.seatPitch - dy * sens));
      }
    });
    addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || d.moved || e.button !== 0) return;
      if (!(e.target instanceof Node) || !el.contains(e.target)) return;
      this.handleClick(e);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
  }
  private mouseNdc = new THREE.Vector2(0, 0);

  private handleClick(e: PointerEvent) {
    if (this.seated === null) {
      const hit = this.pick(e, this.chairs);
      if (hit?.userData.seat !== undefined) this.onChair?.(hit.userData.seat);
      return;
    }
    const hit = this.pick(e, [...this.clickables, ...this.tableMeshes]);
    if (!hit) {
      // daneben geklickt → frei umschauen
      this.setFocus(false);
      return;
    }
    this.setFocus(true);
    if (hit.userData.pile) this.onPile?.();
    else if (hit.userData.side) this.onSide?.();
    else if (hit.userData.meld !== undefined) this.onMeld?.(hit.userData.meld);
  }

  private tableMeshes: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private pick(e: { clientX: number; clientY: number }, targets: THREE.Object3D[]): THREE.Object3D | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && o.userData.seat === undefined && !o.userData.pile && !o.userData.side && o.userData.meld === undefined && !o.userData.table) o = o.parent;
    return o;
  }

  /** Bildschirmpunkt über dem Tisch? (für Drag & Drop-Abwurf) */
  isOverTable(x: number, y: number) {
    return !!this.pick({ clientX: x, clientY: y }, [...this.tableMeshes, ...this.clickables]);
  }

  // ------------------------------------------------------------ Spielzustand

  private prevDiscards: number[] = [];
  private flyers: { m: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; spin: number }[] = [];

  setGame(v: GameVisual | null) {
    this.visual = v;
    this.flyers = [];
    if (!v) this.prevDiscards = [];
    this.gameGroup.clear();
    this.clickables = [];
    if (!v) return;
    const viewer = v.mySeat ?? v.viewSeat;
    const viewDir = seatPos(viewer);
    const readRot = Math.atan2(viewDir.x, viewDir.z); // flache Steine zum Betrachter drehen

    // Istakas der anderen (Rückseiten) + aufgedeckte Hände am Ende
    for (let s = 0; s < 4; s++) {
      const dir = seatPos(s);
      const rack = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.09), new THREE.MeshStandardMaterial({ color: '#8a5a2a', roughness: 0.5 }));
      board.position.y = 0.02;
      rack.add(board);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.012), new THREE.MeshStandardMaterial({ color: '#6b4220' }));
      lip.position.set(0, 0.05, 0.04);
      rack.add(lip);
      rack.position.set(dir.x * 0.47, TABLE_Y, dir.z * 0.47);
      facing(rack, dir.x, dir.z);
      rack.rotation.y += Math.PI;
      if (s !== v.mySeat) {
        const tiles = v.revealed ? v.revealed[s] : null;
        const n = tiles ? tiles.length : v.rackCounts[s];
        const perRow = 13;
        for (let i = 0; i < n; i++) {
          const row = Math.floor(i / perRow);
          const col = i % perRow;
          const m = tileMesh(tiles ? tiles[i] : null, !!tiles);
          m.position.set((col - (Math.min(n - row * perRow, perRow) - 1) / 2) * 0.039, 0.06 + row * 0.052, -0.01 + row * 0.005);
          // Steine zeigen zum Besitzer; aufgedeckt zum Tisch
          m.rotation.y = tiles ? Math.PI : 0;
          m.rotation.x = -0.15;
          rack.add(m);
        }
      }
      this.gameGroup.add(rack);
      // Zug-Markierung
      if (s === v.current) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 24), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(dir.x * 0.32, TABLE_Y + 0.002, dir.z * 0.32);
        this.gameGroup.add(ring);
      }
    }

    // Mitte: Stapel + Gösterge
    if (v.pileCount > 0) {
      const pile = new THREE.Group();
      const h = Math.max(0.012, v.pileCount * 0.0012);
      const stack = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.07), [
        new THREE.MeshStandardMaterial({ color: '#e6d8b8' }),
        new THREE.MeshStandardMaterial({ color: '#e6d8b8' }),
        new THREE.MeshStandardMaterial({ color: '#efe3c8' }),
        new THREE.MeshStandardMaterial({ color: '#e6d8b8' }),
        new THREE.MeshStandardMaterial({ color: '#e6d8b8' }),
        new THREE.MeshStandardMaterial({ color: '#e6d8b8' }),
      ]);
      stack.position.y = h / 2;
      stack.castShadow = true;
      pile.add(stack);
      pile.position.set(-0.07, TABLE_Y, 0);
      pile.userData.pile = true;
      stack.userData.pile = true;
      this.gameGroup.add(pile);
      this.clickables.push(pile);
    }
    if (v.indicator) {
      const m = tileMesh(v.indicator, true);
      m.scale.setScalar(FLAT);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = readRot;
      m.position.set(0.06, TABLE_Y + 0.01, 0);
      this.gameGroup.add(m);
      if (v.okeyBirTile) {
        const o = tileMesh(v.okeyBirTile, true);
        o.scale.setScalar(FLAT);
        o.rotation.x = -Math.PI / 2;
        o.rotation.z = readRot + 0.3;
        o.position.set(0.07, TABLE_Y + 0.03, 0.01);
        this.gameGroup.add(o);
      }
    }

    // Abwürfe: rechts vom Werfer (zwischen s und s+1)
    for (let s = 0; s < 4; s++) {
      const a = seatPos(s);
      const b = seatPos((s + 1) % 4);
      const corner = a.clone().add(b).multiplyScalar(0.27);
      const pile = v.discards[s];
      const shown = pile.slice(-4);
      shown.forEach((tile, i) => {
        const m = tileMesh(tile, true);
        m.scale.setScalar(FLAT);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = readRot + (i - shown.length + 1) * 0.08;
        m.position.set(corner.x, TABLE_Y + 0.01 + i * 0.021, corner.z);
        const isTop = i === shown.length - 1;
        if (isTop && this.prevDiscards[s] !== undefined && pile.length === this.prevDiscards[s] + 1) {
          const from = seatPos(s).multiplyScalar(0.47);
          this.flyers.push({ m, from: new THREE.Vector3(from.x, TABLE_Y + 0.09, from.z), to: m.position.clone(), t: 0, spin: (Math.random() - 0.5) * 3 });
          m.position.copy(this.flyers[this.flyers.length - 1].from);
        }
        if (isTop && v.mySeat !== null && (s + 1) % 4 === v.mySeat) {
          m.userData.side = true;
          this.clickables.push(m);
        }
        this.gameGroup.add(m);
      });
    }

    this.prevDiscards = v.discards.map((d) => d.length);
    // Köpfe schauen zum Spieler am Zug
    this.avatars.forEach((a, s) => {
      if (!a) return;
      if (s === v.current) a.lookAtYaw(0);
      else {
        const target = seatPos(v.current).multiplyScalar(1.0);
        target.y = 1.3;
        const local = a.root.worldToLocal(target.clone());
        a.lookAtYaw(Math.atan2(local.x, local.z));
      }
    });

    // 101: Kombinationen auf dem Tisch
    const perOwner = [0, 0, 0, 0];
    v.tableMelds.forEach((meld, idx) => {
      const k = perOwner[meld.owner]++;
      const dir = seatPos(meld.owner);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const row = Math.floor(k / 2);
      const colOff = (k % 2 === 0 ? -1 : 1) * 0.2;
      const base = dir.clone().multiplyScalar(0.3 - row * 0.07).add(side.clone().multiplyScalar(colOff));
      const g = new THREE.Group();
      g.userData.meld = idx;
      meld.tiles.forEach((tile, i) => {
        const m = tileMesh(tile, true);
        m.scale.setScalar(1.05);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = readRot;
        const off = (i - (meld.tiles.length - 1) / 2) * 0.039;
        m.position.set(base.x + side.x * off, TABLE_Y + 0.005, base.z + side.z * off);
        m.userData.meld = idx;
        g.add(m);
      });
      this.gameGroup.add(g);
      this.clickables.push(g);
    });

    // Teegläser
    for (const tg of this.teaGlasses) this.gameGroup.add(tg);
  }

  // ------------------------------------------------------------ Fernseher

  setTvVisible(v: boolean) {
    this.tvCss.visible = v;
    this.tvHole.visible = v;
    this.tvScreen.visible = !v;
  }

  // ------------------------------------------------------------ Loop

  private resize() {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.css.setSize(w, h);
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // Kamera
    if (this.camTarget) {
      const pos = this.camTarget.pos;
      let look: THREE.Vector3;
      if (this.focus) look = this.camTarget.look.clone();
      else {
        // frei umschauen: Richtung = zum Tisch + Drehung
        const base = this.camTarget.look.clone().sub(pos).normalize();
        const baseYaw = Math.atan2(base.x, base.z);
        const basePitch = Math.asin(base.y);
        const yaw = baseYaw + this.seatYaw;
        const pitch = Math.max(-1.2, Math.min(1.2, basePitch + this.seatPitch));
        look = pos.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
      }
      const kpos = 1 - Math.pow(0.002, dt);
      this.camera.position.lerp(pos, kpos);
      this.camLook.lerp(look, 1 - Math.pow(0.0005, dt));
      this.camera.lookAt(this.camLook);
    } else {
      const speed = 2.2 * dt;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.walkPos.addScaledVector(fwd, speed);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.walkPos.addScaledVector(fwd, -speed);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.walkPos.addScaledVector(right, -speed);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.walkPos.addScaledVector(right, speed);
      // Grenzen + Tisch
      this.walkPos.x = Math.max(-ROOM.w / 2 + 0.4, Math.min(ROOM.w / 2 - 0.4, this.walkPos.x));
      this.walkPos.z = Math.max(-ROOM.d / 2 + 1.2, Math.min(ROOM.d / 2 - 0.4, this.walkPos.z));
      const flat = new THREE.Vector2(this.walkPos.x, this.walkPos.z);
      if (flat.length() < 1.25) {
        flat.setLength(1.25);
        this.walkPos.x = flat.x;
        this.walkPos.z = flat.y;
      }
      this.walkPos.y = 1.6 + Math.sin(t * 8) * (this.keys.size ? 0.015 : 0);
      this.camera.position.lerp(this.walkPos, 0.3);
      const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      this.camera.lookAt(this.camera.position.clone().add(look));
      // Hover über Stühlen
      this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      const hit = this.raycaster.intersectObjects(this.chairs, true)[0];
      const hs = hit && hit.distance < 4 ? hit.object.userData.seat : -1;
      if (hs !== this.hoverChair) {
        this.hoverChair = hs;
        this.chairs.forEach((c, i) =>
          c.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (m?.emissive) m.emissive.set(i === hs ? '#5a3a00' : '#000000');
          }),
        );
      }
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.camera.position.y += Math.sin(t * 90) * 0.004;
    }

    // geworfene Steine fliegen im Bogen auf den Abwurfstapel
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t = Math.min(1, f.t + dt / 0.38);
      const e = 1 - Math.pow(1 - f.t, 3);
      f.m.position.lerpVectors(f.from, f.to, e);
      f.m.position.y += Math.sin(f.t * Math.PI) * 0.12;
      if (f.t >= 1) {
        this.flyers.splice(i, 1);
        sfx.tile();
      }
    }
    this.fan.rotation.y += dt * 2.5;
    if (this.clockHands) {
      const d = new Date();
      this.clockHands.h.rotation.z = -((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6);
      this.clockHands.m.rotation.z = -d.getMinutes() * (Math.PI / 30);
    }
    for (const a of this.avatars) a?.update(dt);
    for (const n of this.npcs) {
      n.update(dt);
      if (Math.random() < dt * 0.04) n.emote(['tea', 'nargile', 'headshake', 'tespih', 'slam'][Math.floor(Math.random() * 5)]);
    }
    this.updateCaycı(dt);
    if (Math.random() < dt * 0.05) sfx.murmur();
    // Rauch
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.life += dt;
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(0.995);
      p.s.scale.setScalar((0.06 + 0.06 * p.amount) + p.life * 0.22 * (0.5 + p.amount * 0.5));
      (p.s.material as THREE.SpriteMaterial).opacity = 0.55 * p.amount * (1 - p.life / p.max) * Math.min(1, p.life * 6);
      if (p.life >= p.max) {
        this.scene.remove(p.s);
        this.smoke.splice(i, 1);
      }
    }
    for (const sh of [...this.decoShishas, ...this.seatShishas]) {
      if (!sh) continue;
      animateShisha(sh, t);
      if (settings.smoke && Math.random() < dt * 0.25) this.puff(sh.position.clone().add(new THREE.Vector3(0, 0.84, 0)), 1, new THREE.Vector3(0, 0.12, 0), 0.5);
    }
    if (Math.random() < dt * 0.02) this.applyTimeOfDay();

    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
  }

  private updateCaycı(dt: number) {
    const st = this.cayciState;
    const home = new THREE.Vector3(3.6, 0, -3.2);
    const near = new THREE.Vector3(0.9, 0, -1.2);
    st.t -= dt;
    const moveTo = (target: THREE.Vector3) => {
      const d = target.clone().sub(st.pos);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.05) return true;
      d.setLength(Math.min(dist, dt * 1.1));
      st.pos.add(d);
      facing(this.cayci.root, -d.x, -d.z);
      this.cayci.root.position.y = Math.abs(Math.sin(performance.now() / 150)) * 0.03;
      return false;
    };
    if (st.phase === 'idle' && st.t <= 0) st.phase = 'go';
    else if (st.phase === 'go' && moveTo(near)) {
      st.phase = 'serve';
      st.t = 2;
      facing(this.cayci.root, -near.x, -near.z);
      sfx.spoon();
      this.serveTea();
    } else if (st.phase === 'serve' && st.t <= 0) st.phase = 'back';
    else if (st.phase === 'back' && moveTo(home)) {
      st.phase = 'idle';
      st.t = 70 + Math.random() * 60;
      facing(this.cayci.root, 0, 1);
      this.cayci.root.position.y = 0;
    }
    this.cayci.root.position.x = st.pos.x;
    this.cayci.root.position.z = st.pos.z;
    this.cayci.update(dt);
  }

  private serveTea() {
    this.teaGlasses = [];
    for (let s = 0; s < 4; s++) {
      if (!this.avatars[s] && this.seated !== s) continue;
      const a = seatPos(s);
      const b = seatPos((s + 3) % 4);
      const p = a.clone().multiplyScalar(0.42).add(b.clone().multiplyScalar(0.36));
      this.teaGlasses.push(this.teaGlassMesh(new THREE.Vector3(p.x, TABLE_Y, p.z)));
    }
    if (this.visual) this.setGame(this.visual);
    else this.teaGlasses.forEach((g) => this.gameGroup.add(g));
  }

  /** Charakter-Vorschau (Editor) */
  static preview(container: HTMLElement, spec: Avatar, name: string) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#fff4e0', '#553322', 1.4));
    const dl = new THREE.DirectionalLight('#ffffff', 1.2);
    dl.position.set(1, 2, 2);
    scene.add(dl);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    cam.position.set(0.18, 0.85, 2.5);
    cam.lookAt(0.18, 0.6, 0);
    let a = new Avatar3D(spec, name);
    scene.add(a.root);
    let sh = makeShisha((spec.shisha as ShishaStyle) ?? 'classic');
    sh.position.set(0.62, -0.45, 0.05);
    scene.add(sh);
    container.append(r.domElement);
    let rot = 0.4;
    let running = true;
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      r.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    const clock = new THREE.Clock();
    r.setAnimationLoop(() => {
      if (!running) return;
      const dt = clock.getDelta();
      rot += dt * 0.4;
      a.root.rotation.y = Math.sin(rot) * 0.6;
      a.update(dt);
      r.render(scene, cam);
    });
    return {
      update(s: Avatar, n: string) {
        scene.remove(a.root);
        a = new Avatar3D(s, n);
        scene.add(a.root);
        scene.remove(sh);
        sh = makeShisha((s.shisha as ShishaStyle) ?? 'classic');
        sh.position.set(0.62, -0.45, 0.05);
        scene.add(sh);
      },
      emote(k: string) {
        a.emote(k);
      },
      dispose() {
        running = false;
        r.setAnimationLoop(null);
        r.dispose();
        r.domElement.remove();
      },
      resize,
    };
  }
}
