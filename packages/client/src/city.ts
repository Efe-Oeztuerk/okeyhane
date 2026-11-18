// Echte 3D-Außenwelt um das Kahvehane: Straße mit Gehwegen, Häuserzeilen mit Fenstern,
// Läden, Balkonen, Bäume, Ampel, fahrende Autos, Sonne/Mond mit Sternen.

import * as THREE from 'three';
import * as D from './decor.ts';

type Mode = 'day' | 'evening' | 'night';

// gleichbleibender Zufall (jeder Spieler sieht dieselbe Stadt)
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FACADES = ['#e8a35c', '#e07a5f', '#f2cc8f', '#d4a5a5', '#c97b63', '#9fb8ad', '#e9c46a', '#cfa07d', '#b5838d', '#e5989b', '#a3b18a', '#d9b8a0'];
const TOWERS = ['#f4c6c6', '#f7d6e0', '#c9d6f2', '#e8d5f2', '#f6e1c8', '#d5e8f2'];
const SHOPS = ['BAKKAL', 'FIRIN', 'BERBER', 'ECZANE', 'KUAFÖR', 'LOKANTA', 'BÜFE', 'TERZİ', 'KASAP', 'PASTANE', 'ÇİÇEKÇİ', 'KIRTASİYE'];
const AWNINGS = ['#c0392b', '#2d6a4f', '#1d4e89', '#e9c46a', '#6d597a', '#d35400'];

const mats = new Map<string, THREE.Material>();
function std(color: string, rough = 0.95) {
  const k = 's' + color + rough;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough })));
  return m as THREE.MeshStandardMaterial;
}

function stripeTex(color: string) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f4efe4' : color;
    g.fillRect(i * 8, 0, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

interface Car {
  g: THREE.Group;
  speed: number;
  lights: THREE.MeshBasicMaterial[];
}

export class City {
  group = new THREE.Group();
  private windows!: THREE.InstancedMesh;
  private litMask: boolean[] = [];
  private shopGlass: THREE.MeshStandardMaterial[] = [];
  private cars: Car[] = [];
  private sunDisc: THREE.Mesh;
  private moonDisc: THREE.Mesh;
  private stars: THREE.Points;
  private trafficLights: { red: THREE.MeshBasicMaterial; green: THREE.MeshBasicMaterial }[] = [];
  private mode: Mode = 'day';
  /** Richtung zur Sonne (für das Sonnenlicht) */
  sunDir = new THREE.Vector3(0.3, 0.8, 0.5);
  sunUp = 1;

  /**
   * z1 = Ende des Gartens (Gehweg beginnt), cafeHalfW = halbe Breite des Kahvehane, facadeZ = Vorderwand
   */
  constructor(private z1: number, cafeHalfW: number, facadeZ: number) {
    const r = rng(7);
    const G = this.group;
    const winM: THREE.Matrix4[] = [];

    // ---------- Straße, Bordsteine, Gehwege
    const roadZ0 = z1 + 1.8;
    const roadZ1 = z1 + 8.2;
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(140, roadZ1 - roadZ0), std('#3b3a3c', 1));
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.set(0, -0.015, (roadZ0 + roadZ1) / 2);
    asphalt.receiveShadow = true;
    G.add(asphalt);
    const walk = std('#b9ad9a', 1);
    const curb = std('#8f8a82', 0.9);
    for (const [za, zb] of [
      [z1, roadZ0],
      [roadZ1, z1 + 10],
    ]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(140, 0.12, zb - za), walk);
      s.position.set(0, 0.04, (za + zb) / 2);
      s.receiveShadow = true;
      G.add(s);
      const c = new THREE.Mesh(new THREE.BoxGeometry(140, 0.16, 0.18), curb);
      c.position.set(0, 0.06, za === z1 ? zb - 0.09 : za + 0.09);
      G.add(c);
    }
    // Mittellinie (gestrichelt) + Zebrastreifen
    const paint = new THREE.MeshBasicMaterial({ color: '#e9e4d4' });
    for (let x = -68; x < 68; x += 4) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.14), paint);
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0, (roadZ0 + roadZ1) / 2);
      G.add(d);
    }
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.6), paint);
      s.rotation.x = -Math.PI / 2;
      s.position.set(-9 + i * 0.9, 0.001, (roadZ0 + roadZ1) / 2);
      G.add(s);
    }
    // Boden ringsum (damit nichts „in der Luft“ hängt)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), std('#8a8070', 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.04, z1);
    G.add(ground);

    // ---------- Gebäude-Helfer
    const building = (x: number, z: number, w: number, h: number, d: number, faceDir: 1 | -1, color: string, shop: boolean, rot = 0) => {
      const b = new THREE.Group();
      // leichtes Eigenleuchten, damit die Pastellfarben auch im Schatten freundlich bleiben
      const bodyM = std(color).clone();
      bodyM.emissive = new THREE.Color(color).multiplyScalar(0.18);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyM);
      body.position.y = h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      b.add(body);
      const trim = std(new THREE.Color(color).multiplyScalar(0.78).getStyle(), 0.9);
      // Dachgesims + Stockwerksbänder
      const corn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3), trim);
      corn.position.y = h + 0.12;
      b.add(corn);
      const floors = Math.max(2, Math.floor(h / 3));
      const fh = h / floors;
      const fz = (d / 2) * faceDir;
      for (let f = 1; f < floors; f++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.12, 0.1), trim);
        band.position.set(0, f * fh, fz + 0.03 * faceDir);
        b.add(band);
      }
      // Fenster
      const cols = Math.max(1, Math.floor((w - 0.6) / 1.5));
      const startF = shop ? 1 : 0;
      for (let f = startF; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const wx = -w / 2 + (w / cols) * (c + 0.5);
          const wy = f * fh + fh * 0.52;
          const m = new THREE.Matrix4().compose(new THREE.Vector3(wx, wy, fz + 0.02 * faceDir), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, faceDir < 0 ? Math.PI : 0, 0)), new THREE.Vector3(1, 1, 1));
          winM.push(new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(rot)).multiply(m));
          this.litMask.push(r() < 0.38);
          // Balkon manchmal
          if (f >= 1 && r() < 0.18) {
            const slab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.6), trim);
            slab.position.set(wx, f * fh + 0.05, fz + 0.3 * faceDir);
            const rail = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.05), std('#2b2b2b', 0.6));
            rail.position.set(wx, f * fh + 0.35, fz + 0.58 * faceDir);
            b.add(slab, rail);
            if (r() < 0.5) {
              const pot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), std('#3f7d3a'));
              pot.position.set(wx + 0.4, f * fh + 0.3, fz + 0.35 * faceDir);
              b.add(pot);
            }
          }
        }
      }
      // Laden im Erdgeschoss
      if (shop) {
        const glass = new THREE.MeshStandardMaterial({ color: '#2a3a44', roughness: 0.15, metalness: 0.2, emissive: '#000000' });
        this.shopGlass.push(glass);
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 2.1), glass);
        sg.position.set(0, 1.25, fz + 0.02 * faceDir);
        if (faceDir < 0) sg.rotation.y = Math.PI;
        b.add(sg);
        const ac = AWNINGS[Math.floor(r() * AWNINGS.length)];
        const aw = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.06, 1.1), new THREE.MeshStandardMaterial({ map: stripeTex(ac), roughness: 0.9 }));
        (aw.material as THREE.MeshStandardMaterial).map!.repeat.set(w, 1);
        aw.position.set(0, 2.55, fz + 0.5 * faceDir);
        aw.rotation.x = 0.32 * faceDir;
        b.add(aw);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.7, 3.2), 0.5), new THREE.MeshStandardMaterial({ map: D.signText(SHOPS[Math.floor(r() * SHOPS.length)], '#fff3d6', ac), emissive: '#2a1a0a', emissiveIntensity: 0.3 }));
        sign.position.set(0, 2.98, fz + 0.03 * faceDir);
        if (faceDir < 0) sign.rotation.y = Math.PI;
        b.add(sign);
      }
      // Dachaufbauten
      if (r() < 0.5) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10), std('#c9c9c9', 0.5));
        tank.position.set((r() - 0.5) * (w - 1), h + 0.75, 0);
        b.add(tank);
      }
      if (r() < 0.4) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), std('#333', 0.5));
        ant.position.set((r() - 0.5) * (w - 1), h + 1.1, (r() - 0.5) * (d - 1));
        const dish = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), std('#e8e8e8', 0.4));
        dish.rotation.x = Math.PI / 2;
        dish.position.set(ant.position.x + 0.4, h + 0.5, ant.position.z);
        b.add(ant, dish);
      }
      b.position.set(x, 0, z);
      b.rotation.y = rot;
      G.add(b);
    };

    // ---------- Häuserzeile gegenüber (Front zur Straße = -Z)
    {
      let x = -60;
      while (x < 60) {
        const w = 4 + Math.floor(r() * 4);
        const h = 7 + Math.floor(r() * 8);
        building(x + w / 2, z1 + 10 + 4, w, h, 8, -1, FACADES[Math.floor(r() * FACADES.length)], r() < 0.7);
        x += w + (r() < 0.15 ? 2.5 : 0);
      }
    }
    // ---------- Nachbarhäuser links/rechts vom Kahvehane (Front = +Z, bündig mit der Fassade)
    for (const side of [-1, 1]) {
      let x = cafeHalfW + 0.4;
      while (x < 60) {
        const w = 4 + Math.floor(r() * 4);
        const h = 7 + Math.floor(r() * 7);
        building(side * (x + w / 2), facadeZ - 5, w, h, 10, 1, FACADES[Math.floor(r() * FACADES.length)], r() < 0.6);
        x += w;
      }
      // Gehweg vor den Nachbarn (bis zur Straße)
      const s = new THREE.Mesh(new THREE.BoxGeometry(60, 0.12, z1 - facadeZ), walk);
      s.position.set(side * (cafeHalfW + 30.4), 0.04, (z1 + facadeZ) / 2);
      G.add(s);
    }
    // ---------- Hochhäuser dahinter (Skyline, pastell)
    for (let i = 0; i < 16; i++) {
      const w = 7 + r() * 6;
      const h = 18 + r() * 22;
      const x = -70 + i * 9.5 + r() * 3;
      if (Math.abs(x + 22) < 8) continue; // Platz für die Moschee
      building(x, z1 + 30 + r() * 10, w, h, 9, -1, TOWERS[Math.floor(r() * TOWERS.length)], false);
    }
    // dahinter auch im Rücken des Kahvehane
    for (let i = 0; i < 10; i++) {
      const w = 8 + r() * 6;
      building(-45 + i * 10 + r() * 3, facadeZ - 28 - r() * 8, w, 14 + r() * 20, 9, 1, TOWERS[Math.floor(r() * TOWERS.length)], false);
    }

    // Fenster als eine einzige Instanz-Mesh (schnell)
    {
      const geo = new THREE.PlaneGeometry(0.85, 1.2);
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      this.windows = new THREE.InstancedMesh(geo, mat, winM.length);
      winM.forEach((m, i) => this.windows.setMatrixAt(i, m));
      this.windows.instanceMatrix.needsUpdate = true;
      G.add(this.windows);
      // Rahmen
      const fr = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.38, 0.05), std('#f1ece2', 0.8), winM.length);
      const back = new THREE.Matrix4().makeTranslation(0, 0, -0.03);
      winM.forEach((m, i) => fr.setMatrixAt(i, m.clone().multiply(back)));
      G.add(fr);
    }

    // ---------- Bäume + Ampeln + Bänke auf den Gehwegen
    const trunkM = std('#5b3b24');
    const leafM = [std('#4f8a3a'), std('#5e9c42'), std('#3f7a34')];
    const tree = (x: number, z: number, s = 1) => {
      const t = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 2.4 * s, 8), trunkM);
      tr.position.y = 1.2 * s;
      t.add(tr);
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry((0.9 + r() * 0.5) * s, 1), leafM[k % 3]);
        c.position.set((r() - 0.5) * 0.9 * s, (2.6 + r() * 0.9) * s, (r() - 0.5) * 0.9 * s);
        c.castShadow = true;
        t.add(c);
      }
      t.position.set(x, 0.1, z);
      G.add(t);
    };
    for (let x = -46; x <= 46; x += 7.5) if (Math.abs(x) > 4) tree(x + r(), roadZ1 + 0.9, 0.95);
    for (const x of [-12, -19, 12, 19]) tree(x, z1 + 0.9, 0.85);
    // Ampeln am Zebrastreifen
    for (const [x, z, rot] of [
      [-9.8, roadZ0 - 0.4, 0],
      [-2.2, roadZ1 + 0.4, Math.PI],
    ] as const) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3, 8), std('#2b2f3a', 0.5));
      pole.position.y = 1.5;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.25), std('#1d1f24', 0.6));
      box.position.y = 3.2;
      const red = new THREE.MeshBasicMaterial({ color: '#ff3b2f' });
      const green = new THREE.MeshBasicMaterial({ color: '#1f3a24' });
      const l1 = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), red);
      l1.position.set(0, 3.45, 0.13);
      const l2 = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), std('#3a3010'));
      l2.position.set(0, 3.2, 0.13);
      const l3 = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), green);
      l3.position.set(0, 2.95, 0.13);
      g.add(pole, box, l1, l2, l3);
      g.position.set(x, 0.1, z);
      g.rotation.y = rot;
      G.add(g);
      this.trafficLights.push({ red, green });
    }
    for (const x of [-16, 16]) {
      const bench = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.45), std('#7a4e2d'));
      seat.position.y = 0.45;
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.05), std('#7a4e2d'));
      back.position.set(0, 0.7, 0.22);
      bench.add(seat, back);
      bench.position.set(x, 0.1, roadZ1 + 1.3);
      bench.rotation.y = Math.PI;
      G.add(bench);
    }

    // ---------- fahrende Autos
    const colors = ['#d23b2f', '#f2c230', '#3b7bd2', '#2e8b57', '#e8e8e8', '#6c3483', '#f39c12'];
    for (let i = 0; i < 7; i++) {
      const dir = i % 2 ? -1 : 1;
      const lane = dir > 0 ? roadZ0 + 1.6 : roadZ1 - 1.6;
      const car = this.makeCar(colors[i % colors.length], i === 1 || i === 4);
      car.g.position.set(-60 + i * 19 + r() * 6, 0, lane);
      car.g.rotation.y = dir > 0 ? 0 : Math.PI;
      car.speed = (6 + r() * 4) * dir;
      G.add(car.g);
      this.cars.push(car);
    }

    // ---------- Sonne, Mond, Sterne
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshBasicMaterial({ color: '#fff3c4', fog: false, transparent: true }));
    const halo = new THREE.Mesh(new THREE.CircleGeometry(11, 32), new THREE.MeshBasicMaterial({ color: '#ffd77a', fog: false, transparent: true, opacity: 0.25, depthWrite: false }));
    halo.position.z = -0.1;
    this.sunDisc.add(halo);
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), new THREE.MeshBasicMaterial({ color: '#eef1ff', fog: false }));
    const crater = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), new THREE.MeshBasicMaterial({ color: '#cfd5e8', fog: false }));
    crater.position.set(0.9, 0.7, 0.01);
    const crater2 = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), new THREE.MeshBasicMaterial({ color: '#cfd5e8', fog: false }));
    crater2.position.set(-1, -0.5, 0.01);
    this.moonDisc.add(crater, crater2);
    G.add(this.sunDisc, this.moonDisc);
    const sp: number[] = [];
    for (let i = 0; i < 700; i++) {
      const th = r() * Math.PI * 2;
      const ph = Math.acos(0.15 + r() * 0.85);
      sp.push(Math.sin(ph) * Math.cos(th) * 105, Math.cos(ph) * 105, Math.sin(ph) * Math.sin(th) * 105);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.6, fog: false, transparent: true, opacity: 0 }));
    G.add(this.stars);
    this.setMode('day', 13);
  }

  private makeCar(color: string, taxi: boolean): Car {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.7, 1.7), paint);
    body.position.y = 0.6;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 1.55), paint);
    cabin.position.set(-0.15, 1.25, 0);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 1.58), std('#9fc3d8', 0.1));
    win.position.set(-0.15, 1.27, 0);
    g.add(body, cabin, win);
    for (const [wx, wz] of [
      [1.15, 0.8],
      [-1.15, 0.8],
      [1.15, -0.8],
      [-1.15, -0.8],
    ]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14), std('#1b1b1b', 0.9));
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.34, wz);
      g.add(w);
    }
    const lights: THREE.MeshBasicMaterial[] = [];
    for (const lz of [-0.55, 0.55]) {
      const m = new THREE.MeshBasicMaterial({ color: '#fff4c8' });
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), m);
      hl.position.set(1.8, 0.7, lz);
      const tm = new THREE.MeshBasicMaterial({ color: '#7a1010' });
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.25), tm);
      tl.position.set(-1.81, 0.72, lz);
      g.add(hl, tl);
      lights.push(m, tm);
    }
    if (taxi) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.25), new THREE.MeshBasicMaterial({ color: '#ffef9a' }));
      sign.position.set(-0.15, 1.67, 0);
      g.add(sign);
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    return { g, speed: 7, lights };
  }

  /** Tageszeit setzen; hour = Uhrzeit (0–24) für den Stand von Sonne/Mond */
  setMode(mode: Mode, hour: number) {
    this.mode = mode;
    const night = mode === 'night';
    const eve = mode === 'evening';
    // Fenster: tagsüber spiegelnd blau, nachts teils warm erleuchtet
    const c = new THREE.Color();
    for (let i = 0; i < this.litMask.length; i++) {
      if (night || eve) c.set(this.litMask[i] ? (i % 7 === 0 ? '#bfe3ff' : '#ffd98a') : '#1d2533');
      else c.set(i % 5 === 0 ? '#a9c9dc' : '#7fa3b8');
      this.windows.setColorAt(i, c);
    }
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    for (const g of this.shopGlass) {
      g.emissive.set(night || eve ? '#7a5a2a' : '#000000');
      g.emissiveIntensity = night ? 0.9 : 0.5;
    }
    for (const car of this.cars) {
      car.lights[0].color.set(night || eve ? '#fff8d0' : '#d8d2bf');
      car.lights[2].color.set(night || eve ? '#fff8d0' : '#d8d2bf');
      car.lights[1].color.set(night || eve ? '#ff2a2a' : '#7a1010');
      car.lights[3].color.set(night || eve ? '#ff2a2a' : '#7a1010');
    }
    this.placeSky(hour);
  }

  /** Sonne zieht von Osten (-X) über den Süden (+Z) nach Westen (+X) */
  private placeSky(hour: number) {
    const R = 100;
    const a = ((hour - 6) / 12) * Math.PI; // 0 = Aufgang, π = Untergang
    const up = Math.sin(a);
    this.sunDir.set(-Math.cos(a), Math.max(-0.2, up) * 0.85 + 0.05, 0.75).normalize();
    this.sunUp = up;
    this.sunDisc.position.copy(this.sunDir).multiplyScalar(R).add(new THREE.Vector3(0, 0, this.z1));
    this.sunDisc.lookAt(0, 0, this.z1);
    this.sunDisc.visible = up > -0.05;
    const sm = this.sunDisc.material as THREE.MeshBasicMaterial;
    sm.color.set(up < 0.3 ? '#ffb064' : '#fff3c4');
    // Mond: gegenüber der Sonne
    const b = (((hour + 6) % 24) / 12) * Math.PI;
    const mup = Math.sin(b);
    const md = new THREE.Vector3(-Math.cos(b), Math.max(0.1, mup) * 0.8 + 0.08, 0.7).normalize();
    this.moonDisc.position.copy(md).multiplyScalar(R * 0.95).add(new THREE.Vector3(0, 0, this.z1));
    this.moonDisc.lookAt(0, 0, this.z1);
    this.moonDisc.visible = this.mode === 'night' || (this.mode === 'evening' && mup > 0);
    (this.stars.material as THREE.PointsMaterial).opacity = this.mode === 'night' ? 0.9 : this.mode === 'evening' ? 0.25 : 0;
    this.stars.position.z = this.z1;
  }

  /** Richtung des Mondes (für das Nachtlicht) */
  moonDir() {
    return this.moonDisc.position.clone().sub(new THREE.Vector3(0, 0, this.z1)).normalize();
  }

  private lightT = 0;
  update(dt: number) {
    // Autos fahren, bremsen kurz am Zebrastreifen bei Rot
    const redForCars = Math.floor(this.lightT / 9) % 2 === 1;
    this.lightT += dt;
    for (const car of this.cars) {
      const x = car.g.position.x;
      const atCross = car.speed > 0 ? x > -16 && x < -11.5 : x < -1 && x > -5.5;
      const v = redForCars && atCross ? 0 : car.speed;
      car.g.position.x += v * dt;
      if (car.g.position.x > 70) car.g.position.x = -70;
      if (car.g.position.x < -70) car.g.position.x = 70;
      // Räder drehen
      car.g.children.forEach((ch) => {
        if ((ch as THREE.Mesh).geometry?.type === 'CylinderGeometry') ch.rotation.y -= (v * dt) / 0.34;
      });
    }
    for (const tl of this.trafficLights) {
      tl.red.color.set(redForCars ? '#ff3b2f' : '#3a1210');
      tl.green.color.set(redForCars ? '#1f3a24' : '#3bff6a');
    }
  }
}
