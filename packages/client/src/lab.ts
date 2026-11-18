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
const F: Partial<Avatar> = { body: 'f', beard: 'none', mustache: 'none', eyebrows: 'thin', accessory: 'none', jewelry: 'bilezik' };
const R = (x: Partial<Avatar>): Partial<Avatar> => ({ style: 'real', ...x });
const specs: Partial<Avatar>[] = q.get('real') ? [
  R({ realBase: 'qm', realSkin: 'light', realHair: 'simpleparted', realBeard: true, shirtColor: '#e8e2d4', pantsColor: '#3a342e', hairColor: '#2b1d14' }),
  R({ realBase: 'qf', realSkin: 'dark', realHair: 'long', shirtColor: '#8e1b1b', pantsColor: '#1a1a1a', hairColor: '#1a1a1a' }),
  R({ realBase: 'TeacherM' }),
  R({ realBase: 'Businessman' }),
  R({ realBase: 'TeacherF' }),
] : q.get('fem') ? [
  { ...F, scarf: 'basortu', scarfColor: '#2f4f6f', shirt: 'hirka', shirtColor: '#7a5a3a', makeup: 'light' },
  { ...F, scarf: 'tulbent', shirt: 'elbise', shirtColor: '#2d5a3a', glasses: 'reading', accessory: 'tespih', skin: '#e8b991' },
  { ...F, scarf: 'esarp', scarfColor: '#7a3b2e', shirt: 'bluz', shirtColor: '#e8e2d4', makeup: 'full' },
  { ...F, hair: 'bun', hairColor: '#a8a8a8', shirt: 'yelek', shirtColor: '#5a2d6a', jewelry: 'earrings', glasses: 'reading' },
  { ...F, hair: 'wavy', hairColor: '#4a3020', shirt: 'elbise', shirtColor: '#8e1b1b', makeup: 'full', jewelry: 'earrings' },
] : q.get('kits') ? [
  { shirt: 'trikot', kit: 'aYildiz' },
  { shirt: 'trikot', kit: 'sariKirmizi', hair: 'curly' },
  { shirt: 'trikot', kit: 'sariLacivert', hair: 'slick' },
  { shirt: 'trikot', kit: 'siyahBeyaz', hat: 'kasket' },
  { shirt: 'trikot', kit: 'duz', shirtColor: '#2d5a3a' },
] : [
  {},
  { hair: 'curly', beard: 'full', mustache: 'thick', shirt: 'takim', shirtColor: '#333', hat: 'kasket', glasses: 'reading', accessory: 'cigar' },
  { hair: 'slick', face: 'long', beard: 'stubble', shirt: 'trikot', shirtColor: '#c0392b', glasses: 'sun', accessory: 'toothpick', jewelry: 'ring' },
  { hair: 'long', face: 'square', shirt: 'hirka', shirtColor: '#5a6a3a', hat: 'takke', mustache: 'none', jewelry: 'watch' },
  { hair: 'none', shirt: 'esofman', shirtColor: '#1a3a8a', hat: 'bere', beard: 'full', hairColor: '#888' },
];
const avatars: Avatar3D[] = (window as any).__av = specs.map((s, i) => {
  const a = new Avatar3D({ ...base, ...s }, 'Test ' + (i + 1), { standing: !!q.get('stand') });
  if (q.get('stand')) {
    a.root.position.y = 0.82 * 0.88 - 0.45;
    a.root.scale.setScalar(0.88);
    if (q.get('walk')) a.setWalking(1.2);
  }
  a.root.position.x = (i - (specs.length - 1) / 2) * 0.75;
  scene.add(a.root);
  if (q.get('emote')) a.pose(q.get('emote')!, Number(q.get('p') ?? 0.5));
  return a;
});
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 20);
const view = q.get('view') ?? 'front';
if (view === 'front') cam.position.set(0, 1.0, 3.3);
else if (view === 'side') cam.position.set(3.4, 1.0, 1.2);
else if (view === 'back') cam.position.set(0, 1.0, -3.3);
else if (view === 'close') cam.position.set(Number(q.get('x') ?? 0), 0.95, 1.1);
cam.lookAt(view === 'close' ? Number(q.get('x') ?? 0) : 0, 0.8, 0);
if (q.get('emote')) for (const a of avatars) a.update(0, true);
if (q.get('emote') && q.get('real')) setTimeout(() => avatars.forEach((a) => a.pose(q.get('emote')!, Number(q.get('p') ?? 0.5))), 5000);
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
