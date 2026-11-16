// Testseite für Charaktere (nicht im Spiel verlinkt): /lab.html#emote=tea&p=0.5&view=front
import * as THREE from 'three';
import { Avatar3D } from './avatar.ts';
import { makeShisha } from './props.ts';
import type { Avatar } from '../../server/src/protocol.ts';

const q = new URLSearchParams(location.hash.slice(1));
const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
document.body.append(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#5a3a22');
scene.add(new THREE.HemisphereLight('#fff4e0', '#553322', 1.3));
const dl = new THREE.DirectionalLight('#fff', 1.4);
dl.position.set(1, 2, 3);
scene.add(dl);
const base: Avatar = { skin: '#d9a77c', face: 'round', hair: 'short', hairColor: '#2b1d14', eyebrows: 'thick', beard: 'none', mustache: 'classic', shirt: 'gomlek', shirtColor: '#7a3b2e', hat: 'none', glasses: 'none', accessory: 'tespih', jewelry: 'chain' };
const specs: Partial<Avatar>[] = [
  {},
  { hair: 'curly', beard: 'full', mustache: 'thick', shirt: 'takim', shirtColor: '#333', hat: 'kasket', glasses: 'reading', accessory: 'cigar' },
  { hair: 'slick', face: 'long', beard: 'stubble', shirt: 'trikot', shirtColor: '#c0392b', glasses: 'sun', accessory: 'toothpick', jewelry: 'ring' },
  { hair: 'long', face: 'square', shirt: 'hirka', shirtColor: '#5a6a3a', hat: 'takke', mustache: 'none', jewelry: 'watch' },
  { hair: 'none', shirt: 'esofman', shirtColor: '#1a3a8a', hat: 'bere', beard: 'full', hairColor: '#888' },
];
const avatars = specs.map((s, i) => {
  const a = new Avatar3D({ ...base, ...s }, 'Test ' + (i + 1));
  a.root.position.x = (i - (specs.length - 1) / 2) * 0.75;
  scene.add(a.root);
  if (q.get('emote')) a.pose(q.get('emote')!, Number(q.get('p') ?? 0.5));
  return a;
});
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 20);
const view = q.get('view') ?? 'front';
if (view === 'front') cam.position.set(0, 1.0, 3.3);
else if (view === 'side') cam.position.set(3.4, 1.0, 1.2);
else if (view === 'close') cam.position.set(Number(q.get('x') ?? 0), 0.95, 1.1);
cam.lookAt(view === 'close' ? Number(q.get('x') ?? 0) : 0, 0.8, 0);
if (q.get('emote')) for (const a of avatars) a.update(0, true);
if (q.get('shisha')) {
  ['classic', 'gold', 'crystal', 'ruby', 'emerald', 'black'].forEach((st, i) => {
    const sh = makeShisha(st as any);
    sh.position.set((i - 2.5) * 0.45, -0.1, 0.6);
    scene.add(sh);
  });
  for (const a of avatars) a.root.visible = false;
  cam.position.set(0, 0.7, 2.6);
  cam.lookAt(0, 0.35, 0.6);
}
(window as any).__ready = true;
r.setAnimationLoop(() => {
  if (!q.get('emote')) for (const a of avatars) a.update(0.016);
  r.render(scene, cam);
});
