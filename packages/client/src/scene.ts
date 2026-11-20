// Die 3D-Welt: Kahvehane, Tisch, Spieler, NPCs, Rauch, Fernseher.

import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Tile } from '@okeyhane/engine';
import type { Avatar, PlayerInfo } from '../../server/src/protocol.ts';
import { Avatar3D } from './avatar.ts';
import { City } from './city.ts';
import { tileMesh } from './tileArt.ts';
import { cardMesh, setCardUploader, type PCard } from './cardArt.ts';
import * as D from './decor.ts';
import { settings, onSettings } from './settings.ts';
import { sfx } from './sound.ts';
import { makeShisha, animateShisha, type ShishaStyle } from './props.ts';
import { placeModel, loadModel } from './models.ts';

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

const ROOM = { w: 13, d: 10, h: 3.4 };
/** Garten vor dem Eingang (Südseite) */
const GARDEN = { z0: ROOM.d / 2, z1: ROOM.d / 2 + 5.6 };
/** Tische, an denen gespielt werden kann */
export const SPOTS = [
  { x: 0, z: 0, tr: 'Orta masa', de: 'Mitteltisch' },
  { x: 4.6, z: -0.9, tr: 'Pencere kenarı', de: 'Am Fenster' },
  { x: -2.9, z: ROOM.d / 2 + 2.7, tr: 'Bahçe · sol', de: 'Garten links' },
  { x: 2.9, z: ROOM.d / 2 + 2.7, tr: 'Bahçe · sağ', de: 'Garten rechts' },
];
/** Grafik „niedrig“ beim Laden (Lichter, Gäste, Außenwelt werden dann sparsamer gebaut) */
const LOW = settings.quality === 'low';
/** Bestellbares beim Çaycı (rein kosmetisch) */
export const ORDER_ITEMS = ['cay', 'kahve', 'kuruyemis', 'su', 'icecek', 'oralet', 'sahlep'] as const;
/** Dosen in /models/items/drinks.glb (Reihenfolge = variant vom Server) */
const DRINKS = ['redbull', 'cola', 'colazero', 'drpepper', 'pepsi', 'pepsizero', 'sprite'];
export type OrderItem = (typeof ORDER_ITEMS)[number];

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
  /** wer die Hand beendet hat (sein letzter Stein liegt in der Mitte) */
  finisher?: number | null;
}

export class World {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.05, 200);
  renderer: THREE.WebGLRenderer;
  css: CSS3DRenderer;
  private clock = new THREE.Clock();
  private avatars: (Avatar3D | null)[] = [null, null, null, null];
  private avatarSpecs: string[] = ['', '', '', ''];
  private chairs: THREE.Group[] = [];
  /** alles, was zum Spieltisch gehört (Spieler, Steine, Bestellungen) – sitzt am gewählten Tisch */
  private tableRoot = new THREE.Group();
  private itemsGroup = new THREE.Group();
  private orders: THREE.Object3D[][] = [[], [], [], []];
  spot = 0;
  private spotMeshes: THREE.Object3D[][] = [];
  private gameGroup = new THREE.Group();
  private clickables: THREE.Object3D[] = [];
  private smoke: { s: THREE.Sprite; v: THREE.Vector3; life: number; max: number; amount: number }[] = [];
  private smokeTex = D.smokeSprite();
  private npcs: Avatar3D[] = [];
  private cayci!: Avatar3D;
  private cayciState = { t: 20, phase: 'idle' as 'idle' | 'go' | 'serve' | 'back', pos: new THREE.Vector3(3.6, 0, -3.2), clearSeat: null as number | null, clearCheck: 30 };
  private fan!: THREE.Object3D;
  private clockHands: { h: THREE.Object3D; m: THREE.Object3D } | null = null;
  private windowMesh!: THREE.Mesh;
  private ambient!: THREE.HemisphereLight;
  private lamps: THREE.PointLight[] = [];
  /** mehrere Fernseher, alle zeigen dasselbe (vom Tisch gesteuert) */
  private tvs: { host: HTMLDivElement; css: CSS3DObject; screen: THREE.Mesh; hole: THREE.Mesh; pos: THREE.Vector3; rotY: number; w: number; h: number; group: THREE.Group }[] = [];
  get tvHosts() {
    return this.tvs.map((t) => t.host);
  }
  /** Fernseh-Modus: Kamera vor einen Fernseher, Bild füllt den Schirm */
  tvWatch: number | null = null;
  onTvWatch: ((i: number | null) => void) | null = null;
  watchTv(i: number | null) {
    if (i === this.tvWatch) return;
    if (i !== null && this.tvWatch === null) {
      // Blickpunkt dort starten, wo die Kamera gerade hinschaut (weicher Schwenk)
      const fwd = this.camera.getWorldDirection(new THREE.Vector3());
      this.camLook.copy(this.camera.position).addScaledVector(fwd, this.camera.position.distanceTo(this.tvs[i].pos));
    }
    this.tvWatch = i;
    if (i !== null) document.exitPointerLock?.();
    this.onTvWatch?.(i);
  }
  /** Fernseher unter dem Zeiger (nicht zu weit weg) */
  private tvAt(ndc: THREE.Vector2): number | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.tvs.map((t) => t.group), true)[0];
    if (!hit || hit.distance > 16) return null;
    // nichts dazwischen (Wand, Säule …)?
    let o: THREE.Object3D | null = hit.object;
    while (o && !this.tvs.some((t) => t.group === o)) o = o.parent;
    const idx = this.tvs.findIndex((t) => t.group === o);
    return idx >= 0 ? idx : null;
  }
  /** Kamera-Ziel für den Fernseh-Modus: so weit weg, dass der Schirm gerade das Bild füllt */
  private tvView(i: number) {
    const tv = this.tvs[i];
    const half = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const tan = Math.tan(half);
    const d = Math.max(tv.h / 2 / tan, tv.w / 2 / (tan * this.camera.aspect)) * 1.06;
    const n = new THREE.Vector3(Math.sin(tv.rotY), 0, Math.cos(tv.rotY));
    return { pos: tv.pos.clone().addScaledVector(n, d), look: tv.pos.clone() };
  }
  private dayMode = '';
  // Bewegung
  seated: number | null = null;
  private walkPos = new THREE.Vector3(0, 1.6, ROOM.d / 2 - 1.2);
  private yaw = 0;
  private pitch = -0.1;
  private keys = new Set<string>();
  private camTarget: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private camLook = new THREE.Vector3(0, 1, 0);
  // Callbacks
  onChair: ((seat: number, spot: number) => void) | null = null;
  onPile: (() => void) | null = null;
  onSide: (() => void) | null = null;
  onMeld: ((index: number) => void) | null = null;
  private hoverChair = -1;
  private hoverChairObj: THREE.Object3D | null = null;
  /** analoge Bewegung (Touch-Joystick / Controller): x = rechts, y = vorwärts */
  moveInput = { x: 0, y: 0 };
  /** letzte Zeigerart (mouse / touch / pen) */
  pointerType = 'mouse';
  private boardHover = false;
  /** wird gerade ein Stuhl angeschaut? */
  get lookingAtChair() {
    return this.hoverChair;
  }
  private visual: GameVisual | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = settings.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : 1));
    setCardUploader((t) => this.renderer.initTexture(t));
    this.css = new CSS3DRenderer();
    this.css.domElement.className = 'css3d';
    this.renderer.domElement.className = 'gl';
    container.append(this.css.domElement, this.renderer.domElement);


    this.buildRoom();
    this.buildGarden();
    SPOTS.forEach((_, i) => this.buildTable(i));
    this.buildNpcs();
    this.scene.add(this.tableRoot);
    this.tableRoot.add(this.gameGroup, this.itemsGroup);
    for (let s = 0; s < 4; s++) this.buildSehpa(s);
    this.buildZones();
    this.applyTimeOfDay();
    onSettings(() => {
      this.applyTimeOfDay();
      this.renderer.shadowMap.enabled = settings.quality === 'high';
    });

    addEventListener('resize', () => this.resize());
    // iOS/App: nach Drehen oder Start im Vollbild stimmt die erste Größe oft nicht → mehrfach nachmessen
    window.visualViewport?.addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => [100, 400, 1000].forEach((ms) => setTimeout(() => this.resize(), ms)));
    new ResizeObserver(() => this.resize()).observe(this.container);
    [300, 1500].forEach((ms) => setTimeout(() => this.resize(), ms));
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
    // Fenster (Ostwand) – zwei große Fenster mit Blick auf die Gasse
    const winMat = new THREE.MeshBasicMaterial({ map: D.cityWindow('day') });
    for (const wz of [SPOTS[1].z, 2.9]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), winMat);
      win.position.set(w / 2 - 0.04, 1.9, wz);
      win.rotation.y = -Math.PI / 2;
      this.scene.add(win);
      this.windowMesh = win;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.75, 2.55), new THREE.MeshStandardMaterial({ color: '#5a3a22' }));
      frame.position.set(w / 2 - 0.02, 1.9, wz);
      this.scene.add(frame);
      // Sprossen + Fensterbank mit Geranien
      for (const dz of [-0.4, 0.4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.6, 0.04), new THREE.MeshStandardMaterial({ color: '#5a3a22' }));
        bar.position.set(w / 2 - 0.06, 1.9, wz + dz);
        this.scene.add(bar);
      }
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 2.6), new THREE.MeshStandardMaterial({ color: '#4a2e1a' }));
      sill.position.set(w / 2 - 0.15, 1.08, wz);
      this.scene.add(sill);
      for (const dz of [-0.8, 0.85]) this.scene.add(this.flowerPot(new THREE.Vector3(w / 2 - 0.16, 1.1, wz + dz), 0.11));
    }

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
    for (let i = 0; i < 2; i++) picFrame(D.portrait(i + 7), w / 2 - 0.03, 2.1, -4.1 + i * 0.8, -Math.PI / 2, 0.5, 0.66);
    for (let i = 0; i < 2; i++) picFrame(D.portrait(i + 4), -w / 2 + 0.03, 2.1, 3.6 + i * 0.75, Math.PI / 2, 0.5, 0.66);
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

    // Fernseher: Nordwand (Haupt-TV), Westwand, außen an der Fassade für den Garten (links + rechts)
    this.addTv(new THREE.Vector3(-1.2, 2.25, -d / 2 + 0.12), 0, 2.0);
    this.addTv(new THREE.Vector3(-w / 2 + 0.12, 2.2, 0.75), Math.PI / 2, 1.4);
    this.addTv(new THREE.Vector3(-3.6, 2.88, d / 2 + 0.16), 0, 1.25, true);
    this.addTv(new THREE.Vector3(3.6, 2.88, d / 2 + 0.16), 0, 1.25, true);

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
      [3, 2.6],
      [-3, -2],
      [SPOTS[1].x - 0.6, SPOTS[1].z],
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
      // Grafik „niedrig“: nur das Licht über dem Haupttisch ist echt (Rest = Grundhelligkeit)
      if (LOW && !(x === 0 && z === 0)) continue;
      const l = new THREE.PointLight('#ffcf8a', 2.2, LOW ? 9 : 7, 1.6);
      l.position.set(x + 0.6, ROOM.h - 1.3, z);
      l.castShadow = x === 0 && z === 0;
      if (l.castShadow) l.shadow.mapSize.set(1024, 1024);
      this.scene.add(l);
      this.lamps.push(l);
    }
    this.buildFacade();
    // Lokum-Teller auf der Theke (Sketchfab: nur_ay)
    const lokum = new THREE.Group();
    placeModel(lokum, 'lokum', 0.45, 'width');
    lokum.position.set(1.75, 1.1, -d / 2 + 0.72);
    this.scene.add(lokum);
    // Atatürk-Büste auf Sockel unter der Fahne (3D-Druck-Modell: metdiu3dprint)
    const ped = new THREE.Group();
    const marble = new THREE.MeshStandardMaterial({ color: '#e9e4da', roughness: 0.35 });
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.05, 0.36), marble);
    col.position.y = 0.525;
    col.castShadow = col.receiveShadow = true;
    const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.44), marble);
    capTop.position.y = 1.08;
    const capBot = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.44), marble);
    capBot.position.y = 0.04;
    ped.add(col, capTop, capBot);
    const bust = new THREE.Group();
    bust.position.y = 1.11;
    placeModel(bust, 'ataturk', 0.5, 'height', {
      upZ: true,
      material: new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.75, roughness: 0.35 }),
    });
    ped.add(bust);
    ped.position.set(-3.4, 0, -d / 2 + 0.35);
    this.scene.add(ped);
    // Läufer am Eingang (Sketchfab: mfb64)
    const runner = new THREE.Group();
    placeModel(runner, 'carpet', 2.6, 'width', { layFlat: true });
    runner.position.set(0, 0.006, d / 2 - 1.1);
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


  /** Vorderfront (Süd): Schaufenster, offene Tür, Schild außen */
  private buildFacade() {
    const { w, d, h } = ROOM;
    const z = d / 2;
    const inner = new THREE.MeshStandardMaterial({ color: '#e6d6b4', roughness: 0.95 });
    const outer = new THREE.MeshStandardMaterial({ color: '#d8c19a', roughness: 0.95 });
    const tiles = new THREE.MeshStandardMaterial({ map: D.wallTiles(), roughness: 0.6 });
    const stone = new THREE.MeshStandardMaterial({ color: '#8d8274', roughness: 1 });
    const wood = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.6 });
    const piece = (x0: number, x1: number, y0: number, y1: number, lower = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.18), [inner, inner, inner, inner, lower ? stone : outer, lower ? tiles : inner]);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    const W = w / 2;
    piece(-W, -0.7, 0, 0.9, true);
    piece(0.7, W, 0, 0.9, true);
    piece(-W, W, 2.35, h);
    for (const [a, b] of [
      [-W, -5.6],
      [-1.6, -0.7],
      [0.7, 1.6],
      [5.6, W],
    ])
      piece(a, b, 0.9, 2.35);
    // Schaufenster
    const glass = new THREE.MeshStandardMaterial({ color: '#bcd6e0', transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false });
    for (const cx of [-3.6, 3.6]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.45), glass);
      g.position.set(cx, 1.625, z);
      this.scene.add(g);
      for (let k = 0; k <= 4; k++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.45, 0.06), wood);
        bar.position.set(cx - 2 + k, 1.625, z);
        this.scene.add(bar);
      }
      for (const yy of [0.92, 2.33, 1.95]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, 0.07), wood);
        bar.position.set(cx, yy, z);
        this.scene.add(bar);
      }
      // Fensterbrett innen mit Teegläsern
      const sill = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, 0.3), wood);
      sill.position.set(cx, 0.92, z - 0.2);
      this.scene.add(sill);
    }
    // Tür: offen nach innen geklappt
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.25, 0.06), new THREE.MeshStandardMaterial({ color: '#4a2e1a' }));
    door.rotation.y = Math.PI / 2;
    door.position.set(-0.68, 1.125, z - 0.6);
    this.scene.add(door);
    const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.9), new THREE.MeshStandardMaterial({ color: '#c8dde8', transparent: true, opacity: 0.5 }));
    doorGlass.rotation.y = Math.PI / 2;
    doorGlass.position.set(-0.64, 1.6, z - 0.6);
    this.scene.add(doorGlass);
    // Schild außen + Laternen
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.62), new THREE.MeshStandardMaterial({ map: D.signText('OKEYHANE'), emissive: '#3a1008', emissiveIntensity: 0.5 }));
    sign.position.set(0, 2.88, z + 0.1);
    this.scene.add(sign);
    for (const lx of [-1.0, 1.0]) {
      const lan = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 6), new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffb050', emissiveIntensity: 0.8 }));
      lan.position.set(lx, 2.1, z + 0.18);
      this.scene.add(lan);
    }
  }

  private bulbs: THREE.Mesh[] = [];
  private sun!: THREE.DirectionalLight;
  private skyDome!: THREE.Mesh;
  private houses: THREE.Mesh[] = [];
  private gardenLamps: THREE.PointLight[] = [];
  private cat: THREE.Group | null = null;
  private city!: City;
  private streetGlows: THREE.Sprite[] = [];
  private streetBulbs: THREE.Mesh[] = [];
  private pigeons: THREE.Group[] = [];
  /** Garten vor dem Kahvehane: Pflaster, Platane, Markise, Lichterkette, Blumenkästen, Gasse */
  private buildGarden() {
    const { w } = ROOM;
    const { z0, z1 } = GARDEN;
    const gd = z1 - z0;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, gd), new THREE.MeshStandardMaterial({ map: D.cobble(), roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.002, z0 + gd / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // echte 3D-Stadt: Straße, Gehwege, Häuserzeilen, Bäume, Ampeln, Autos, Sonne/Mond
    this.city = new City(z1, w / 2, ROOM.d / 2, LOW);
    this.scene.add(this.city.group);
    // Straßenlaternen (leuchten abends) + geparkte Autos + Tauben
    const lampPost = new THREE.MeshStandardMaterial({ color: '#2b2f3a', roughness: 0.5, metalness: 0.4 });
    for (const [lx, lz] of [
      [-5.6, z1 + 0.7],
      [5.6, z1 + 0.7],
      [-2.5, z1 + 8.4],
      [3.5, z1 + 8.4],
      [-9.5, z1 + 0.7],
      [9.5, z1 + 0.7],
    ]) {
      const g3 = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.2, 10), lampPost);
      post.position.y = 2.1;
      const arm = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 6, 16, Math.PI / 2), lampPost);
      arm.position.set(0.45, 4.2, 0);
      arm.rotation.z = Math.PI / 2;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 0.18, 12), lampPost);
      head.position.set(0.9, 4.18, 0);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffe3a3' }));
      bulb.position.set(0.9, 4.06, 0);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: '#ffcf6a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(2.2);
      glow.position.set(0.9, 4.0, 0);
      g3.add(post, arm, head, bulb, glow);
      g3.position.set(lx, 0, lz);
      g3.rotation.y = lz > z1 + 4 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(g3);
      this.streetGlows.push(glow);
      this.streetBulbs.push(bulb);
    }
    // Tauben auf dem Pflaster
    for (let i = 0; i < 5; i++) {
      const pg = new THREE.Group();
      const grey = new THREE.MeshStandardMaterial({ color: ['#8a8f99', '#6f747d', '#a2a6ae'][i % 3], roughness: 0.9 });
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), grey);
      b.scale.set(1, 0.8, 1.5);
      b.position.y = 0.1;
      const hd = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), grey);
      hd.position.set(0, 0.18, 0.11);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.04, 6), new THREE.MeshStandardMaterial({ color: '#d9a03a' }));
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.18, 0.17);
      pg.add(b, hd, beak);
      pg.position.set(-1.5 + i * 0.7 + Math.sin(i) * 0.3, 0, z1 + 1.4 + Math.cos(i * 2) * 0.6);
      pg.rotation.y = i * 1.3;
      pg.userData.head = hd;
      pg.userData.beak = beak;
      this.scene.add(pg);
      this.pigeons.push(pg);
    }

    // Moschee-Silhouette in der Ferne
    const mosque = new THREE.Group();
    const stoneM = new THREE.MeshStandardMaterial({ color: '#cfc6b8', roughness: 1 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), stoneM);
    dome.position.y = 9;
    const base = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 10), stoneM);
    base.position.y = 4.5;
    mosque.add(dome, base);
    for (const mx of [-7, 7]) {
      const min = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 22, 12), stoneM);
      min.position.set(mx, 11, 0);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3, 12), new THREE.MeshStandardMaterial({ color: '#6b7a8a' }));
      cap.position.set(mx, 23.5, 0);
      mosque.add(min, cap);
    }
    mosque.position.set(-22, 0, z1 + 38);
    mosque.scale.setScalar(1.3);
    this.scene.add(mosque);
    // Himmel
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), new THREE.MeshBasicMaterial({ map: D.sky('day'), side: THREE.BackSide, fog: false }));
    this.scene.add(this.skyDome);
    this.sun = new THREE.DirectionalLight('#fff2d8', 0.8);
    this.sun.position.set(8, 14, 20);
    this.scene.add(this.sun);
    // Blumenkästen am Rand (mit Durchgang zur Gasse)
    const box = new THREE.MeshStandardMaterial({ color: '#b5a48a', roughness: 1 });
    const planter = (x: number, zz: number, lx: number, lz: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(lx, 0.55, lz), box);
      b.position.set(x, 0.275, zz);
      b.castShadow = true;
      this.scene.add(b);
      const n = Math.round(Math.max(lx, lz) / 0.45);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        const p = new THREE.Vector3(x + (lx > lz ? t * lx : 0), 0.62, zz + (lz > lx ? t * lz : 0));
        this.scene.add(this.flowerPot(p, 0.13, true));
      }
    };
    planter(-(w / 2 + 1.0) / 2 - 0.25, z1 - 0.2, w / 2 - 1.2, 0.4);
    planter((w / 2 + 1.0) / 2 + 0.25, z1 - 0.2, w / 2 - 1.2, 0.4);
    planter(-w / 2 + 0.2, z0 + gd / 2, 0.4, gd - 0.6);
    planter(w / 2 - 0.2, z0 + gd / 2, 0.4, gd - 0.6);
    // Platane (Çınar) mit Rundbank
    const bark = new THREE.MeshStandardMaterial({ color: '#7b6a55', roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 3.6, 12), bark);
    trunk.position.set(0, 1.8, z1 - 1.3);
    trunk.castShadow = true;
    this.scene.add(trunk);
    // Krone aus vielen kleinen Blattbüscheln in mehreren Grüntönen (leichtes Eigenleuchten,
    // damit sie von unten nicht braun/dunkel wirkt) + ein paar Äste
    const greens = ['#5f9440', '#4f8636', '#6aa34a', '#457a2f', '#78b052'];
    const leafMats = greens.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, emissive: '#1d3a12', emissiveIntensity: 0.35, flatShading: true }));
    const tz = z1 - 1.3;
    for (const [ax, az] of [
      [1, 0.3],
      [-1, 0.2],
      [0.2, -1],
      [-0.3, 1],
    ]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 1.6, 8), bark);
      br.position.set(ax * 0.45, 3.6, tz + az * 0.45);
      br.rotation.set(az * 0.7, 0, -ax * 0.7);
      this.scene.add(br);
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 26; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = 0.3 + rnd() * 1.7;
      const y = 3.7 + rnd() * 1.9 - rad * 0.25;
      const r = 0.55 + rnd() * 0.55;
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMats[i % leafMats.length]);
      f.position.set(Math.cos(ang) * rad, y, tz + Math.sin(ang) * rad);
      f.scale.y = 0.75;
      f.rotation.set(rnd() * 3, rnd() * 3, 0);
      f.castShadow = true;
      this.scene.add(f);
    }
    const bench = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 6, 20), new THREE.MeshStandardMaterial({ color: '#7a4b2a' }));
    bench.rotation.x = Math.PI / 2;
    bench.scale.z = 0.4;
    bench.position.set(0, 0.45, z1 - 1.3);
    this.scene.add(bench);
    // Markise über dem Eingang
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, 2.2), new THREE.MeshStandardMaterial({ map: D.awning(), side: THREE.DoubleSide, roughness: 0.9 }));
    aw.position.set(0, 2.82, z0 + 1.0);
    aw.rotation.x = -Math.PI / 2 + 0.22;
    this.scene.add(aw);
    // Lichterkette: Markise → Platane
    const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
    const string = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        pts.push(p);
      }
      const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.006, 4), new THREE.MeshBasicMaterial({ color: '#222' }));
      this.scene.add(wire);
      pts.forEach((p, i) => {
        if (i % 2) return;
        const bl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bulbMat);
        bl.position.copy(p).add(new THREE.Vector3(0, -0.05, 0));
        this.scene.add(bl);
        this.bulbs.push(bl);
      });
    };
    const tree = new THREE.Vector3(0, 3.3, z1 - 1.3);
    for (const sx of [-1, 1]) {
      string(new THREE.Vector3(sx * (w / 2 - 0.5), 2.5, z0 + 2.0), tree, 0.45);
      string(new THREE.Vector3(sx * (w / 2 - 0.5), 2.5, z0 + 2.0), new THREE.Vector3(sx * (w / 2 - 0.4), 2.2, z1 - 0.3), 0.3);
    }
    for (const sp of SPOTS.slice(2)) {
      if (LOW) break;
      const l = new THREE.PointLight('#ffcf8a', 0, 6, 1.6);
      l.position.set(sp.x, 2.6, sp.z);
      this.scene.add(l);
      this.gardenLamps.push(l);
    }
    // Sokak kedisi auf dem Blumenkasten
    this.cat = this.makeCat();
    this.cat.position.set(-w / 2 + 0.2, 0.55, z0 + 1.4);
    this.cat.rotation.y = 0.6;
    this.scene.add(this.cat);
  }

  /** Blumentopf mit Geranien (Sardunya) */
  private flowerPot(pos: THREE.Vector3, r: number, noPot = false) {
    const g = new THREE.Group();
    if (!noPot) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.75, r * 1.4, 12), new THREE.MeshStandardMaterial({ color: '#b5603a', roughness: 0.9 }));
      pot.position.y = r * 0.7;
      g.add(pot);
    }
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.15, 1), new THREE.MeshStandardMaterial({ color: '#3f6b32', roughness: 1 }));
    bush.position.y = noPot ? 0.02 : r * 1.6;
    g.add(bush);
    const cols = ['#d6233a', '#e8507a', '#f2f2f2', '#d6233a'];
    for (let i = 0; i < 6; i++) {
      const fl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.32, 8, 6), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.7 }));
      const a = (i / 6) * Math.PI * 2;
      fl.position.set(Math.cos(a) * r * 0.75, bush.position.y + r * 0.6 + (i % 2) * r * 0.25, Math.sin(a) * r * 0.75);
      g.add(fl);
    }
    g.position.copy(pos);
    return g;
  }

  /** schlafende Straßenkatze */
  private makeCat() {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: '#c98a3e', roughness: 1 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), fur);
    body.scale.set(1, 0.6, 1.4);
    body.position.y = 0.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), fur);
    head.position.set(0, 0.12, 0.22);
    g.add(body, head);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 6), fur);
      ear.position.set(0.045 * s, 0.2, 0.22);
      g.add(ear);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: '#222' }));
      eye.position.set(0.03 * s, 0.13, 0.302);
      g.add(eye);
    }
    const tail = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.08, -0.2), new THREE.Vector3(0.15, 0.05, -0.15), new THREE.Vector3(0.2, 0.05, 0.05)]), 12, 0.025, 6),
      fur,
    );
    g.add(tail);
    return g;
  }

  /** Ein Fernseher mit Rahmen, Standbild und YouTube-Fläche (CSS3D, „Loch“ im WebGL-Bild) */
  private addTv(pos: THREE.Vector3, rotY: number, tvW: number, outside = false) {
    const tvH = (tvW * 9) / 16;
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = rotY;
    const body = new THREE.Mesh(new THREE.BoxGeometry(tvW + 0.12, tvH + 0.12, 0.08), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.4 }));
    body.position.z = -0.05;
    g.add(body);
    if (outside) {
      // kleines Vordach gegen Regen
      const roof = new THREE.Mesh(new THREE.BoxGeometry(tvW + 0.3, 0.04, 0.3), new THREE.MeshStandardMaterial({ color: '#5a3a22' }));
      roof.position.set(0, tvH / 2 + 0.12, 0.08);
      g.add(roof);
    }
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), new THREE.MeshBasicMaterial({ map: D.tvStandby() }));
    screen.position.z = -0.005;
    g.add(screen);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending }));
    hole.visible = false;
    g.add(hole);
    this.scene.add(g);
    g.traverse((o) => (o.userData.tv = true));
    const host = document.createElement('div');
    host.className = 'tv-host';
    host.style.width = '960px';
    host.style.height = '540px';
    const css = new CSS3DObject(host);
    css.position.copy(pos);
    css.rotation.y = rotY;
    css.scale.setScalar(tvW / 960);
    css.visible = false;
    this.scene.add(css);
    this.tvs.push({ host, css, screen, hole, pos: pos.clone(), rotY, w: tvW, h: tvH, group: g });
  }

  /** Index des Fernsehers, der der Kamera am nächsten ist (nur der hat Ton) */
  nearestTv() {
    let best = 0;
    let bd = Infinity;
    this.tvs.forEach((t, i) => {
      const d = t.pos.distanceTo(this.camera.position);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
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

  private buildTable(spot: number) {
    const sp = SPOTS[spot];
    const meshes: THREE.Object3D[] = [];
    const wood = new THREE.MeshStandardMaterial({ color: '#5b3a22', roughness: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 1.2), wood);
    top.position.set(sp.x, TABLE_Y - 0.03, sp.z);
    top.castShadow = top.receiveShadow = true;
    top.userData.table = true;
    top.userData.spot = spot;
    meshes.push(top);
    this.scene.add(top);
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.08), new THREE.MeshStandardMaterial({ map: D.feltTexture(), roughness: 1 }));
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(sp.x, TABLE_Y - 0.004, sp.z);
    felt.receiveShadow = true;
    felt.userData.table = true;
    felt.userData.spot = spot;
    meshes.push(felt);
    this.scene.add(felt);
    for (const [x, z] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, TABLE_Y, 0.06), wood);
      leg.position.set(sp.x + x, TABLE_Y / 2, sp.z + z);
      leg.castShadow = true;
      this.scene.add(leg);
    }
    for (let s = 0; s < 4; s++) {
      const dir = seatPos(s);
      const chair = this.chair();
      chair.position.set(sp.x + dir.x * 1.07, 0, sp.z + dir.z * 1.07);
      facing(chair, dir.x, dir.z);
      chair.traverse((o) => {
        o.userData.seat = s;
        o.userData.spot = spot;
      });
      this.scene.add(chair);
      this.chairs.push(chair);
    }
    this.spotMeshes[spot] = meshes;
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
      post.position.set(x, 0.7, -0.19);
      g.add(post);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.02), wood);
    back.position.set(0, 0.85, -0.19);
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
      { x: 2.7, z: 3.3 },
      { x: -3.3, z: -2.4 },
      { x: -5.2, z: ROOM.d / 2 + 1.1 },
    ];
    spots.forEach((sp, ti) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 24), new THREE.MeshStandardMaterial({ color: '#5b3a22' }));
      t.position.set(sp.x, 0.72, sp.z);
      t.castShadow = true;
      this.scene.add(t);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.72), new THREE.MeshStandardMaterial({ color: '#3b2414' }));
      leg.position.set(sp.x, 0.36, sp.z);
      this.scene.add(leg);
      if (ti !== 2 && ti !== 3) {
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
      if (ti === 3) {
        // Garten: Backgammon-Spieler mit Kaffee
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.34), new THREE.MeshStandardMaterial({ color: '#8a5a2a' }));
        board.position.set(sp.x, 0.755, sp.z);
        this.scene.add(board);
      }
      for (let k = 0; k < n; k++) {
        const side = k === 0 ? -1 : 1;
        const chair = this.chair();
        chair.position.set(sp.x + side * 0.65, 0, sp.z);
        facing(chair, side, 0);
        this.scene.add(chair);
        // Grafik „niedrig“: Nebentische ohne Gäste (spart viel Leistung)
        if (LOW) continue;
        // jeder zweite Gast ist eine realistische Figur
        const gi = ti * 2 + k;
        const guests = ['TeacherM', 'Businessman', 'TeacherF', 'Worker', 'StudentM', 'Mechanic', 'StudentF', 'Engineer'];
        const spec = this.randomSpec(gi + 3);
        if (gi % 2 === 0 && settings.quality !== 'low') Object.assign(spec, { style: 'real', realBase: guests[(gi / 2) % guests.length] });
        const a = new Avatar3D(spec, '', { showName: false });
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
      // Ahmet: „hoch“ = Avaturn-Figur, „niedrig“ = leichter Cartoon-Çaycı
      { ...this.randomSpec(11), shirt: 'gomlek', shirtColor: '#f2efe6', hat: 'none', mustache: 'thick', accessory: 'none', ...(settings.quality === 'high' ? { style: 'real' as const, realBase: 'ahmet' } : {}) },
      'Ahmet',
      { showName: true, standing: true },
    );
    this.cayci.root.scale.setScalar(0.88);
    // Bestell-Modelle vorladen, damit die erste Bestellung sofort echt aussieht
    for (const f of ['cay', 'su', 'kuruyemis', 'drinks']) void loadModel('items/' + f).catch(() => {});
    this.cayci.root.position.copy(this.cayciState.pos);
    this.scene.add(this.cayci.root);
    // Tablett
    const trayG = new THREE.Group();
    trayG.position.set(0.25, 0.85, 0.3);
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.01, 20), new THREE.MeshStandardMaterial({ color: '#c0c0c0', metalness: 0.8, roughness: 0.3 }));
    trayG.add(tray);
    for (let i = 0; i < 3; i++) trayG.add(this.teaGlassMesh(new THREE.Vector3(-0.05 + i * 0.05, 0.01, 0)));
    this.cayci.root.add(trayG);
    this.cayciTray = trayG;
  }

  // ------------------------------------------------------------ Tageszeit

  applyTimeOfDay() {
    let mode = settings.timeOfDay as string;
    if (mode === 'auto') {
      const h = new Date().getHours();
      mode = h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'evening' : 'night';
    }
    // Sonne/Mond: bei „Auto“ echte Uhrzeit, sonst feste Zeit passend zur Stimmung
    const now = new Date();
    const hour = settings.timeOfDay === 'auto' ? now.getHours() + now.getMinutes() / 60 : mode === 'day' ? 13 : mode === 'evening' ? 18.6 : 23;
    if (this.city) {
      this.city.setMode(mode as any, hour);
      const dir = mode === 'night' ? this.city.moonDir() : this.city.sunDir;
      this.sun.position.copy(dir).multiplyScalar(30);
      if (mode === this.dayMode) return;
    }
    if (mode === this.dayMode) return;
    this.dayMode = mode;
    (this.windowMesh.material as THREE.MeshBasicMaterial).map = D.cityWindow(mode as any);
    (this.windowMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    const skyM = this.skyDome.material as THREE.MeshBasicMaterial;
    skyM.map = D.sky(mode as any);
    skyM.needsUpdate = true;
    for (const hm of this.houses) {
      const m = hm.material as THREE.MeshStandardMaterial;
      m.map = D.houseFacade(hm.userData.seed, mode === 'night');
      m.emissive.set(mode === 'night' ? '#221a10' : '#000000');
      m.needsUpdate = true;
    }
    for (const g of this.streetGlows) g.material.opacity = mode === 'day' ? 0 : mode === 'evening' ? 0.45 : 0.8;
    for (const b of this.streetBulbs) (b.material as THREE.MeshBasicMaterial).color.set(mode === 'day' ? '#d8d2bf' : '#ffe3a3');
    this.sun.intensity = mode === 'day' ? 1.1 : mode === 'evening' ? 0.55 : 0.12;
    this.sun.color.set(mode === 'day' ? '#fff2d8' : mode === 'evening' ? '#ffb27a' : '#8fa0ff');
    for (const b of this.bulbs) (b.material as THREE.MeshBasicMaterial).color.set(mode === 'day' ? '#d8c8a8' : '#ffd27a');
    for (const l of this.gardenLamps) l.intensity = mode === 'day' ? 0 : 2.2;
    // weniger echte Lampen bei „niedrig“ → Grundlicht etwas heller
    this.ambient.intensity = (mode === 'day' ? 0.95 : mode === 'evening' ? 0.6 : 0.35) * (LOW ? 1.6 : 1);
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
      if (old) this.tableRoot.remove(old.root);
      this.avatars[s] = null;
      if (this.seatShishas[s]) this.tableRoot.remove(this.seatShishas[s]!);
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
      a.onRing = (pos, d) => s !== this.mySeat && this.rings(pos, d);
      a.onSlam = () => {
        sfx.slam();
        this.shakeT = 0.25;
      };
      a.root.visible = (s !== mySeat || !!this.third) && !this.hiddenSeats.has(s);
      this.tableRoot.add(a.root);
      this.avatars[s] = a;
      // eigene Nargile neben dem Stuhl (Seite des Schlauchs)
      a.root.updateMatrix();
      const sh = makeShisha((p.avatar.shisha as ShishaStyle) ?? 'classic');
      sh.position.copy(new THREE.Vector3(0.5, -0.45, 0.02).applyMatrix4(a.root.matrix));
      sh.rotation.y = a.root.rotation.y + Math.PI / 2;
      this.tableRoot.add(sh);
      this.seatShishas[s] = sh;
    }
  }

  private shakeT = 0;
  private decoShishas: THREE.Group[] = [];
  private seatShishas: (THREE.Group | null)[] = [null, null, null, null];

  emote(seat: number, key: string, ring = false) {
    const av = this.avatars[seat];
    if (av && ring) av.ringNext = true;
    av?.emote(key);
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

  /** Rauchringe: 2–3 Kringel, die wachsen, steigen und verblassen */
  private ringList: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private ringGeo = new THREE.TorusGeometry(0.03, 0.011, 8, 28);
  rings(pos: THREE.Vector3, dir: THREE.Vector3) {
    if (!settings.smoke) return;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#e8e4dc', transparent: true, opacity: 0, depthWrite: false }));
        m.position.copy(pos);
        m.lookAt(pos.clone().add(dir));
        this.scene.add(m);
        this.ringList.push({ m, v: dir.clone().multiplyScalar(0.32).add(new THREE.Vector3(0, 0.05, 0)), life: 0 });
      }, i * 420);
    }
  }

  /** Eigener Rauch/Dampf direkt vor der Kamera (Ego-Perspektive) */
  selfPuff(kind: 'smoke' | 'steam', ring = false) {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const pos = this.camera.position.clone().add(fwd.clone().multiplyScalar(0.42)).add(new THREE.Vector3(0, 0.02, 0));
    if (kind === 'smoke' && ring) {
      this.rings(this.camera.position.clone().add(fwd.clone().multiplyScalar(0.3)).add(new THREE.Vector3(0, -0.04, 0)), fwd.clone().setY(fwd.y + 0.1).normalize());
      return;
    }
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
      this.puff(new THREE.Vector3((Math.random() - 0.5) * 0.8, TABLE_Y + 0.15, (Math.random() - 0.5) * 0.8).add(this.tableRoot.position), 1);
    }
  }

  // ------------------------------------------------------------ Kamera / Bewegung

  /** im Sitzen: true = auf das Brett fixiert, false = frei umschauen */
  focus = true;
  /** per 👁-Knopf freies Umschauen: kein automatisches Zurückfedern */
  freeLook = false;
  private seatYaw = 0;
  private seatPitch = 0;
  onFocusChange: ((focus: boolean) => void) | null = null;

  setFocus(f: boolean, free = false) {
    this.freeLook = !f && free;
    if (this.focus === f) return;
    this.focus = f;
    if (f) {
      this.seatYaw = 0;
      this.seatPitch = 0;
      this.stopLook();
    } else this.startLook();
    this.onFocusChange?.(f);
  }

  sitAt(seat: number | null) {
    this.seated = seat;
    this.lounge = null;
    if (seat === null) {
      this.camTarget = null;
      const sp = SPOTS[this.spot];
      const back = this.spot >= 2 ? -1 : 1;
      this.walkPos.set(sp.x, 1.6, sp.z + 2.2 * back);
      this.yaw = back > 0 ? 0 : Math.PI;
      this.pitch = -0.15;
    } else {
      this.camTarget = this.seatCam(seat);
      this.focus = true;
      this.seatYaw = 0;
      this.seatPitch = 0;
      this.stopLook();
      this.onFocusChange?.(true);
    }
    this.avatars.forEach((a, s) => a && (a.root.visible = s !== this.mySeat || !!this.third));
  }

  /**
   * Kamera am Platz: etwas höher und weiter hinten, Blick ~20° nach unten,
   * damit Tischmitte, Abwürfe UND die Gesichter (v. a. gegenüber) im Bild sind.
   */
  private seatCam(seat: number) {
    const dir = seatPos(seat);
    const off = this.tableRoot.position;
    // Handy: näher ran, damit die Steine auf dem Tisch gut lesbar sind
    const ph = document.body.classList.contains('phone');
    const pos = new THREE.Vector3(dir.x * (ph ? 1.0 : 1.18), ph ? 1.4 : 1.5, dir.z * (ph ? 1.0 : 1.18)).add(off);
    // klassischer Blick aufs Brett; „Blick heben“ schiebt den Zielpunkt Richtung Gegenüber
    const lift = Math.max(0, Math.min(1, settings.camTilt / 25));
    // Handy: auf die Tischmitte zielen (der Bereich unten ist von der Istaka verdeckt)
    const base = document.body.classList.contains('phone') ? -0.02 : 0.12;
    const look = new THREE.Vector3(dir.x * (base - lift * 0.9), TABLE_Y - 0.12 + lift * 0.45, dir.z * (base - lift * 0.9)).add(off);
    return { pos, look };
  }

  /** an einen anderen Tisch umziehen (Spieler, Steine, Bestellungen wandern mit) */
  setSpot(spot: number) {
    if (spot === this.spot && this.tableRoot.position.x === SPOTS[spot].x) return;
    this.spot = spot;
    this.tableRoot.position.set(SPOTS[spot].x, 0, SPOTS[spot].z);
    this.tableRoot.updateMatrixWorld(true);
    for (const [k, c] of this.loungeChairs) {
      const sp = this.loungeSpot(k);
      c.position.set(sp.pos.x, 0, sp.pos.z);
      facing(c, sp.pos.x - sp.look.x, sp.pos.z - sp.look.z);
    }
    if (this.lounge) this.sitLounge(this.lounge);
    if (this.seated !== null) {
      this.camTarget = this.seatCam(this.seated);
      this.camera.position.copy(this.camTarget.pos);
      this.camLook.copy(this.camTarget.look);
    }
  }

  // ------------------------------------------------------------ Zuschauer-Stühle (Fernseher / Ecken)

  /** eigener Zuschauer-Platz (null = steht / läuft oder schaut am Platz eines Spielers zu) */
  lounge: string | null = null;
  onLounge: ((key: string) => void) | null = null;
  onLoungeStand: (() => void) | null = null;
  private loungeChairs = new Map<string, THREE.Group>();
  private loungeAvatars = new Map<string, { av: Avatar3D; key: string }>();
  private loungeOn = false;

  /** Stuhl-Position (Welt) + Blickziel für einen Zuschauer-Platz am aktuellen Tisch */
  private loungeSpot(key: string): { pos: THREE.Vector3; look: THREE.Vector3; corner: boolean } {
    const off = this.tableRoot.position;
    if (key[0] === 'c') {
      const k = Number(key[1]);
      const dir = seatPos(k).add(seatPos((k + 1) % 4)).normalize();
      return { pos: dir.clone().multiplyScalar(1.42).add(off), look: new THREE.Vector3(off.x, TABLE_Y, off.z), corner: true };
    }
    const i = key === 'tv1' ? 1 : 0;
    // je Tisch der nächste Fernseher, Stühle mit Abstand davor
    const TV = [
      { tv: 0, p: [[-1.65, -2.7], [-0.85, -2.7]] },
      { tv: 0, p: [[-1.65, -2.7], [-0.85, -2.7]] },
      { tv: 2, p: [[-2.1, 6.1], [-1.4, 6.1]] },
      { tv: 3, p: [[4.4, 6.25], [5.1, 6.25]] },
    ][this.spot] ?? { tv: 0, p: [[-1.65, -2.7], [-0.85, -2.7]] };
    const [x, z] = TV.p[i];
    return { pos: new THREE.Vector3(x, 0, z), look: (this.tvs[TV.tv]?.pos ?? new THREE.Vector3(-1.2, 2.2, -4.9)).clone(), corner: false };
  }

  /** Zuschauer-Stühle nur, solange jemand zuschaut; sitzende Zuschauer als Figuren */
  setLounge(list: { id: string; name: string; avatar?: Avatar; lounge?: string | null }[], myId: string) {
    const show = list.length > 0;
    const keys = ['tv0', 'tv1', 'c0', 'c1', 'c2', 'c3'];
    if (show && !this.loungeChairs.size) {
      for (const k of keys) {
        const c = this.chair();
        c.traverse((o) => (o.userData.lounge = k));
        this.scene.add(c);
        this.loungeChairs.set(k, c);
      }
    }
    for (const [k, c] of this.loungeChairs) {
      const sp = this.loungeSpot(k);
      c.position.set(sp.pos.x, 0, sp.pos.z);
      facing(c, sp.pos.x - sp.look.x, sp.pos.z - sp.look.z);
      c.visible = show;
      const i = this.chairs.indexOf(c);
      if (show && i < 0) this.chairs.push(c);
      if (!show && i >= 0) this.chairs.splice(i, 1);
    }
    this.loungeOn = show;
    // sitzende Zuschauer (nicht man selbst)
    const want = new Map<string, { key: string; name: string; avatar: Avatar }>();
    for (const p of list) if (p.lounge && p.id !== myId && p.avatar) want.set(p.lounge, { key: p.id + JSON.stringify(p.avatar) + p.name, name: p.name, avatar: p.avatar });
    for (const [k, a] of this.loungeAvatars) {
      if (want.get(k)?.key === a.key) continue;
      this.scene.remove(a.av.root);
      this.loungeAvatars.delete(k);
    }
    for (const [k, w] of want) {
      let a = this.loungeAvatars.get(k);
      if (!a) {
        const av = new Avatar3D(w.avatar, w.name);
        a = { av, key: w.key };
        this.scene.add(av.root);
        this.loungeAvatars.set(k, a);
      }
      const sp = this.loungeSpot(k);
      const d = new THREE.Vector3(sp.pos.x - sp.look.x, 0, sp.pos.z - sp.look.z).normalize();
      a.av.root.position.set(sp.pos.x - d.x * 0.03, 0.45, sp.pos.z - d.z * 0.03);
      facing(a.av.root, d.x, d.z);
    }
    if (this.lounge && !show) this.sitLounge(null);
  }

  /** sich als Zuschauer auf einen Raum-Stuhl setzen (null = aufstehen) */
  sitLounge(key: string | null) {
    this.lounge = key;
    if (key === null) {
      if (this.seated === null) this.camTarget = null;
      return;
    }
    this.seated = null;
    const sp = this.loungeSpot(key);
    const d = new THREE.Vector3(sp.pos.x - sp.look.x, 0, sp.pos.z - sp.look.z).normalize();
    const eye = sp.pos.clone().addScaledVector(d, sp.corner ? 0.1 : 0.05);
    eye.y = sp.corner ? 1.45 : 1.2;
    this.camTarget = { pos: eye, look: sp.corner ? sp.look.clone() : sp.look.clone().add(new THREE.Vector3(0, -0.15, 0)) };
    // direkt hinsetzen (nicht quer durch Tisch und Spieler fliegen)
    this.camera.position.copy(this.camTarget.pos);
    this.camLook.copy(this.camTarget.look);
    this.focus = true;
    this.seatYaw = 0;
    this.seatPitch = 0;
    this.stopLook();
    // Lauf-Position neben den Stuhl, damit man beim Aufstehen dort steht
    this.walkPos.set(sp.pos.x + d.x * 0.6, 1.6, sp.pos.z + d.z * 0.6);
    this.yaw = Math.atan2(d.x, d.z);
    this.avatars.forEach((a, s) => a && (a.root.visible = s !== this.mySeat || !!this.third));
  }

  private updateLounge(dt: number) {
    if (!this.loungeOn) return;
    for (const a of this.loungeAvatars.values()) a.av.update(dt);
  }

  // ------------------------------------------------------------ Mitspieler, die herumlaufen

  private walkers = new Map<string, { av: Avatar3D; key: string; tx: number; tz: number; yaw: number; seat: number | null }>();
  private hiddenSeats = new Set<number>();

  /** eigene Position zum Senden (null = sitzt) */
  myPose(): { x: number; z: number; yaw: number } | null {
    return this.seated === null && !this.lounge ? { x: this.walkPos.x, z: this.walkPos.z, yaw: this.yaw } : null;
  }

  /** Position eines anderen Spielers (läuft = sichtbar als stehende Figur) */
  setWalker(id: string, d: { name: string; avatar: Avatar; x: number; z: number; yaw: number; walking: boolean; seat: number | null }) {
    let w = this.walkers.get(id);
    if (!d.walking) {
      if (w) {
        this.scene.remove(w.av.root);
        this.walkers.delete(id);
      }
      if (d.seat !== null) this.setSeatHidden(d.seat, false);
      return;
    }
    const key = JSON.stringify(d.avatar) + d.name;
    if (!w || w.key !== key) {
      if (w) this.scene.remove(w.av.root);
      const av = new Avatar3D(d.avatar, d.name, { standing: true });
      av.root.scale.setScalar(0.88);
      av.root.position.set(d.x, 0.72, d.z);
      this.scene.add(av.root);
      w = { av, key, tx: d.x, tz: d.z, yaw: d.yaw, seat: d.seat };
      this.walkers.set(id, w);
    }
    w.tx = d.x;
    w.tz = d.z;
    w.yaw = d.yaw;
    w.seat = d.seat;
    if (d.seat !== null) this.setSeatHidden(d.seat, true);
  }

  /** nur diese IDs sind noch da */
  keepWalkers(ids: string[]) {
    for (const [id, w] of this.walkers) {
      if (ids.includes(id)) continue;
      this.scene.remove(w.av.root);
      if (w.seat !== null) this.setSeatHidden(w.seat, false);
      this.walkers.delete(id);
    }
  }

  /** Sitzfigur ausblenden, solange der Spieler herumläuft */
  setSeatHidden(seat: number, hidden: boolean) {
    if (hidden) this.hiddenSeats.add(seat);
    else this.hiddenSeats.delete(seat);
    const a = this.avatars[seat];
    if (a) a.root.visible = !hidden && (seat !== this.mySeat || !!this.third);
  }

  private updateWalkers(dt: number) {
    this.updateLounge(dt);
    for (const w of this.walkers.values()) {
      const p = w.av.root.position;
      const dx = w.tx - p.x;
      const dz = w.tz - p.z;
      const d = Math.hypot(dx, dz);
      const k = 1 - Math.exp(-dt * 8);
      p.x += dx * k;
      p.z += dz * k;
      w.av.root.rotation.y = w.yaw + Math.PI;
      w.av.setWalking(d > 0.03 ? Math.min(1.5, d * 6) : 0);
      w.av.update(dt);
    }
  }

  // ------------------------------------------------------------ 3rd Person

  /** gehaltene Taste: eigene Figur von hinten oder vorne sehen */
  third: 'back' | 'front' | null = null;
  private selfAvatar: Avatar3D | null = null;
  private selfKey = '';
  setThird(mode: 'back' | 'front' | null) {
    if (this.third === mode) return;
    this.third = mode;
    this.avatars.forEach((a, s) => a && (a.root.visible = s !== this.mySeat || !!mode));
  }
  /** eigene (stehende) Figur zum Herumlaufen */
  setSelf(spec: Avatar, name: string) {
    const key = JSON.stringify(spec) + name;
    if (key === this.selfKey) return;
    this.selfKey = key;
    if (this.selfAvatar) this.scene.remove(this.selfAvatar.root);
    this.selfAvatar = new Avatar3D(spec, name, { standing: true });
    this.selfAvatar.root.scale.setScalar(0.88);
    this.selfAvatar.root.visible = false;
    this.scene.add(this.selfAvatar.root);
  }

  /** Maus steuert die Kamera (Pointer-Lock) */
  isLooking() {
    return document.pointerLockElement === this.container;
  }
  onLookChange: ((looking: boolean) => void) | null = null;

  private startLook() {
    if (this.isLooking()) return;
    try {
      const r = this.container.requestPointerLock?.() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {}
  }
  private stopLook() {
    if (this.isLooking()) document.exitPointerLock?.();
  }

  private bindInput() {
    const el = this.container;
    const typing = (e: Event) => {
      const tag = (e.target as HTMLElement)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (this.tvWatch !== null && (e.code === 'Escape' || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', settings.keys.forward, settings.keys.back, settings.keys.left, settings.keys.right].includes(e.code))) {
        this.watchTv(null);
        if (e.code === 'Escape') return;
      }
      this.keys.add(e.code);
      if (e.code === settings.keys.look && this.seated !== null) {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur?.();
        this.setFocus(!this.focus);
      }
      if (e.code === settings.keys.zoom) this.zooming = true;
      if (e.code === settings.keys.thirdBack) this.setThird('back');
      if (e.code === settings.keys.thirdFront) this.setThird('front');
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === settings.keys.zoom) this.zooming = false;
      if (e.code === settings.keys.thirdBack || e.code === settings.keys.thirdFront) this.setThird(null);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.zooming = false;
      this.setThird(null);
    });
    document.addEventListener('pointerlockchange', () => {
      const looking = this.isLooking();
      // Esc beim Umschauen im Sitzen → zurück aufs Brett
      if (!looking && this.seated !== null && !this.focus) {
        this.focus = true;
        this.seatYaw = 0;
        this.seatPitch = 0;
        this.onFocusChange?.(true);
      }
      this.onLookChange?.(looking);
    });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (!this.isLooking() || (window as any).__wheelOpen) return;
      this.lookDelta(e.movementX, e.movementY);
    });
    // Touch / Stift: Wischen = Umschauen, Tippen = Klick (siehe handleClick)
    let drag: { id: number; x: number; y: number; sx: number; sy: number } | null = null;
    let springT: ReturnType<typeof setTimeout> | null = null;
    let lastTap = 0;
    el.addEventListener('pointerdown', (e) => {
      this.pointerType = e.pointerType || 'mouse';
      if (springT) clearTimeout(springT);
      springT = null;
      if (e.pointerType !== 'mouse' && this.seated !== null) {
        const now = performance.now();
        if (now - lastTap < 320 && !this.focus) this.setFocus(true);
        lastTap = now;
      }
      if (this.seated !== null && this.focus && !this.isLooking() && e.button === 0) {
        const hit = this.pick(e, this.clickables);
        const kind = hit?.userData.pile ? 'pile' : hit?.userData.side ? 'side' : null;
        if (kind && this.onDrawDragStart?.(kind, e)) {
          e.preventDefault();
          return;
        }
      }
      if (e.pointerType === 'mouse') return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      // im Sitzen: erst nach deutlichem Wischen umschauen (Tippen bleibt Tippen)
      if (this.seated !== null && this.focus && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 14) this.setFocus(false);
      if (this.seated === null || !this.focus) this.lookDelta(dx * 1.6, dy * 1.6);
    });
    const end = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null;
      // nach dem Umschauen federt der Blick zurück aufs Brett
      if (e.pointerType !== 'mouse' && this.seated !== null && !this.focus && !this.freeLook) {
        if (springT) clearTimeout(springT);
        springT = setTimeout(() => this.seated !== null && !this.freeLook && this.setFocus(true), 1100);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => this.handleClick(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  private mouseNdc = new THREE.Vector2(0, 0);
  private zooming = false;

  /** Ray aus der Bildmitte (beim Umschauen) oder vom Mauszeiger */
  private rayNdc() {
    return this.isLooking() ? new THREE.Vector2(0, 0) : this.mouseNdc;
  }

  private pileObj: THREE.Object3D | null = null;
  private sideObj: THREE.Object3D | null = null;
  /** Ziehen aus der Mitte / von der Seite starten (main entscheidet, ob erlaubt) */
  onDrawDragStart: ((kind: 'pile' | 'side', e: PointerEvent) => boolean) | null = null;
  suppressClick = false;

  // ---------------------------------------------------------- Wurfzonen beim Ziehen eines Steins
  private zoneFinish!: THREE.Group;
  private zoneDiscard!: THREE.Group;
  private zoneLabel(text: string, color: string) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(20,12,8,0.75)';
    g.beginPath();
    g.roundRect(6, 14, 500, 100, 46);
    g.fill();
    g.fillStyle = color;
    g.font = 'bold 54px Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(0.2, 0.05, 1);
    sp.renderOrder = 12;
    return sp;
  }
  private buildZones() {
    const mk = (r: number, color: string, text: string) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.012, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r - 0.012, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2;
      fill.userData.fill = true;
      const label = this.zoneLabel(text, color);
      label.position.y = 0.11;
      g.add(ring, fill, label);
      g.visible = false;
      this.tableRoot.add(g);
      return g;
    };
    this.zoneFinish = mk(0.2, '#ffd27a', '🏁 BİTİR · Mitte');
    this.zoneDiscard = mk(0.13, '#7fe07f', '➜ AT · Abwerfen');
    this.zoneFinish.position.set(0, TABLE_Y + 0.004, 0);
  }
  /** Stein schräg zum Betrachter aufstellen (wie an den Stapel gelehnt) und etwas vergrößern */
  private tiltToViewer(m: THREE.Mesh, seat: number) {
    const flat = m.quaternion.clone();
    const local = seatPos(seat).multiplyScalar(1.15);
    const eye = new THREE.Vector3(local.x, 1.45, local.z).add(this.tableRoot.position);
    const world = m.position.clone().add(this.tableRoot.position);
    const face = new THREE.Object3D();
    face.position.copy(world);
    face.lookAt(eye);
    // Lesrichtung beibehalten: nur um die waagerechte Achse kippen (kein Verdrehen)
    m.quaternion.copy(flat).slerp(face.quaternion, 0.72);
    m.scale.multiplyScalar(1.3);
    m.position.y += 0.018;
  }
  /** Abwurfstapel eines Platzes: vor seinem Brett, nach rechts versetzt */
  private discardSpot(s: number) {
    return seatPos(s).multiplyScalar(0.33).add(seatPos((s + 1) % 4).multiplyScalar(0.19));
  }
  private myCorner() {
    return this.discardSpot(this.mySeat ?? 0);
  }
  private prevPile = 0;
  /** Welche Wurfzone liegt unter diesem Bildschirmpunkt? */
  dropZoneAt(x: number, y: number): 'finish' | 'discard' | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_Y);
    const p = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!p) return null;
    p.sub(this.tableRoot.position);
    if (Math.abs(p.x) > 0.6 || Math.abs(p.z) > 0.6) return null;
    const c = this.myCorner();
    if (Math.hypot(p.x - c.x, p.z - c.z) < 0.15) return 'discard';
    if (Math.hypot(p.x, p.z) < 0.2) return 'finish';
    return null;
  }
  /** Zonen beim Ziehen zeigen; hover hebt die aktuelle hervor; false = ausblenden */
  showZones(hover: 'finish' | 'discard' | null | false) {
    const on = hover !== false;
    const c = this.myCorner();
    this.zoneDiscard.position.set(c.x, TABLE_Y + 0.004, c.z);
    for (const [g, k] of [
      [this.zoneFinish, 'finish'],
      [this.zoneDiscard, 'discard'],
    ] as const) {
      g.visible = on;
      g.children.forEach((ch) => {
        const m = (ch as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (ch.userData.fill) m.opacity = hover === k ? 0.35 : 0.08;
      });
      g.scale.setScalar(hover === k ? 1.08 : 1);
    }
  }

  /** Bildschirmposition der Tischmitte (etwas über dem Tuch) */
  screenOfTableCenter(): { x: number; y: number } | null {
    const p = new THREE.Vector3(0, TABLE_Y + 0.12, 0).add(this.tableRoot.position).project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }
  /** Bildschirmposition über dem Kopf eines Platzes (null = hinter mir / ich selbst) */
  screenOfSeat(seat: number): { x: number; y: number } | null {
    const local = seatPos(seat).multiplyScalar(1.15);
    const wp = new THREE.Vector3(local.x, 1.32, local.z).add(this.tableRoot.position);
    const p = wp.clone().project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const x = r.left + ((p.x + 1) / 2) * r.width;
    const y = r.top + ((1 - p.y) / 2) * r.height;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return { x, y };
  }
  /** Bildschirmposition von Stapel bzw. Seitenstein (für die Flug-Animation) */
  screenOf(kind: 'pile' | 'side'): { x: number; y: number } | null {
    const o = kind === 'pile' ? this.pileObj : this.sideObj;
    if (!o) return null;
    const p = o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0)).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  private handleClick(e: MouseEvent) {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const touch = this.pointerType !== 'mouse';
    // Fernseh-Modus: Tippen/Klicken irgendwo = zurück
    if (this.tvWatch !== null) {
      this.watchTv(null);
      return;
    }
    {
      // Fernseher antippen/anklicken → davor setzen und schauen
      const lockedWalk = this.seated === null && !touch;
      const aim = touch ? this.ndcOf(e) : lockedWalk || !this.focus ? new THREE.Vector2(0, 0) : this.ndcOf(e);
      if (!lockedWalk || this.isLooking()) {
        const i = this.tvAt(aim);
        if (i !== null) {
          this.watchTv(i);
          return;
        }
      }
    }
    const at = touch ? this.ndcOf(e) : new THREE.Vector2(0, 0);
    if (this.lounge) {
      // auf einem Zuschauer-Stuhl: anderen Stuhl antippen = umsetzen
      const hit = this.pickNdc(this.ndcOf(e), this.chairs);
      if (hit?.userData.lounge !== undefined) this.onLounge?.(hit.userData.lounge);
      else if (hit?.userData.seat !== undefined) this.onChair?.(hit.userData.seat, hit.userData.spot ?? 0);
      return;
    }
    if (this.seated === null) {
      if (!touch && !this.isLooking()) {
        this.startLook();
        return;
      }
      const hit = this.pickNdc(at, this.chairs);
      if (hit?.userData.lounge !== undefined) this.onLounge?.(hit.userData.lounge);
      else if (hit?.userData.seat !== undefined) this.onChair?.(hit.userData.seat, hit.userData.spot ?? 0);
      return;
    }
    if (!this.focus) {
      // Umschauen: Brett anvisieren und klicken → zurück zum Brett
      const hit = this.pickNdc(at, [...this.clickables, ...this.tableMeshes, ...this.chairs]);
      if (hit?.userData.seat !== undefined && hit.userData.spot !== this.spot) this.onChair?.(hit.userData.seat, hit.userData.spot);
      else if (hit) this.setFocus(true);
      return;
    }
    const hit = this.pick(e, [...this.clickables, ...this.tableMeshes]);
    if (!hit) {
      if (!touch) this.setFocus(false);
      return;
    }
    if (hit.userData.pile) this.onPile?.();
    else if (hit.userData.side) this.onSide?.();
    else if (hit.userData.meld !== undefined) this.onMeld?.(hit.userData.meld);
  }

  private ndcOf(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** Blick drehen (Touch-Wischen, Controller-Stick) in Pixel-ähnlichen Einheiten */
  lookDelta(dx: number, dy: number) {
    const sens = 0.0022 * (settings.sensitivity / 100) * (this.zooming ? 0.45 : 1);
    const inv = settings.invertY ? -1 : 1;
    if (this.seated === null && !this.lounge) {
      this.yaw -= dx * sens;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - dy * sens * inv));
    } else if (!this.focus) {
      this.seatYaw = Math.max(-2.7, Math.min(2.7, this.seatYaw - dx * sens));
      this.seatPitch = Math.max(-1.0, Math.min(1.1, this.seatPitch - dy * sens * inv));
    }
  }

  /** „Interagieren“ (Controller A / Taste): Stuhl bzw. Brett in der Bildmitte */
  interact() {
    const c = new THREE.Vector2(0, 0);
    if (this.seated === null) {
      const hit = this.pickNdc(c, this.chairs);
      if (hit?.userData.lounge !== undefined) this.onLounge?.(hit.userData.lounge);
      else if (hit?.userData.seat !== undefined) this.onChair?.(hit.userData.seat, hit.userData.spot ?? 0);
      return !!hit;
    }
    if (!this.focus) {
      const hit = this.pickNdc(c, [...this.clickables, ...this.tableMeshes]);
      if (hit) this.setFocus(true);
      return !!hit;
    }
    return false;
  }

  setZoom(on: boolean) {
    this.zooming = on;
  }

  /** Controller-Sticks (Tasten wertet controls.ts aus) */
  private pollPad(dt: number) {
    const pads = navigator.getGamepads?.() ?? [];
    let lx = 0, ly = 0, rx = 0, ry = 0;
    for (const p of pads) {
      if (!p || p.axes.length < 4) continue;
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
      lx = dz(p.axes[0]);
      ly = dz(p.axes[1]);
      rx = dz(p.axes[2]);
      ry = dz(p.axes[3]);
      break;
    }
    this.padMove = { x: lx, y: -ly };
    if (this.seated === null && !this.touchMoving) this.moveInput = this.padMove;
    if (rx || ry) this.lookDelta(rx * 900 * dt, ry * 700 * dt);
  }
  padMove = { x: 0, y: 0 };
  touchMoving = false;

  /** Kollision: Wände, Tür, Tische, Theke */
  private collide(prev: THREE.Vector3) {
    const p = this.walkPos;
    const W = ROOM.w / 2 - 0.4;
    p.x = Math.max(-W, Math.min(W, p.x));
    const doorZ = ROOM.d / 2;
    const inside = prev.z < doorZ;
    if (inside) {
      p.z = Math.max(-ROOM.d / 2 + 1.25, p.z);
      if (p.z > doorZ - 0.3 && Math.abs(p.x) > 0.5) p.z = doorZ - 0.3;
    } else {
      p.z = Math.min(GARDEN.z1 - 0.55, p.z);
      if (p.z < doorZ + 0.3 && Math.abs(p.x) > 0.5) p.z = doorZ + 0.3;
      p.x = Math.max(-ROOM.w / 2 + 0.55, Math.min(ROOM.w / 2 - 0.55, p.x));
    }
    const round = (cx: number, cz: number, r: number) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) {
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      }
    };
    for (const sp of SPOTS) round(sp.x, sp.z, 1.3);
    for (const o of this.obstacles) round(o.x, o.z, o.r);
  }
  private obstacles: { x: number; z: number; r: number }[] = [
    { x: -3.2, z: 2.6, r: 0.95 },
    { x: 2.7, z: 3.3, r: 0.95 },
    { x: -3.3, z: -2.4, r: 0.8 },
    { x: -5.2, z: ROOM.d / 2 + 1.1, r: 0.95 },
    { x: 0, z: GARDEN.z1 - 1.3, r: 0.85 },
  ];

  private pickNdc(ndc: THREE.Vector2, targets: THREE.Object3D[]): THREE.Object3D | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length || hits[0].distance > 5) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && o.userData.seat === undefined && o.userData.lounge === undefined && !o.userData.pile && !o.userData.side && o.userData.meld === undefined && !o.userData.table) o = o.parent;
    return o;
  }

  private get tableMeshes(): THREE.Object3D[] {
    return this.spotMeshes[this.spot] ?? [];
  }
  private raycaster = new THREE.Raycaster();
  private pick(e: { clientX: number; clientY: number }, targets: THREE.Object3D[]): THREE.Object3D | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && o.userData.seat === undefined && o.userData.lounge === undefined && !o.userData.pile && !o.userData.side && o.userData.meld === undefined && !o.userData.table) o = o.parent;
    return o;
  }

  /** Bildschirmpunkt über dem Tisch? (für Drag & Drop-Abwurf) */
  isOverTable(x: number, y: number) {
    return !!this.pick({ clientX: x, clientY: y }, [...this.tableMeshes, ...this.clickables]);
  }

  // ------------------------------------------------------------ Spielzustand

  private prevDiscards: number[] = [];
  private flyers: { m: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; spin: number }[] = [];

  /** Pişti: Animationen (fliegende Karten, Stapel rutscht zum Gewinner) */
  private pistiFx = new THREE.Group();
  private pistiAnims: { t: number; dur: number; step: (e: number, t: number) => void; done?: () => void }[] = [];
  private pistiTopHidden: THREE.Object3D | null = null;
  private pistiViewer = 0;
  /** Karten, die gerade auf den Stapel fliegen (echte oberste Karte so lange versteckt) */
  private pistiFlying = new Set<number>();

  private pistiSeed(id: number, k: number) {
    return (Math.sin(id * 12.9898 + k * 78.233) * 43758.5453) % 1;
  }
  /** Mitte für jeden etwas näher zu sich (jeder sieht den Tisch aus seiner Sicht) */
  private pistiCenter() {
    const vd = seatPos(this.pistiViewer);
    return new THREE.Vector3(vd.x * 0.1, 0, vd.z * 0.1);
  }
  /** Lage einer Karte im Stapel (back = 0 → oberste) – gleich für Tisch und Animation */
  private pistiPose(m: THREE.Object3D, c: PCard | null, layerIdx: number, back: number, hidden: boolean) {
    const vd = seatPos(this.pistiViewer);
    const readRot = Math.atan2(vd.x, vd.z);
    const C = this.pistiCenter();
    const Y = TABLE_Y + 0.002;
    const sd = (k: number) => this.pistiSeed(c ? c.id : layerIdx + 100, k);
    m.scale.setScalar(1.8);
    if (hidden) {
      m.position.set(C.x + sd(1) * 0.01, Y + layerIdx * 0.0013, C.z + sd(2) * 0.01);
      m.rotation.set(0, readRot + sd(3) * 0.15, 0);
      return;
    }
    // r = nach rechts, f = zu mir hin (aus meiner Sicht)
    const r = new THREE.Vector3(vd.z, 0, -vd.x).normalize();
    const f = new THREE.Vector3(vd.x, 0, vd.z).normalize();
    if (back === 0) {
      // oberste Karte: liegt vor dem Stapel, vordere Kante auf dem Tisch, hintere hochgeklappt → kein Durchdringen
      const base = C.clone().addScaledVector(f, 0.085).addScaledVector(r, 0.035);
      m.position.set(base.x, Y + layerIdx * 0.002 + 0.002, base.z);
      m.rotation.set(0, readRot, 0);
      m.rotateX(0.85);
      m.scale.setScalar(2.1);
      // Drehpunkt ist die Kartenmitte → um eine halbe Kartenlänge nach hinten-oben schieben
      const half = (0.1148 * 2.1) / 2;
      m.position.y += half * Math.sin(0.85);
      m.position.addScaledVector(f, -half * Math.cos(0.85));
      return;
    }
    // ältere Karten: flach, leicht nach links/hinten aufgefächert (schauen hinter der obersten hervor)
    const k = Math.min(back, 4);
    const pos = C.clone()
      .addScaledVector(f, -0.03 - k * 0.006)
      .addScaledVector(r, -0.02 - k * 0.022 + sd(1) * 0.008);
    m.position.set(pos.x, Y + layerIdx * 0.002, pos.z + 0);
    m.rotation.set(0, readRot + (back < 4 ? back * 0.07 : sd(3) * 0.3), 0);
  }
  /** wo die gestochenen Karten eines Teams liegen */
  private pistiStackPos(v: any, team: number) {
    const seat = (v.seats as number[]).find((s) => v.teamOfSeat[s] === team) ?? 0;
    const dd = seatPos(seat);
    const side = new THREE.Vector3(dd.z, 0, -dd.x);
    return { pos: new THREE.Vector3(dd.x * 0.32 - side.x * 0.2, TABLE_Y + 0.004, dd.z * 0.32 - side.z * 0.2), rot: Math.atan2(dd.x, dd.z) + Math.PI / 2 };
  }
  private seatHandPos(seat: number) {
    const dd = seatPos(seat);
    return new THREE.Vector3(dd.x * 0.45, TABLE_Y + 0.14, dd.z * 0.45);
  }

  /** Pişti-Tisch: Mitte (Stapel), Talon, gestochene Karten, Handkarten der anderen (Rückseiten) */
  /** Pişti: höhere Renderauflösung, damit die Karten auf dem Handy scharf sind (Szene ist ohne Steine leicht) */
  sharpCards(on: boolean) {
    const pr = Math.min(devicePixelRatio, on ? (settings.quality === 'high' ? 2.5 : 1.75) : settings.quality === 'high' ? 2 : 1);
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 0.01) {
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
  }

  setPisti(v: any | null, mySeat: number | null) {
    this.sharpCards(!!v);
    this.visual = null;
    this.flyers = [];
    this.gameGroup.clear();
    this.clickables = [];
    this.sideObj = null;
    this.pistiTopHidden = null;
    if (!this.pistiFx.parent) this.tableRoot.add(this.pistiFx);
    if (!v) {
      this.pistiFx.clear();
      this.pistiAnims = [];
      this.pistiFlying.clear();
      return;
    }
    const viewer = mySeat ?? 0;
    this.pistiViewer = viewer;
    const Y = TABLE_Y + 0.002;
    // Mitte: verdeckte Startkarten + offener Stapel
    let layer = 0;
    for (let i = 0; i < v.hiddenCount; i++) {
      const m = cardMesh(null, false);
      this.pistiPose(m, null, layer++, 9, true);
      this.gameGroup.add(m);
    }
    const n = v.pile.length;
    v.pile.forEach((c: PCard, i: number) => {
      const m = cardMesh(c, true);
      this.pistiPose(m, c, layer++, n - 1 - i, false);
      this.gameGroup.add(m);
      if (i === n - 1) {
        this.pistiTopHidden = m;
        if (this.pistiFlying.has(c.id)) m.visible = false;
      }
    });
    if (!v.hiddenCount && !n) {
      const C = this.pistiCenter();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.085, 32), new THREE.MeshBasicMaterial({ color: '#e8d9b0', transparent: true, opacity: 0.5 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(C.x, Y, C.z);
      this.gameGroup.add(ring);
    }
    // Talon beim Geber
    if (v.stockCount > 0) {
      const dd = seatPos(v.dealer);
      const side = new THREE.Vector3(dd.z, 0, -dd.x);
      const k = Math.max(1, Math.round(v.stockCount / 3));
      for (let i = 0; i < k; i++) {
        const m = cardMesh(null, false);
        m.scale.setScalar(1.25);
        m.position.set(dd.x * 0.33 + side.x * 0.21, Y + i * 0.0035, dd.z * 0.33 + side.z * 0.21);
        m.rotation.y = Math.atan2(dd.x, dd.z) + 0.25;
        this.gameGroup.add(m);
      }
    }
    // gestochene Karten je Team: verdeckter Stapel rechts vor dem ersten Spieler des Teams
    for (const team of [0, 1]) {
      const sp = this.pistiStackPos(v, team);
      const k = Math.ceil(v.capturedCounts[team] / 4);
      for (let i = 0; i < k; i++) {
        const m = cardMesh(null, false);
        m.scale.setScalar(1.25);
        m.position.copy(sp.pos).setY(Y + i * 0.0035);
        m.rotation.y = sp.rot + (i % 3) * 0.05;
        this.gameGroup.add(m);
      }
    }
    // Handkarten der anderen: Rückseiten als kleiner Fächer vor ihrem Platz
    for (const s of v.seats as number[]) {
      const dd = seatPos(s);
      if (s !== mySeat) {
        const k = v.handCounts[s];
        const g = new THREE.Group();
        for (let i = 0; i < k; i++) {
          const m = cardMesh(null, false);
          m.scale.setScalar(1.2);
          m.rotation.x = -1.15;
          m.rotation.z = (i - (k - 1) / 2) * 0.12;
          m.position.set((i - (k - 1) / 2) * 0.035, 0.06, -i * 0.002);
          g.add(m);
        }
        g.position.set(dd.x * 0.43, TABLE_Y, dd.z * 0.43);
        facing(g, dd.x, dd.z);
        this.gameGroup.add(g);
      }
      if (s === v.current && v.phase !== 'handOver' && v.phase !== 'gameOver') {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 24), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(dd.x * 0.27, TABLE_Y + 0.002, dd.z * 0.27);
        this.gameGroup.add(ring);
      }
    }
  }

  // ------------------------------------------------------------------ Batak
  private batakViewer = 0;
  /** Lage einer Karte im aktuellen Stich (vor dem Platz, der sie gespielt hat) */
  private batakTrickPose(m: THREE.Object3D, seat: number, idx: number) {
    const vd = seatPos(this.batakViewer);
    const dd = seatPos(seat);
    m.scale.setScalar(1.95);
    // Stichmitte etwas zu mir hin, damit man die Karten gut sieht
    m.position.set(dd.x * 0.12 + vd.x * 0.06, TABLE_Y + 0.003 + idx * 0.0016, dd.z * 0.12 + vd.z * 0.06);
    // lesbar für mich, leicht schräg je nach Platz
    m.rotation.set(0, Math.atan2(vd.x, vd.z) + (seat - this.batakViewer) * 0.12, 0);
  }
  /** wo die Stiche eines Platzes liegen */
  private batakStackPos(seat: number) {
    const dd = seatPos(seat);
    const side = new THREE.Vector3(dd.z, 0, -dd.x);
    return { pos: new THREE.Vector3(dd.x * 0.33 - side.x * 0.22, TABLE_Y + 0.004, dd.z * 0.33 - side.z * 0.22), rot: Math.atan2(dd.x, dd.z) + Math.PI / 2 };
  }

  /** Batak-Tisch: Stich in der Mitte, gewonnene Stiche, Rückseiten der anderen, offene Partner-Hand (Eşli) */
  setBatak(v: any | null, mySeat: number | null) {
    this.sharpCards(!!v);
    this.visual = null;
    this.flyers = [];
    this.gameGroup.clear();
    this.clickables = [];
    this.sideObj = null;
    this.pistiTopHidden = null;
    if (!this.pistiFx.parent) this.tableRoot.add(this.pistiFx);
    if (!v) {
      this.pistiFx.clear();
      this.pistiAnims = [];
      this.pistiFlying.clear();
      return;
    }
    const viewer = mySeat ?? 0;
    this.batakViewer = viewer;
    const vd = seatPos(viewer);
    const Y = TABLE_Y + 0.002;
    // aktueller Stich
    (v.trick as { seat: number; card: PCard }[]).forEach((t, i) => {
      const m = cardMesh(t.card, true);
      this.batakTrickPose(m, t.seat, i);
      if (this.pistiFlying.has(t.card.id)) m.visible = false;
      m.userData.cardId = t.card.id;
      this.gameGroup.add(m);
    });
    // gewonnene Stiche als verdeckte Päckchen
    for (const s of v.seats as number[]) {
      const sp = this.batakStackPos(s);
      for (let i = 0; i < v.tricks[s]; i++) {
        const m = cardMesh(null, false);
        m.scale.setScalar(1.2);
        m.position.copy(sp.pos).setY(Y + i * 0.004);
        m.rotation.y = sp.rot + (i % 2 ? 0.12 : -0.05) + (i % 3) * 0.04;
        this.gameGroup.add(m);
      }
    }
    // Gömmeli: verdeckte Karten (Kitty) in der Mitte bis zur Ihale
    if (v.kittyCount && v.phase === 'bid') {
      for (let i = 0; i < v.kittyCount; i++) {
        const m = cardMesh(null, false);
        m.scale.setScalar(1.5);
        m.position.set((i - 1.5) * 0.05, Y + i * 0.002, 0);
        m.rotation.y = Math.atan2(vd.x, vd.z) + (i - 1.5) * 0.08;
        this.gameGroup.add(m);
      }
    }
    for (const s of v.seats as number[]) {
      const dd = seatPos(s);
      const open = v.open && v.open.seat === s ? (v.open.cards as PCard[]) : null;
      if (open) {
        // Eşli: Hand des Partners offen vor ihm, für alle lesbar
        const k = open.length;
        open.forEach((c, i) => {
          const m = cardMesh(c, true);
          m.scale.setScalar(1.25);
          const side = new THREE.Vector3(dd.z, 0, -dd.x);
          const off = (i - (k - 1) / 2) * 0.052;
          m.position.set(dd.x * 0.3 + side.x * off, Y + 0.002 + i * 0.0008, dd.z * 0.3 + side.z * off);
          m.rotation.y = Math.atan2(vd.x, vd.z);
          this.gameGroup.add(m);
        });
      } else if (s !== mySeat) {
        const k = v.handCounts[s];
        const g = new THREE.Group();
        for (let i = 0; i < k; i++) {
          const m = cardMesh(null, false);
          m.scale.setScalar(1.15);
          m.rotation.x = -1.15;
          m.rotation.z = (i - (k - 1) / 2) * 0.09;
          m.position.set((i - (k - 1) / 2) * 0.026, 0.06, -i * 0.002);
          g.add(m);
        }
        g.position.set(dd.x * 0.43, TABLE_Y, dd.z * 0.43);
        facing(g, dd.x, dd.z);
        this.gameGroup.add(g);
      }
      if (s === v.current && v.phase !== 'handOver') {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 24), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(dd.x * 0.27, TABLE_Y + 0.002, dd.z * 0.27);
        this.gameGroup.add(ring);
      }
    }
  }

  /** Batak-Animation: Karte fliegt in den Stich; voller Stich bleibt kurz liegen und rutscht zum Gewinner */
  batakAnimate(v: any) {
    // Handende: den letzten Stich trotzdem zeigen
    const e = v.lastEvent?.kind === 'handEnd' ? v.lastEvent.before : v.lastEvent;
    if (!e) return;
    const anim = (dur: number, step: (k: number, t: number) => void, done?: () => void) => {
      const a = { t: 0, dur, step, done };
      this.pistiAnims.push(a);
      return a;
    };
    // läuft noch ein Stich-Einsammeln → sofort fertig machen
    for (const c of this.pistiFx.children) {
      const w = c.userData.wait as { t: number; dur: number } | undefined;
      if (w) {
        w.t = w.dur;
        delete c.userData.wait;
      }
    }
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const fly = (m: THREE.Object3D, from: THREE.Vector3, dur: number, done?: () => void) => {
      const to = m.position.clone();
      const q = m.quaternion.clone();
      const s0 = 0.9;
      const s1 = m.scale.x;
      m.position.copy(from);
      anim(
        dur,
        (k) => {
          const kk = ease(k);
          m.position.lerpVectors(from, to, kk);
          m.position.y += Math.sin(kk * Math.PI) * 0.06;
          m.quaternion.copy(q);
          m.scale.setScalar(s0 + (s1 - s0) * kk);
        },
        done,
      );
    };
    if (e.kind === 'play') {
      const real = this.gameGroup.children.find((c) => c.userData.cardId === e.card.id);
      if (!real) return;
      real.visible = false;
      const id = e.card.id as number;
      this.pistiFlying.add(id);
      const m = cardMesh(e.card, true);
      this.batakTrickPose(m, e.seat, (v.trick as any[]).length - 1);
      this.pistiFx.add(m);
      fly(m, this.seatHandPos(e.seat), 0.36, () => {
        this.pistiFx.remove(m);
        this.pistiFlying.delete(id);
        const r2 = this.gameGroup.children.find((c) => c.userData.cardId === id);
        if (r2) r2.visible = true;
      });
      return;
    }
    if (e.kind === 'trick') {
      // letzter Karte hinfliegen lassen, dann kurz zeigen, dann zum Gewinner
      const g = new THREE.Group();
      const cards = e.cards as { seat: number; card: PCard }[];
      let lastM: THREE.Object3D | null = null;
      cards.forEach((t, i) => {
        const m = cardMesh(t.card, true);
        this.batakTrickPose(m, t.seat, i);
        g.add(m);
        if (i === cards.length - 1) lastM = m;
      });
      this.pistiFx.add(g);
      if (lastM) fly(lastM, this.seatHandPos(cards[cards.length - 1].seat), 0.36);
      const sp = this.batakStackPos(e.seat);
      const start = g.children.map((c) => ({ p: c.position.clone(), q: c.quaternion.clone(), s: c.scale.x }));
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, Math.PI));
      g.userData.wait = anim(1.25, () => {}, () =>
        anim(
          0.5,
          (k) => {
            const kk = ease(k);
            g.children.forEach((c, i) => {
              const st = start[i];
              c.position.lerpVectors(st.p, sp.pos.clone().setY(TABLE_Y + 0.05 + i * 0.002), kk);
              c.quaternion.copy(st.q).slerp(target, kk);
              c.scale.setScalar(st.s + (1.2 - st.s) * kk);
            });
          },
          () => this.pistiFx.remove(g),
        ),
      );
      return;
    }
  }

  /** Animation zum letzten Ereignis (nach setPisti aufrufen) */
  pistiAnimate(prev: any | null, v: any) {
    // Rundenende: den letzten Zug trotzdem zeigen
    const e = v.lastEvent?.kind === 'roundEnd' ? v.lastEvent.before : v.lastEvent;
    if (!e) return;
    const anim = (dur: number, step: (k: number, t: number) => void, done?: () => void) => {
      const a = { t: 0, dur, step, done };
      this.pistiAnims.push(a);
      return a;
    };
    for (const c of this.pistiFx.children) {
      const w = c.userData.wait as { t: number; dur: number } | undefined;
      if (w) {
        w.t = w.dur;
        delete c.userData.wait;
      }
    }
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const fly = (m: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, toQ: THREE.Quaternion, toS: number, dur: number, arc = 0.12, done?: () => void) => {
      const fromQ = m.quaternion.clone();
      const fromS = m.scale.x;
      m.position.copy(from);
      anim(
        dur,
        (k) => {
          const q = ease(k);
          m.position.lerpVectors(from, to, q);
          m.position.y += Math.sin(k * Math.PI) * arc;
          m.quaternion.slerpQuaternions(fromQ, toQ, q);
          m.scale.setScalar(fromS + (toS - fromS) * q);
        },
        done,
      );
    };
    const poseOf = (c: PCard | null, layerIdx: number, back: number, hidden = false) => {
      const tmp = new THREE.Object3D();
      this.pistiPose(tmp, c, layerIdx, back, hidden);
      return tmp;
    };
    /** alter Stapel als Kopie (für „erst drauf, dann zum Gewinner“) */
    const oldPile = () => {
      const g = new THREE.Group();
      if (!prev) return { g, layers: 0 };
      let layer = 0;
      for (let i = 0; i < prev.hiddenCount; i++) {
        const m = cardMesh(null, false);
        this.pistiPose(m, null, layer++, 9, true);
        g.add(m);
      }
      const n = prev.pile.length;
      prev.pile.forEach((c: PCard, i: number) => {
        const m = cardMesh(c, true);
        // die alte oberste Karte rutscht eine Position nach hinten (die neue liegt drauf)
        this.pistiPose(m, c, layer++, n - i, false);
        g.add(m);
      });
      return { g, layers: layer };
    };
    const slideToStack = (g: THREE.Group, team: number, delay: number) => {
      const sp = this.pistiStackPos(v, team);
      const start = g.children.map((c) => ({ p: c.position.clone(), q: c.quaternion.clone(), s: c.scale.x }));
      // umgedreht (Rückseite oben) auf den Stapel – oben drauf, nicht hinein
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, Math.PI));
      const topY = TABLE_Y + 0.006 + Math.ceil((v.capturedCounts[team] as number) / 4) * 0.0035;
      // Wartezeit merken: kommt schon der nächste Zug, rutscht der Stapel sofort weg (sonst liegen zwei Karten übereinander)
      g.userData.wait = anim(delay, () => {}, () =>
        anim(
          0.55,
          (k) => {
            const q = ease(k);
            g.children.forEach((c, i) => {
              const st = start[i];
              const to = sp.pos.clone().setY(topY + i * 0.0006);
              c.position.lerpVectors(st.p, to, q);
              c.position.y += Math.sin(k * Math.PI) * 0.05;
              c.quaternion.slerpQuaternions(st.q, target, q);
              c.scale.setScalar(st.s + (1.25 - st.s) * q);
            });
          },
          () => this.pistiFx.remove(g),
        ),
      );
    };
    const pulse = () => {
      // dezenter goldener Kreis, der sich ausbreitet (Pişti)
      const C = this.pistiCenter();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.1, 40), new THREE.MeshBasicMaterial({ color: '#f2cf7a', transparent: true, opacity: 0.8, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(C.x, TABLE_Y + 0.004, C.z);
      this.pistiFx.add(ring);
      anim(
        0.9,
        (k) => {
          ring.scale.setScalar(1 + k * 1.8);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
        },
        () => this.pistiFx.remove(ring),
      );
    };
    const from = this.seatHandPos(e.seat);
    // letzte Karte der Runde ohne Stich: sie landet erst sichtbar auf dem Stapel,
    // dann geht der ganze Rest an den, der zuletzt gestochen hat
    const ended = v.phase === 'handOver' || v.phase === 'gameOver';
    const sweepTeam = v.lastResult?.lastCapture ?? null;
    const endSweep = (e.kind === 'play' || e.kind === 'bluffFalse') && ended && !this.pistiTopHidden && !!prev && (prev.pile.length > 0 || prev.hiddenCount > 0) && sweepTeam !== null;
    switch (endSweep ? 'endSweep' : e.kind) {
      case 'endSweep': {
        for (const c of [...this.pistiFx.children]) if ((c as any).isBluffCard) this.pistiFx.remove(c);
        const { g, layers } = oldPile();
        this.pistiFx.add(g);
        const m = cardMesh(e.card, true);
        m.scale.setScalar(1.3);
        g.add(m);
        const target = poseOf(e.card, layers, 0);
        fly(m, from, target.position, target.quaternion, target.scale.x, 0.42, 0.12);
        slideToStack(g, sweepTeam as number, 0.42 + 1.0);
        break;
      }
      case 'play':
      case 'bluffFalse': {
        for (const c of [...this.pistiFx.children]) if ((c as any).isBluffCard) this.pistiFx.remove(c);
        // Karte fliegt vom Spieler auf den Stapel; die echte oberste Karte erscheint bei der Landung
        const top = this.pistiTopHidden;
        if (!top) return;
        top.visible = false;
        const cid = e.card.id as number;
        this.pistiFlying.add(cid);
        const m = cardMesh(e.card, e.kind === 'play');
        m.scale.setScalar(1.3);
        m.rotation.set(0, this.pistiSeed(e.card.id, 7) * 2, 0);
        this.pistiFx.add(m);
        const target = poseOf(e.card, 0, 0);
        fly(m, from, target.position, target.quaternion, target.scale.x, e.kind === 'play' ? 0.42 : 0.3, 0.12, () => {
          this.pistiFx.remove(m);
          this.pistiFlying.delete(cid);
          // inzwischen kann der Tisch neu aufgebaut sein → die aktuelle oberste Karte zeigen
          if (this.pistiTopHidden) this.pistiTopHidden.visible = true;
        });
        break;
      }
      case 'bluff': {
        // verdeckte Karte fliegt auf die einzelne Karte
        const m = cardMesh(null, false);
        m.scale.setScalar(1.3);
        this.pistiFx.add(m);
        const target = poseOf(null, 3, 0);
        target.position.y += 0.01;
        fly(m, from, target.position, target.quaternion, target.scale.x, 0.42, 0.12);
        // bleibt liegen, bis der Bluff beantwortet ist (dann kommt ein neues Ereignis)
        anim(60, () => {}, () => this.pistiFx.remove(m));
        (m as any).isBluffCard = true;
        break;
      }
      case 'capture':
      case 'pisti':
      case 'bluffBelieved':
      case 'bluffTrue': {
        // offene Bluff-Karte vom Tisch nehmen (sie wird gleich Teil der Animation)
        for (const c of [...this.pistiFx.children]) if ((c as any).isBluffCard) this.pistiFx.remove(c);
        const team = v.teamOfSeat[e.seat];
        const { g, layers } = oldPile();
        this.pistiFx.add(g);
        const card = e.kind === 'bluffBelieved' ? null : e.card;
        const m = cardMesh(card, !!card);
        m.scale.setScalar(1.3);
        g.add(m);
        const target = poseOf(card, layers, 0);
        const flyIn = e.kind === 'bluffBelieved' || e.kind === 'bluffTrue' ? 0.25 : 0.42;
        fly(m, e.kind === 'bluffTrue' || e.kind === 'bluffBelieved' ? target.position.clone().setY(target.position.y + 0.06) : from, target.position, target.quaternion, target.scale.x, flyIn, 0.12, () => {
          if (e.kind === 'pisti' || e.kind === 'bluffTrue' || e.kind === 'bluffBelieved') pulse();
          if (e.kind === 'pisti' || e.kind === 'bluffTrue') {
            // kleiner Hüpfer der Karte
            const y0 = m.position.y;
            anim(0.35, (k) => (m.position.y = y0 + Math.sin(k * Math.PI) * 0.03));
          }
        });
        // erst kurz liegen lassen (man sieht, womit gestochen wurde), dann alles zum Gewinner
        slideToStack(g, team, flyIn + (e.kind === 'pisti' ? 1.1 : 0.85));
        break;
      }
      case 'deal': {
        // Karten fliegen vom Talon zu den Spielern
        const dd = seatPos(v.dealer);
        const side = new THREE.Vector3(dd.z, 0, -dd.x);
        const src = new THREE.Vector3(dd.x * 0.33 + side.x * 0.21, TABLE_Y + 0.03, dd.z * 0.33 + side.z * 0.21);
        (v.seats as number[]).forEach((s, si) => {
          for (let i = 0; i < 4; i++) {
            const m = cardMesh(null, false);
            m.scale.setScalar(1.2);
            m.visible = false;
            this.pistiFx.add(m);
            const to = this.seatHandPos(s);
            const delay = (si * 4 + i) * 0.06;
            anim(delay, () => {}, () => {
              m.visible = true;
              fly(m, src, to, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(seatPos(s).x, seatPos(s).z), 0)), 1, 0.32, 0.06, () => this.pistiFx.remove(m));
            });
          }
        });
        break;
      }
    }
  }

  setGame(v: GameVisual | null) {
    this.visual = v;
    this.flyers = [];
    if (!v) this.prevDiscards = [];
    this.gameGroup.clear();
    this.clickables = [];
    this.sideObj = null;
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
        ring.position.set(dir.x * 0.27, TABLE_Y + 0.002, dir.z * 0.27);
        this.gameGroup.add(ring);
      }
    }

    // Mitte: genau EIN Stapel zum Ziehen; die übrigen 5er-Stapel stehen links daneben
    // und rücken nach, sobald der mittlere leer ist (wie am echten Tisch).
    const fwd = viewDir.clone().negate();
    const right = seatPos((viewer + 1) % 4);
    const left = right.clone().negate();
    if (v.pileCount > 0) {
      const pile = new THREE.Group();
      const full = Math.floor(v.pileCount / 5);
      const rest = v.pileCount % 5;
      const centerN = rest > 0 ? rest : 5;
      const sideN = rest > 0 ? full : full - 1;
      const tileMat = [
        new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: '#f5ecd6', roughness: 0.45 }),
        new THREE.MeshStandardMaterial({ color: '#e6d8b8', roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.5 }),
      ];
      const lineMat = new THREE.MeshBasicMaterial({ color: '#b9a57c' });
      const stack = (n: number, isPile: boolean) => {
        const g = new THREE.Group();
        const hgt = n * 0.012;
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.036, hgt, 0.05), tileMat);
        st.position.y = hgt / 2;
        st.castShadow = true;
        g.add(st);
        for (let k = 1; k < n; k++) {
          const ln = new THREE.Mesh(new THREE.BoxGeometry(0.0365, 0.0015, 0.0505), lineMat);
          ln.position.y = k * 0.012;
          g.add(ln);
        }
        g.rotation.y = Math.atan2(viewDir.x, viewDir.z);
        if (isPile) g.traverse((o) => (o.userData.pile = true));
        return g;
      };
      // Ziehstapel in der Mitte
      const center = stack(centerN, true);
      center.position.set(0, TABLE_Y, 0);
      pile.add(center);
      // Reserve-5er verdeckt vor den Brettern verteilt (wie am echten Tisch)
      const sidePos = (i: number) => {
        const seat = i % 4;
        const slot = Math.floor(i / 4);
        return seatPos(seat).multiplyScalar(0.37).sub(seatPos((seat + 1) % 4).multiplyScalar(0.03 + slot * 0.045)).setY(TABLE_Y);
      };
      for (let i = 0; i < sideN; i++) {
        const sStack = stack(5, false);
        const d = seatPos(i % 4);
        sStack.rotation.y = Math.atan2(d.x, d.z);
        sStack.position.copy(sidePos(i));
        pile.add(sStack);
      }
      // ein 5er-Stapel ist gerade aufgebraucht → nächster rutscht von der Seite in die Mitte
      if (this.prevPile - 1 === v.pileCount && this.prevPile % 5 === 1 && rest === 0) {
        this.flyers.push({ m: center, from: sidePos(0), to: center.position.clone(), t: 0, spin: 0 });
        center.position.copy(sidePos(0));
      }
      pile.userData.pile = true;
      this.pileObj = center;
      this.gameGroup.add(pile);
      this.clickables.push(center);
    } else this.pileObj = null;
    this.prevPile = v.pileCount;

    if (v.indicator) {
      const m = tileMesh(v.indicator, true);
      m.scale.setScalar(FLAT);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = readRot;
      const ind = right.clone().multiplyScalar(0.13);
      m.position.set(ind.x, TABLE_Y + 0.01, ind.z);
      this.gameGroup.add(m);
      if (v.okeyBirTile) {
        const o = tileMesh(v.okeyBirTile, true);
        o.scale.setScalar(FLAT);
        o.rotation.x = -Math.PI / 2;
        o.rotation.z = readRot + 0.3;
        o.position.set(ind.x + 0.01, TABLE_Y + 0.03, ind.z + 0.01);
        this.gameGroup.add(o);
      }
    }

    // Abwürfe: rechts vom Werfer (zwischen s und s+1)
    for (let s = 0; s < 4; s++) {
      const a = seatPos(s);
      const b = seatPos((s + 1) % 4);
      const corner = this.discardSpot(s);
      void b;
      const pile = v.finisher === s ? v.discards[s].slice(0, -1) : v.discards[s];
      const shown = pile.slice(-4);
      shown.forEach((tile, i) => {
        const m = tileMesh(tile, true);
        m.scale.setScalar(FLAT);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = readRot + (i - shown.length + 1) * 0.08;
        m.position.set(corner.x, TABLE_Y + 0.01 + i * 0.021, corner.z);
        const isTop = i === shown.length - 1;
        // oberster Stein: etwas größer und schräg zu mir aufgestellt → aus der normalen Sicht lesbar
        if (isTop && s !== v.mySeat) this.tiltToViewer(m, v.mySeat ?? this.mySeat ?? 0);
        if (isTop && this.prevDiscards[s] !== undefined && pile.length === this.prevDiscards[s] + 1) {
          const from = seatPos(s).multiplyScalar(0.47);
          this.flyers.push({ m, from: new THREE.Vector3(from.x, TABLE_Y + 0.09, from.z), to: m.position.clone(), t: 0, spin: (Math.random() - 0.5) * 3 });
          m.position.copy(this.flyers[this.flyers.length - 1].from);
        }
        if (isTop && v.mySeat !== null && (s + 1) % 4 === v.mySeat) {
          this.sideObj = m;
          m.userData.side = true;
          this.clickables.push(m);
        }
        this.gameGroup.add(m);
      });
    }

    // Beendet: letzter Stein liegt offen in der Mitte (wie am echten Tisch)
    if (v.finisher !== null && v.finisher !== undefined) {
      const last = v.discards[v.finisher][v.discards[v.finisher].length - 1];
      if (last) {
        const m = tileMesh(last, true);
        m.scale.setScalar(FLAT * 1.15);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = readRot + 0.25;
        m.position.set(0.015, TABLE_Y + 0.075, 0.03);
        const glow = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 32), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.85 }));
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(0.015, TABLE_Y + 0.003, 0.03);
        this.gameGroup.add(m, glow);
        if (this.prevDiscards[v.finisher] !== undefined && v.discards[v.finisher].length === this.prevDiscards[v.finisher] + 1) {
          const from = seatPos(v.finisher).multiplyScalar(0.47);
          this.flyers.push({ m, from: new THREE.Vector3(from.x, TABLE_Y + 0.12, from.z), to: m.position.clone(), t: 0, spin: 2 });
          m.position.copy(this.flyers[this.flyers.length - 1].from);
        }
      }
    }
    this.prevDiscards = v.discards.map((d) => d.length);
    // Köpfe schauen zum Spieler am Zug
    this.avatars.forEach((a, s) => {
      if (!a) return;
      if (s === v.current) a.lookAtYaw(0);
      else {
        const target = seatPos(v.current).multiplyScalar(1.0).add(this.tableRoot.position);
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


  }

  // ------------------------------------------------------------ Fernseher

  setTvVisible(v: boolean) {
    for (const t of this.tvs) {
      t.css.visible = v && !this.tvPowerOff;
      t.hole.visible = v && !this.tvPowerOff;
      t.screen.visible = !(v && !this.tvPowerOff);
    }
  }
  /** Fernseher ganz aus: schwarzer Bildschirm, kein Standbild, kein Video */
  private tvPowerOff = false;
  private tvBlack = new THREE.MeshBasicMaterial({ color: '#050506' });
  private tvStandbyMat: THREE.Material | null = null;
  setTvPower(on: boolean) {
    this.tvPowerOff = !on;
    for (const t of this.tvs) {
      if (!this.tvStandbyMat) this.tvStandbyMat = t.screen.material as THREE.Material;
      t.screen.material = on ? this.tvStandbyMat : this.tvBlack;
      if (!on) {
        t.css.visible = false;
        t.hole.visible = false;
        t.screen.visible = true;
      }
    }
  }

  // ------------------------------------------------------------ Loop

  private resize() {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.viewKey = '';
    this.applyView(w, h);
    this.renderer.setSize(w, h);
    this.css.setSize(w, h);
  }

  /** Handy: unten verdeckt die Istaka den Bildschirm → Tisch in den freien Bereich darüber rücken */
  bottomInset = 0;
  private viewKey = '';
  private insetCheck = 0;
  private applyView(w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight) {
    const inset = this.seated !== null && !this.third && document.body.classList.contains('phone') ? this.bottomInset : 0;
    const key = `${w}x${h}:${Math.round(inset)}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    if (inset > 40 && inset < h * 0.6) {
      const hv = h - inset;
      this.camera.aspect = w / hv;
      this.camera.setViewOffset(w, hv, 0, 0, w, h);
    } else {
      this.camera.aspect = w / h;
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }
  /** steht beim Laufen ein Stuhl vor einem? (für den „Hinsetzen“-Knopf) */
  chairAhead() {
    if (this.seated !== null) return false;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = this.raycaster.intersectObjects(this.chairs, true)[0];
    return !!hit && hit.distance < 2.6;
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // Kamera
    this.pollPad(dt);
    if (this.tvWatch !== null && this.tvs[this.tvWatch]) {
      const v = this.tvView(this.tvWatch);
      this.camera.position.lerp(v.pos, 1 - Math.pow(0.002, dt));
      this.camLook.lerp(v.look, 1 - Math.pow(0.0005, dt));
      this.camera.lookAt(this.camLook);
      if (this.selfAvatar) this.selfAvatar.root.visible = false;
      if (this.moveInput.x || this.moveInput.y) this.watchTv(null);
    } else if (this.camTarget) {
      // Zuschauer-Stuhl: losgehen = aufstehen
      if (this.lounge) {
        const K = settings.keys;
        const mv = this.moveInput.x || this.moveInput.y || [K.forward, K.back, K.left, K.right, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => this.keys.has(k));
        if (mv) this.onLoungeStand?.();
      }
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
      let camPos = pos;
      if (this.third && this.seated !== null) {
        // eigene Figur von hinten / vorne
        const dir = seatPos(this.seated);
        const head = dir.clone().multiplyScalar(1.04).add(this.tableRoot.position);
        head.y = 1.42;
        if (this.third === 'back') {
          camPos = head.clone().add(dir.clone().multiplyScalar(1.5)).add(new THREE.Vector3(0, 0.55, 0));
          look = head.clone().add(dir.clone().multiplyScalar(-1.0)).add(new THREE.Vector3(0, -0.45, 0));
        } else {
          camPos = head.clone().add(dir.clone().multiplyScalar(-0.95)).add(new THREE.Vector3(0, 0.05, 0));
          look = head.clone().add(new THREE.Vector3(0, -0.12, 0));
        }
      }
      const kpos = 1 - Math.pow(this.third ? 0.0005 : 0.002, dt);
      this.camera.position.lerp(camPos, kpos);
      this.camLook.lerp(look, 1 - Math.pow(0.0005, dt));
      this.camera.lookAt(this.camLook);
      if (this.selfAvatar) this.selfAvatar.root.visible = false;
    } else {
      const speed = 2.2 * dt;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const K = settings.keys;
      let mx = this.moveInput.x;
      let my = this.moveInput.y;
      if (this.keys.has(K.forward) || this.keys.has('ArrowUp')) my += 1;
      if (this.keys.has(K.back) || this.keys.has('ArrowDown')) my -= 1;
      if (this.keys.has(K.left) || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has(K.right) || this.keys.has('ArrowRight')) mx += 1;
      const ml = Math.hypot(mx, my);
      if (ml > 1) {
        mx /= ml;
        my /= ml;
      }
      const prev = this.walkPos.clone();
      this.walkPos.addScaledVector(fwd, speed * my).addScaledVector(right, speed * mx);
      this.collide(prev);
      const moved = Math.hypot(this.walkPos.x - prev.x, this.walkPos.z - prev.z) / Math.max(dt, 1e-4);
      this.walkPos.y = 1.6 + Math.sin(t * 8) * (moved > 0.2 ? 0.015 : 0);
      const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      // eigene Figur (nur in der 3rd-Person-Ansicht sichtbar)
      const me = this.selfAvatar;
      if (me) {
        me.root.visible = !!this.third;
        me.root.position.set(this.walkPos.x, 0.72, this.walkPos.z);
        facing(me.root, -fwd.x, -fwd.z);
        me.setWalking(moved);
        me.update(dt);
      }
      if (this.third) {
        const head = new THREE.Vector3(this.walkPos.x, 1.55, this.walkPos.z);
        const camPos =
          this.third === 'back'
            ? head.clone().addScaledVector(fwd, -2.1).add(new THREE.Vector3(0, 0.45, 0))
            : head.clone().addScaledVector(fwd, 1.6).add(new THREE.Vector3(0, 0.05, 0));
        this.camera.position.lerp(camPos, 1 - Math.pow(0.0005, dt));
        this.camera.lookAt(this.third === 'back' ? head.clone().addScaledVector(fwd, 1.5).add(new THREE.Vector3(0, -0.2, 0)) : head);
      } else {
        this.camera.position.lerp(this.walkPos, 0.3);
        this.camera.lookAt(this.camera.position.clone().add(look));
      }
      // Hover über Stühlen
      this.raycaster.setFromCamera(this.rayNdc(), this.camera);
      const hit = this.third ? undefined : this.raycaster.intersectObjects(this.chairs, true)[0];
      let hc: THREE.Object3D | null = hit && hit.distance < 4 ? hit.object : null;
      while (hc && !this.chairs.includes(hc as THREE.Group)) hc = hc.parent;
      if (hc !== this.hoverChairObj) {
        for (const c of [this.hoverChairObj, hc]) {
          if (!c) continue;
          const on = c === hc;
          c.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (m?.emissive) m.emissive.set(on ? '#5a3a00' : '#000000');
          });
        }
        this.hoverChairObj = hc;
        this.hoverChair = hc ? hc.userData.seat : -1;
      }
    }
    // Brett leuchtet, wenn man es beim Umschauen anvisiert
    let boardHover = false;
    if (this.seated !== null && !this.focus) boardHover = !!this.pickNdc(new THREE.Vector2(0, 0), [...this.tableMeshes, ...this.clickables]);
    if (boardHover !== this.boardHover) {
      this.boardHover = boardHover;
      for (const m of this.tableMeshes) {
        const mm = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mm.emissive?.set(boardHover ? '#3a2a00' : '#000000');
      }
    }
    // Handy: freien Bereich über der Istaka messen (alle ~0,4 s)
    this.insetCheck -= dt;
    if (this.insetCheck <= 0) {
      this.insetCheck = 0.4;
      const wrap = document.querySelector('.istaka-wrap') as HTMLElement | null;
      const r = wrap?.getBoundingClientRect();
      this.bottomInset = r && r.height > 0 ? Math.max(0, innerHeight - r.top) : 0;
    }
    this.applyView();
    // Zoom
    let fov = this.zooming ? 30 : this.seated !== null && !this.third ? settings.fovTable : settings.fovWalk;
    // sehr breites Bild (Handy quer): horizontales Sichtfeld wie bei 16:9 halten → Tisch wird größer
    const fullAspect = (this.container.clientWidth || innerWidth) / (this.container.clientHeight || innerHeight);
    if (this.seated !== null && !this.third && !this.zooming && fullAspect > 1.9)
      fov = (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1.9 / fullAspect)) * 180) / Math.PI;
    // Bild über der Istaka: etwas weiter als Vollbild, damit der ganze Tisch reinpasst
    if (this.camera.view?.enabled && !this.zooming) {
      const k = this.camera.view.fullHeight / (this.container.clientHeight || innerHeight);
      fov = (2 * Math.atan((Math.tan((fov * Math.PI) / 360) * k) / 0.9) * 180) / Math.PI;
    }
    // Handy am Tisch: etwas enger → Steine größer
    if (this.seated !== null && !this.third && !this.zooming && document.body.classList.contains('phone')) fov *= 0.9;
    // Hochformat (Handy): horizontales Sichtfeld erhalten
    if (this.camera.aspect < 1.4 && !this.zooming) fov = Math.min(105, (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1.4 / this.camera.aspect)) * 180) / Math.PI);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.pow(0.0001, dt));
      this.camera.updateProjectionMatrix();
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.camera.position.y += Math.sin(t * 90) * 0.004;
    }

    // Pişti-Animationen
    for (let i = this.pistiAnims.length - 1; i >= 0; i--) {
      const an = this.pistiAnims[i];
      an.t += dt;
      const k = Math.min(1, an.t / an.dur);
      an.step(k, an.t);
      if (k >= 1) {
        this.pistiAnims.splice(i, 1);
        an.done?.();
      }
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
    this.updateWalkers(dt);
    this.city?.update(dt);
    for (const [i, pg] of this.pigeons.entries()) {
      const peck = Math.max(0, Math.sin(t * 3 + i * 1.7)) ** 6;
      (pg.userData.head as THREE.Object3D).position.y = 0.18 - peck * 0.09;
      (pg.userData.beak as THREE.Object3D).position.y = 0.18 - peck * 0.09;
      if (Math.random() < dt * 0.15) pg.rotation.y += (Math.random() - 0.5) * 1.5;
    }
    if (Math.random() < dt * 0.05) sfx.murmur();
    // Rauchringe
    for (let i = this.ringList.length - 1; i >= 0; i--) {
      const r = this.ringList[i];
      r.life += dt;
      r.m.position.addScaledVector(r.v, dt);
      r.v.multiplyScalar(0.993);
      r.m.scale.setScalar(1 + r.life * 1.3);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, r.life * 5) * Math.max(0, 1 - r.life / 3.2);
      if (r.life > 3.2) {
        this.scene.remove(r.m);
        (r.m.material as THREE.Material).dispose();
        this.ringList.splice(i, 1);
      }
    }
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
      if (settings.smoke && Math.random() < dt * 0.25) this.puff(sh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.84, 0)), 1, new THREE.Vector3(0, 0.12, 0), 0.5);
    }
    if (Math.random() < dt * 0.02) this.applyTimeOfDay();

    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ Çaycı + Bestellungen

  private cayciTray: THREE.Group | null = null;
  /** Ahmet räumt gerade leere Gläser ab (für Sprachaufnahme) */
  onAhmetClear: (() => void) | null = null;
  private cayciQueue: { seat: number; item: OrderItem; variant: number }[] = [];
  private cayciPath: THREE.Vector3[] = [];
  private cayciHome = new THREE.Vector3(3.6, 0, -3.6);

  /** kleiner Beistelltisch (Sehpa) links neben jedem Platz – dort landet der Çay */
  private sehpas: THREE.Group[] = [];
  private buildSehpa(seat: number) {
    const frame = new THREE.Group();
    const dir = seatPos(seat);
    frame.position.set(dir.x * 1.04, 0.45, dir.z * 1.04);
    facing(frame, dir.x, dir.z);
    const g = new THREE.Group();
    g.position.set(-0.58, -0.45, -0.12);
    const wood = new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a04a', metalness: 0.8, roughness: 0.3 });
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.5, 10), wood);
    leg.position.y = 0.25;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.03, 16), wood);
    foot.position.y = 0.015;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.03, 24), wood);
    top.position.y = 0.515;
    // Messingtablett (Sini)
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.008, 28), brass);
    tray.position.y = 0.534;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.006, 6, 28), brass);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.538;
    g.add(leg, foot, top, tray, rim);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    frame.add(g);
    this.tableRoot.add(frame);
    this.sehpas[seat] = g;
  }

  /** Bestellung als 3D-Objekt auf die Sehpa stellen (max. 3 pro Platz) */
  private placeOrder(seat: number, item: OrderItem, variant = 0) {
    const list = this.orders[seat];
    const sehpa = this.sehpas[seat];
    if (list.length >= 3) sehpa.remove(list.shift()!);
    const slots = [new THREE.Vector3(0, 0, 0.02), new THREE.Vector3(0.085, 0, -0.06), new THREE.Vector3(-0.085, 0, -0.06)];
    const m = this.orderMesh(item, variant);
    m.userData.placed = performance.now();
    list.push(m);
    list.forEach((o, k) => o.position.copy(slots[k]).setY(0.54));
    sehpa.add(m);
  }

  /** Çaycı rufen: kommt an den Tisch und bringt die Bestellung */
  order(seat: number, item: OrderItem, variant = 0) {
    this.cayciQueue.push({ seat, item, variant });
    // Ahmet braucht etwas, bis er kommt (Tee aufgießen …)
    if (this.cayciState.phase === 'idle' && this.cayciQueue.length === 1) this.cayciState.t = 7 + Math.random() * 6;
    if (this.cayciQueue.length === 1) this.cayci.say(['Geliyor abi!', 'Hemen!', 'Tamam usta!', 'Baş üstüne!'][Math.floor(Math.random() * 4)]);
  }

  /** Weg vom Çaycı zum Ziel (durch die Tür, falls im Garten) */
  private routeTo(target: THREE.Vector3) {
    const doorIn = new THREE.Vector3(0, 0, ROOM.d / 2 - 0.6);
    const doorOut = new THREE.Vector3(0, 0, ROOM.d / 2 + 0.7);
    const from = this.cayciState.pos;
    const out = (v: THREE.Vector3) => v.z > ROOM.d / 2;
    const path: THREE.Vector3[] = [];
    if (out(from) !== out(target)) path.push(out(from) ? doorOut : doorIn, out(from) ? doorIn : doorOut);
    path.push(target);
    // nie über den Tisch: Strecken, die zu nah an der Tischmitte vorbeiführen, im Bogen umgehen
    const c = this.tableRoot.position;
    const R = 1.72;
    const res: THREE.Vector3[] = [];
    let prev = from.clone();
    for (const p of path) {
      const ab = p.clone().sub(prev).setY(0);
      const t = ab.lengthSq() > 0 ? Math.max(0, Math.min(1, new THREE.Vector3(c.x - prev.x, 0, c.z - prev.z).dot(ab) / ab.lengthSq())) : 0;
      const closest = prev.clone().addScaledVector(ab, t);
      if (Math.hypot(closest.x - c.x, closest.z - c.z) < R - 0.05) {
        let a0 = Math.atan2(prev.z - c.z, prev.x - c.x);
        const a1 = Math.atan2(p.z - c.z, p.x - c.x);
        let d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(d) / 0.35));
        for (let k = 0; k <= steps; k++) {
          const a = a0 + (d * k) / steps;
          res.push(new THREE.Vector3(c.x + Math.cos(a) * R, 0, c.z + Math.sin(a) * R));
        }
      }
      res.push(p.clone());
      prev = p;
    }
    this.cayciPath = res;
  }

  private updateCaycı(dt: number) {
    const st = this.cayciState;
    st.t -= dt;
    let walking = false;
    const step = () => {
      const target = this.cayciPath[0];
      if (!target) return true;
      const d = target.clone().sub(st.pos);
      d.y = 0;
      const dist = d.length();
      if (dist < 0.05) {
        this.cayciPath.shift();
        return this.cayciPath.length === 0;
      }
      d.setLength(Math.min(dist, dt * 1.25));
      st.pos.add(d);
      facing(this.cayci.root, -d.x, -d.z);
      walking = true;
      return false;
    };
    const tableP = (seat: number) => {
      const p = this.sehpas[seat].getWorldPosition(new THREE.Vector3());
      const c = this.tableRoot.position;
      const out = new THREE.Vector3(p.x - c.x, 0, p.z - c.z).normalize();
      return new THREE.Vector3(p.x, 0, p.z).addScaledVector(out, 0.42);
    };
    if (st.phase === 'idle' && st.t <= 0) {
      // kommt, wenn jemand bestellt hat – oder ab und zu zum Abräumen
      if (this.cayciQueue.length) {
        st.phase = 'go';
        st.clearSeat = null;
        this.routeTo(tableP(this.cayciQueue[0].seat));
      } else {
        st.t = 0.5;
        st.clearCheck -= 0.5;
        if (st.clearCheck <= 0) {
          st.clearCheck = 25 + Math.random() * 35;
          const seat = this.oldOrderSeat(90_000);
          if (seat !== null) {
            st.phase = 'go';
            st.clearSeat = seat;
            this.routeTo(tableP(seat));
          }
        }
      }
    } else if (st.phase === 'go' && step()) {
      st.phase = 'serve';
      st.t = 1.4;
      const c = this.tableRoot.position;
      facing(this.cayci.root, st.pos.x - c.x, st.pos.z - c.z);
      this.cayci.emote('rubhands');
      // leere Gläser von vorhin mitnehmen
      const cleared = this.clearOld(60_000);
      if (st.clearSeat !== null && !this.cayciQueue.length) {
        st.clearSeat = null;
        sfx.spoon();
        if (cleared) {
          this.cayci.say(['Boşları alayım', 'Müsaadenizle…', 'Bir tazesini getireyim mi?'][Math.floor(Math.random() * 3)]);
          this.onAhmetClear?.();
        }
      } else {
        // alle Bestellungen für diesen Tisch abstellen
        for (const o of this.cayciQueue) this.placeOrder(o.seat, o.item, o.variant);
        this.cayciQueue = [];
        sfx.spoon();
        this.cayci.say(['Afiyet olsun!', 'Buyrun!', 'Taze demledim!'][Math.floor(Math.random() * 3)]);
      }
    } else if (st.phase === 'serve' && st.t <= 0) {
      st.phase = 'back';
      this.routeTo(this.cayciHome.clone());
    } else if (st.phase === 'back' && step()) {
      st.phase = 'idle';
      st.t = 0;
      facing(this.cayci.root, 0, 1);
    }
    this.cayci.setWalking(walking ? 1.25 : 0);
    this.cayci.root.position.set(st.pos.x, 0.72, st.pos.z);
    this.cayci.update(dt);
    // Tablett in Ahmets rechter Hand (Avaturn-Figur), sonst feste Stelle
    const hand = this.cayci.real?.handWorld('R') ?? this.cayci.real?.handWorld('L');
    if (this.cayciTray && hand) {
      this.cayci.root.updateMatrixWorld(true);
      const local = this.cayci.root.worldToLocal(hand.clone());
      this.cayciTray.position.set(local.x, local.y + 0.06, local.z + 0.04);
    }
  }

  /** Platz, an dem etwas schon länger steht (zum Abräumen) */
  private oldOrderSeat(ageMs: number): number | null {
    const now = performance.now();
    for (let s = 0; s < 4; s++) if (this.orders[s].some((o) => now - (o.userData.placed ?? now) > ageMs)) return s;
    return null;
  }
  /** Ahmet räumt alles weg, was älter ist (an allen Plätzen des Tisches) */
  private clearOld(ageMs: number) {
    const now = performance.now();
    let n = 0;
    for (let s = 0; s < 4; s++) {
      const keep: THREE.Object3D[] = [];
      for (const o of this.orders[s]) {
        if (now - (o.userData.placed ?? now) > ageMs) {
          o.parent?.remove(o);
          n++;
        } else keep.push(o);
      }
      this.orders[s] = keep;
    }
    return n;
  }

  /** echtes 3D-Modell (Sketchfab / selbst gebaut) in die Gruppe laden */
  private itemModel(g: THREE.Group, file: string, pick?: string) {
    void loadModel('items/' + file)
      .then((root) => {
        let obj: THREE.Object3D = root;
        if (pick) {
          const found = root.getObjectByName(pick);
          if (!found) return console.warn('item fehlt', pick, root.children.map((c) => c.name));
          obj = found;
          obj.position.set(0, 0, 0);
        }
        // Modelle sind in echten Metern; die Gruppe wird unten × 1.4 skaliert
        obj.scale.multiplyScalar(0.82);
        g.clear();
        g.add(obj);
      })
      .catch((e) => console.warn('item', file, e));
  }

  private orderMesh(item: OrderItem, variant = 0) {
    const g = new THREE.Group();
    const saucer = (col: string) => {
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.008, 20), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 }));
      g.add(sc);
    };
    const glassTea = (col: string) => {
      const gl = new THREE.Mesh(
        new THREE.LatheGeometry([new THREE.Vector2(0.018, 0), new THREE.Vector2(0.024, 0.02), new THREE.Vector2(0.018, 0.045), new THREE.Vector2(0.026, 0.085)], 16),
        new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.85, roughness: 0.05, side: THREE.DoubleSide }),
      );
      gl.position.y = 0.006;
      g.add(gl);
      const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.002, 0.07), new THREE.MeshStandardMaterial({ color: '#ccc', metalness: 0.8 }));
      spoon.position.set(0.035, 0.008, 0);
      g.add(spoon);
    };
    switch (item) {
      case 'cay':
        saucer('#d33');
        glassTea('#a8331a');
        this.itemModel(g, 'cay');
        break;
      case 'icecek': {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 14), new THREE.MeshStandardMaterial({ color: '#b22', metalness: 0.6, roughness: 0.3 }));
        can.position.y = 0.045;
        g.add(can);
        this.itemModel(g, 'drinks', DRINKS[variant % DRINKS.length]);
        break;
      }
      case 'oralet':
        saucer('#f2f2f2');
        glassTea('#e8862a');
        break;
      case 'kahve': {
        saucer('#f4f1ea');
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.045, 16), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.3 }));
        cup.position.y = 0.027;
        const foam = new THREE.Mesh(new THREE.CircleGeometry(0.023, 16), new THREE.MeshStandardMaterial({ color: '#6b4a2a' }));
        foam.rotation.x = -Math.PI / 2;
        foam.position.y = 0.049;
        const lok = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.018), new THREE.MeshStandardMaterial({ color: '#f2b8c6', roughness: 0.9 }));
        lok.position.set(0.034, 0.013, 0.012);
        g.add(cup, foam, lok);
        // Wasserglas daneben
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.07, 12), new THREE.MeshStandardMaterial({ color: '#dff0f6', transparent: true, opacity: 0.45 }));
        w.position.set(-0.06, 0.035, 0);
        g.add(w);
        break;
      }
      case 'su': {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.019, 0.09, 14), new THREE.MeshStandardMaterial({ color: '#dff0f6', transparent: true, opacity: 0.45, roughness: 0.05 }));
        w.position.y = 0.045;
        g.add(w);
        this.itemModel(g, 'su');
        break;
      }
      case 'sahlep': {
        const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.027, 0.075, 16), new THREE.MeshStandardMaterial({ color: '#c0442a', roughness: 0.5 }));
        mug.position.y = 0.038;
        const top = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), new THREE.MeshStandardMaterial({ color: '#efe3cc' }));
        top.rotation.x = -Math.PI / 2;
        top.position.y = 0.076;
        const cin = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), new THREE.MeshStandardMaterial({ color: '#8a5a2a' }));
        cin.rotation.x = -Math.PI / 2;
        cin.position.y = 0.077;
        g.add(mug, top, cin);
        break;
      }
      case 'kuruyemis': {
        const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c8a26a', side: THREE.DoubleSide }));
        bowl.position.y = 0.045;
        g.add(bowl);
        const cols = ['#d9b98a', '#8a5a2a', '#b5793e', '#e8d7b0', '#6b8a3a'];
        for (let i = 0; i < 14; i++) {
          const n = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5), new THREE.MeshStandardMaterial({ color: cols[i % cols.length] }));
          const a = i * 2.4;
          const r = 0.01 + (i % 4) * 0.008;
          n.position.set(Math.cos(a) * r, 0.03 + (i % 3) * 0.006, Math.sin(a) * r);
          n.scale.set(1, 0.7, 1.3);
          g.add(n);
        }
        this.itemModel(g, 'kuruyemis');
        break;
      }
    }
    g.scale.setScalar(1.4);
    return g;
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
    cam.position.set(0.22, 0.42, 3.75);
    cam.lookAt(0.22, 0.32, 0);
    const mk = (sp: Avatar, n: string) => {
      const av = new Avatar3D(sp, n, { standing: true });
      av.root.scale.setScalar(0.88);
      return av;
    };
    let a = mk(spec, name);
    scene.add(a.root);
    let sh = makeShisha((spec.shisha as ShishaStyle) ?? 'classic');
    sh.position.set(0.68, -0.72, 0.05);
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
    new ResizeObserver(() => resize()).observe(container);
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
        a = mk(s, n);
        scene.add(a.root);
        scene.remove(sh);
        sh = makeShisha((s.shisha as ShishaStyle) ?? 'classic');
        sh.position.set(0.68, -0.72, 0.05);
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
