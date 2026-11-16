// Detaillierte Requisiten (selbst modelliert, gehören komplett zum Spiel)

import * as THREE from 'three';

export type ShishaStyle = 'classic' | 'gold' | 'crystal' | 'ruby' | 'emerald' | 'black';

export const SHISHA_STYLES: Record<ShishaStyle, { glass: string; metal: string; metalness: number; water: string; label: string }> = {
  classic: { glass: '#2a6a8a', metal: '#b08a3a', metalness: 0.75, water: '#5a9ab8', label: 'Klasik' },
  gold: { glass: '#c9a04a', metal: '#e8c45a', metalness: 0.95, water: '#e8d08a', label: 'Altın · Gold' },
  crystal: { glass: '#cfe8f2', metal: '#c8ccd2', metalness: 0.95, water: '#a8d8ea', label: 'Kristal' },
  ruby: { glass: '#8e1b2b', metal: '#b08a3a', metalness: 0.8, water: '#c0404a', label: 'Yakut · Rubin' },
  emerald: { glass: '#1f6a42', metal: '#c9a04a', metalness: 0.85, water: '#3a9a6a', label: 'Zümrüt · Smaragd' },
  black: { glass: '#1a1a1e', metal: '#2a2a2e', metalness: 0.6, water: '#3a3a44', label: 'Siyah · Schwarz' },
};

const lathe = (pts: [number, number][], m: THREE.Material, seg = 32) =>
  new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), m);

/** Nargile ohne Schlauch, ca. 0,82 m hoch. Ursprung = Boden. */
export function makeShisha(style: ShishaStyle = 'classic'): THREE.Group {
  const s = SHISHA_STYLES[style] ?? SHISHA_STYLES.classic;
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({
    color: s.glass,
    transparent: true,
    opacity: 0.55,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    side: THREE.DoubleSide,
  });
  const metal = new THREE.MeshStandardMaterial({ color: s.metal, metalness: s.metalness, roughness: 0.28 });
  const metalDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.metal).multiplyScalar(0.6), metalness: s.metalness, roughness: 0.35 });
  const water = new THREE.MeshStandardMaterial({ color: s.water, transparent: true, opacity: 0.45, roughness: 0.1 });

  // Glasvase (bauchig, mit Fuß und Hals)
  const vase = lathe(
    [
      [0.0, 0.0],
      [0.09, 0.0],
      [0.1, 0.012],
      [0.12, 0.04],
      [0.15, 0.1],
      [0.155, 0.15],
      [0.14, 0.2],
      [0.1, 0.25],
      [0.05, 0.29],
      [0.035, 0.32],
      [0.04, 0.34],
    ],
    glass,
    40,
  );
  vase.castShadow = true;
  g.add(vase);
  // Wasser
  const w = lathe(
    [
      [0, 0.01],
      [0.095, 0.01],
      [0.115, 0.04],
      [0.145, 0.1],
      [0.148, 0.14],
      [0, 0.14],
    ],
    water,
    32,
  );
  g.add(w);

  // Dichtung/Grommet + Stamm mit Ringen und Kugeln
  g.add(Object.assign(lathe([[0.03, 0.33], [0.045, 0.335], [0.045, 0.36], [0.03, 0.365]], metalDark), {}));
  const stem = lathe(
    [
      [0.022, 0.36],
      [0.028, 0.38],
      [0.02, 0.42],
      [0.034, 0.44],
      [0.034, 0.455],
      [0.018, 0.47],
      [0.016, 0.52],
      [0.045, 0.545],
      [0.045, 0.56],
      [0.016, 0.585],
      [0.015, 0.65],
      [0.03, 0.665],
      [0.012, 0.69],
      [0.012, 0.72],
    ],
    metal,
    28,
  );
  stem.castShadow = true;
  g.add(stem);
  // Zierkugel
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 24, 16), metal);
  orb.position.y = 0.6;
  orb.scale.y = 0.8;
  g.add(orb);
  // Schlauchanschluss (ohne Schlauch)
  const port = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.07, 12), metal);
  port.rotation.z = Math.PI / 2.4;
  port.position.set(0.045, 0.51, 0);
  g.add(port);
  const portRing = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.003, 8, 16), metalDark);
  portRing.rotation.y = Math.PI / 2;
  portRing.rotation.x = Math.PI / 2.4;
  portRing.position.set(0.075, 0.525, 0);
  g.add(portRing);
  // Ventil auf der anderen Seite
  const valve = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), metal);
  valve.position.set(-0.05, 0.52, 0);
  g.add(valve);

  // Kohleteller
  const tray = lathe(
    [
      [0.0, 0.69],
      [0.13, 0.7],
      [0.15, 0.715],
      [0.14, 0.72],
      [0.0, 0.705],
    ],
    metal,
    40,
  );
  tray.castShadow = true;
  g.add(tray);
  // Muster am Tellerrand
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), metalDark);
    dot.position.set(Math.cos(a) * 0.135, 0.716, Math.sin(a) * 0.135);
    g.add(dot);
  }

  // Tonkopf mit Alufolie und glühender Kohle
  const clay = new THREE.MeshStandardMaterial({ color: '#8a3a1e', roughness: 0.8 });
  const bowl = lathe(
    [
      [0.014, 0.71],
      [0.025, 0.72],
      [0.03, 0.74],
      [0.05, 0.775],
      [0.055, 0.79],
      [0.045, 0.795],
    ],
    clay,
    24,
  );
  g.add(bowl);
  const foil = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.003, 24), new THREE.MeshStandardMaterial({ color: '#d8d8dc', metalness: 0.9, roughness: 0.35 }));
  foil.position.y = 0.797;
  g.add(foil);
  for (const [x, z, ry] of [
    [-0.018, 0.0, 0.2],
    [0.018, 0.012, -0.4],
    [0.0, -0.022, 1.2],
  ]) {
    const coal = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.016, 0.022), new THREE.MeshStandardMaterial({ color: '#3a1a10', emissive: '#ff5a1a', emissiveIntensity: 1.2, roughness: 0.9 }));
    coal.position.set(x, 0.806, z);
    coal.rotation.y = ry;
    coal.userData.coal = true;
    g.add(coal);
  }
  // Windschutz-Kappe (offen, Metallkuppel mit Löchern angedeutet)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), new THREE.MeshStandardMaterial({ color: s.metal, metalness: s.metalness, roughness: 0.3, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  cap.position.y = 0.79;
  g.add(cap);
  g.userData.isShisha = true;
  return g;
}

/** Kohle glimmt (in der Render-Schleife aufrufen) */
export function animateShisha(g: THREE.Object3D, t: number) {
  g.traverse((o) => {
    if (o.userData.coal) {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.9 + Math.sin(t * 2.3 + o.position.x * 50) * 0.35;
    }
  });
}
