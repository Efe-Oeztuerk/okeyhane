// Realistische Figuren (Quaternius-Basisfiguren CC0 + „Vocations & Uniforms“ CC BY-SA).
// Die Bewegung kommt vom normalen Cartoon-Avatar: der läuft unsichtbar mit, und seine
// Arm-/Bein-/Kopfrichtungen werden jedes Frame auf die Knochen der echten Figur übertragen.
// So funktionieren Sitzen, Laufen und alle Emotes ohne eigene Animationsdateien.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Avatar } from '../../server/src/protocol.ts';

export interface RealBase {
  id: string;
  label: string;
  fem: boolean;
  /** q = Quaternius (Kleidung frei färbbar), v = feste Berufskleidung */
  kind: 'q' | 'v';
}
export const REAL_BASES: RealBase[] = [
  { id: 'qm', label: 'Erkek · Mann', fem: false, kind: 'q' },
  { id: 'qf', label: 'Kadın · Frau', fem: true, kind: 'q' },
  { id: 'TeacherM', label: 'Gömlek · Hemd & Hose', fem: false, kind: 'v' },
  { id: 'Businessman', label: 'Takım elbise · Anzug', fem: false, kind: 'v' },
  { id: 'StudentM', label: 'Öğrenci · Student', fem: false, kind: 'v' },
  { id: 'Worker', label: 'İşçi · Arbeiter', fem: false, kind: 'v' },
  { id: 'Mechanic', label: 'Tamirci · Mechaniker', fem: false, kind: 'v' },
  { id: 'Engineer', label: 'Mühendis · Bauleiter', fem: false, kind: 'v' },
  { id: 'DocMale', label: 'Doktor · Arzt', fem: false, kind: 'v' },
  { id: 'ScientistM', label: 'Önlük · Laborkittel', fem: false, kind: 'v' },
  { id: 'Police', label: 'Polis · Polizist', fem: false, kind: 'v' },
  { id: 'Fireman', label: 'İtfaiyeci · Feuerwehr', fem: false, kind: 'v' },
  { id: 'TeacherF', label: 'Uzun elbise · Langes Kleid', fem: true, kind: 'v' },
  { id: 'StudentF', label: 'Etek · Rock & Bluse', fem: true, kind: 'v' },
  { id: 'ScientistF', label: 'Kırmızı · Rotes Outfit', fem: true, kind: 'v' },
  { id: 'ScientistF2', label: 'Önlük · Kittel', fem: true, kind: 'v' },
  { id: 'Nurse', label: 'Hemşire · Pflegerin', fem: true, kind: 'v' },
];
/** exklusive Figuren (nur für einen Account) – Datei kommt geschützt vom Server */
export const EXCLUSIVE_BASES: RealBase[] = [{ id: 'efe', label: '⭐ Efe (exklusiv)', fem: false, kind: 'v' }];
export const excl = { dl: '', owns: new Set<string>() };

export const REAL_HAIR: Record<string, string> = {
  none: 'Kel · Glatze',
  buzzed: 'Kısa · Kurz rasiert',
  simpleparted: 'Yana tarama · Seitenscheitel',
  long: 'Uzun · Lang',
  buns: 'İki topuz · Zwei Dutts',
  buzzedfemale: 'Kısa · Kurz (Frau)',
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const files = new Map<string, Promise<THREE.Group>>();
function load(name: string) {
  let p = files.get(name);
  if (!p) {
    p = loader.loadAsync(`/models/people/${name}.glb`).then((g) => g.scene);
    files.set(name, p);
  }
  return p;
}
function loadExclusive(id: string) {
  const name = 'x:' + id;
  let p = files.get(name);
  if (!p) {
    p = loader.loadAsync(`/x/${id}.glb?k=${encodeURIComponent(excl.dl)}`).then((g) => g.scene);
    // nicht freigegeben (noch nicht am selben Tisch) → später erneut versuchen
    p.catch(() => files.delete(name));
    files.set(name, p);
  }
  return p;
}
const texCache = new Map<string, THREE.Texture>();
function tex(url: string) {
  let t = texCache.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const NAMES: Record<string, string[]> = {
  // Quaternius/Vocations-Namen + Mixamo/Avaturn-Namen (LeftArm, LeftUpLeg …)
  spine: ['spine01', 'spine1', 'spine'],
  head: ['head'],
  upL: ['upperarml', 'leftarm'],
  foreL: ['lowerarml', 'forearml', 'leftforearm'],
  handL: ['handl', 'lefthand'],
  upR: ['upperarmr', 'rightarm'],
  foreR: ['lowerarmr', 'forearmr', 'rightforearm'],
  handR: ['handr', 'righthand'],
  thighL: ['thighl', 'leftupleg'],
  shinL: ['calfl', 'shinl', 'leftleg'],
  footL: ['footl', 'leftfoot'],
  thighR: ['thighr', 'rightupleg'],
  shinR: ['calfr', 'shinr', 'rightleg'],
  footR: ['footr', 'rightfoot'],
  toeL: ['balll', 'toel', 'lefttoebase'],
  neck: ['neck01', 'neck', 'spine5', 'spine4', 'spine3'],
  pelvis: ['pelvis', 'hips'],
};

/** was der Cartoon-Avatar an Richtungen liefert */
export interface PoseSource {
  root: THREE.Object3D;
  body: THREE.Object3D;
  head: THREE.Object3D;
  arms: { g: THREE.Object3D; fore: THREE.Object3D; side: number }[];
  legs: { hip: THREE.Object3D; knee: THREE.Object3D }[];
}

type Drive = { bone: THREE.Bone; restQ: THREE.Quaternion; restDir: THREE.Vector3 };

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

export class RealBody {
  group = new THREE.Group();
  ready = false;
  /** Mund in Avatar-Koordinaten (für Rauch) */
  mouthY = 0.8;
  private drives: Partial<Record<string, Drive>> = {};
  private bones: Partial<Record<string, THREE.Bone>> = {};
  private restRoot = new THREE.Quaternion();
  private disposed = false;

  constructor(private spec: Avatar) {
    void this.build();
  }

  /** Weltposition einer Hand (für Tablett usw.), null solange nicht geladen */
  handWorld(side: 'L' | 'R'): THREE.Vector3 | null {
    const b = this.bones[side === 'L' ? 'handL' : 'handR'];
    return this.ready && b ? b.getWorldPosition(new THREE.Vector3()) : null;
  }

  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
  }

  private async build() {
    const a = this.spec;
    // Sonderfigur Ahmet (Çaycı, Avaturn) – nicht im Editor wählbar
    const xb = EXCLUSIVE_BASES.find((b) => b.id === a.realBase);
    let xsrc: THREE.Group | null = null;
    if (xb) xsrc = await loadExclusive(xb.id).catch(() => null);
    const npc = a.realBase === 'ahmet' || !!xsrc;
    const base = npc ? (xb ?? { id: 'ahmet', label: 'Ahmet', fem: false, kind: 'v' as const }) : (REAL_BASES.find((b) => b.id === a.realBase) ?? REAL_BASES[0]);
    let model: THREE.Object3D;
    if (npc) {
      model = skClone(xsrc ?? (await load('ahmet')));
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).metalnessMap) {
          (m.material as THREE.MeshStandardMaterial).metalness = 0;
          (m.material as THREE.MeshStandardMaterial).metalnessMap = null;
        }
      });
    } else if (base.kind === 'q') {
      const src = await load(base.id === 'qf' ? 'qfemale' : 'qmale');
      model = skClone(src);
    } else {
      const src = await load('voc');
      const node = src.getObjectByName(base.id) ?? src.children[0];
      model = skClone(node);
      model.position.set(0, 0, 0);
    }
    if (this.disposed) return;
    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.updateMatrixWorld(true);

    model.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) {
        // GLTFLoader hängt bei doppelten Namen _16 usw. an
        const n1 = norm(b.name);
        const n2 = norm(b.name.replace(/_\d+$/, ''));
        for (const [k, list] of Object.entries(NAMES)) if (!this.bones[k] && (list.includes(n1) || list.includes(n2))) this.bones[k] = b;
      }
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    const B = this.bones;
    if (!B.thighL || !B.thighR || !B.footL || !B.upL || !B.upR || !B.head) {
      console.warn('Figur ohne passende Knochen', base.id);
      return;
    }
    // Blickrichtung: Zehen zeigen nach vorn (+Z)
    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    if (B.toeL && wp(B.toeL).z < wp(B.footL).z) wrap.rotation.y = Math.PI;
    wrap.updateMatrixWorld(true);
    // Größe: Hüfte bis Sohle = 0.87 (wie die Cartoon-Beine)
    const box = new THREE.Box3().setFromObject(model);
    const hip = wp(B.thighL).add(wp(B.thighR)).multiplyScalar(0.5);
    const s = 0.87 / Math.max(0.1, hip.y - box.min.y);
    wrap.scale.setScalar(s);
    wrap.updateMatrixWorld(true);
    const hip2 = wp(B.thighL).add(wp(B.thighR)).multiplyScalar(0.5);
    wrap.position.set(-hip2.x, 0.08 - hip2.y, -hip2.z);
    wrap.updateMatrixWorld(true);
    this.mouthY = wp(B.head).y + 0.06;
    const leftIsPlus = wp(B.upL).x > 0;
    this.sideCache[1] = leftIsPlus ? 'L' : 'R';
    this.sideCache[-1] = leftIsPlus ? 'R' : 'L';

    // Ruhelage der gesteuerten Knochen (in Avatar-Koordinaten)
    const child: Record<string, string> = { upL: 'foreL', foreL: 'handL', upR: 'foreR', foreR: 'handR', thighL: 'shinL', shinL: 'footL', thighR: 'shinR', shinR: 'footR', spine: 'neck', head: '' };
    for (const [k, c] of Object.entries(child)) {
      const b = B[k];
      if (!b) continue;
      const restQ = b.getWorldQuaternion(new THREE.Quaternion());
      const cb = c ? B[c] : null;
      const restDir = cb ? wp(cb).sub(wp(b)).normalize() : new THREE.Vector3(0, 1, 0);
      this.drives[k] = { bone: b, restQ, restDir };
    }

    if (base.kind === 'q') this.dressQ(model, base.fem);
    this.group.add(wrap);
    this.ready = true;
  }

  /** Quaternius-Körper: Haut tauschen, Kleidung per Shader, Frisur/Bart anhängen */
  private async dressQ(model: THREE.Object3D, fem: boolean) {
    const a = this.spec;
    const B = this.bones;
    let body: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && (!body || m.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = m;
    });
    if (!body) return;
    const bm = body as THREE.SkinnedMesh;
    // die Quaternius-Modelle haben schwarze Vertex-Farben → aus
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        (m.material as THREE.MeshStandardMaterial).vertexColors = false;
        // Metall-Kanal der Rauheits-Textur macht ohne Umgebungs-Map alles schwarz
        (m.material as THREE.MeshStandardMaterial).metalness = 0;
        (m.material as THREE.MeshStandardMaterial).metalnessMap = null;
      }
    });
    const mat = bm.material as THREE.MeshStandardMaterial;
    bm.material = mat;
    // immer die helle Haut-Textur nehmen und auf die gewählte Hautfarbe tönen
    mat.map = tex(`/models/people/${fem ? 'qfemale' : 'qmale'}_light.webp`);
    const skinRef = new THREE.Color('#e6b896');
    const skinWant = new THREE.Color(a.realSkin === 'dark' ? '#7a4f32' : a.realSkin === 'light' || !a.realSkin ? '#e6b896' : a.realSkin);
    const tint = new THREE.Color(Math.min(1.3, skinWant.r / skinRef.r), Math.min(1.3, skinWant.g / skinRef.g), Math.min(1.3, skinWant.b / skinRef.b));

    // Grenzen für Hemd/Hose/Schuhe aus den Knochen (in Mesh-Koordinaten)
    bm.updateMatrixWorld(true);
    const inv = bm.matrixWorld.clone().invert();
    const local = (b?: THREE.Object3D) => (b ? b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : new THREE.Vector3());
    const geo = bm.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    // Hoch-Achse im Mesh bestimmen (Y oder Z)
    const up = local(B.head).sub(local(B.footL));
    const ax = Math.abs(up.y) >= Math.abs(up.z) ? 1 : 2;
    const sgn = Math.sign(ax === 1 ? up.y : up.z) || 1;
    const h = (v: THREE.Vector3) => (ax === 1 ? v.y : v.z) * sgn;
    const ankle = h(local(B.footL));
    const sole = sgn > 0 ? (ax === 1 ? bb.min.y : bb.min.z) : -(ax === 1 ? bb.max.y : bb.max.z);
    const waist = (h(local(B.pelvis)) + h(local(B.spine))) / 2 + 0.03;
    const neck = h(local(B.neck)) - 0.02;
    const shoulderX = Math.abs(local(B.upL).x) * 0.8;
    const wristX = Math.abs(local(B.handL).x) - 0.03;
    const uni = {
      uShirt: { value: new THREE.Color(a.shirtColor || '#2f4f6f') },
      uPants: { value: new THREE.Color(a.pantsColor || '#3a342e') },
      uShoes: { value: new THREE.Color('#1d1712') },
      uTint: { value: tint },
      uLim: { value: new THREE.Vector4(sole + (ankle - sole) * 1.35, waist, neck, wristX) },
      uMisc: { value: new THREE.Vector4(ax, sgn, shoulderX, 0) },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec4 uLim; uniform vec4 uMisc; varying vec3 vCloth;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  float hh = (uMisc.x < 1.5 ? position.y : position.z) * uMisc.y;
  float ax = abs(position.x);
  float shoes = step(hh, uLim.x);
  float pants = (1.0 - shoes) * step(hh, uLim.y);
  bool arm = ax > uMisc.z;
  float neckLim = uLim.z + smoothstep(0.06, 0.14, ax) * 0.12;
  float shirt = (1.0 - shoes - pants) * (arm ? step(ax, uLim.w) : step(hh, neckLim));
  vCloth = vec3(shirt, pants, shoes);
  transformed += objectNormal * (shirt * 0.012 + pants * 0.008 + shoes * 0.01);
}`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uShirt; uniform vec3 uPants; uniform vec3 uShoes; uniform vec3 uTint; varying vec3 vCloth;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float w = clamp(vCloth.x + vCloth.y + vCloth.z, 0.0, 1.0);
  vec3 cloth = uShirt * vCloth.x + uPants * vCloth.y + uShoes * vCloth.z;
  diffuseColor.rgb = mix(diffuseColor.rgb * uTint, cloth * (0.9 + lum * 0.12), w);
}`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
normal = normalize(mix(normal, nonPerturbedNormal, clamp(vCloth.x + vCloth.y + vCloth.z, 0.0, 1.0)));`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.85, clamp(vCloth.x + vCloth.y, 0.0, 1.0));`,
        );
    };
    mat.customProgramCacheKey = () => 'qcloth';

    // Haare: Standard-Haar des Körpers aus, gewählte Frisur an den Kopf hängen
    const hairColor = new THREE.Color(a.hairColor || '#2b1d14');
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m === bm) return;
      const mm = m.material as THREE.MeshStandardMaterial;
      if (/eyebrow/i.test(m.name)) {
        mm.color = hairColor.clone().multiplyScalar(1.4);
        mm.alphaTest = 0.3;
      } else if (/hair/i.test(mm.name || '')) m.visible = false;
    });
    const want = [a.realHair && a.realHair !== 'none' ? a.realHair : null, !fem && a.realBeard ? 'beard' : null].filter(Boolean) as string[];
    for (const hName of want) {
      const src = await load('hair_' + hName);
      if (this.disposed) return;
      const hair = src.clone(true);
      hair.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const hm = (m.material as THREE.MeshStandardMaterial).clone();
          hm.color = hairColor.clone().multiplyScalar(1.6);
          hm.alphaTest = 0.4;
          hm.side = THREE.DoubleSide;
          m.material = hm;
          m.castShadow = true;
        }
      });
      // Frisuren sind für Mann bzw. Frau modelliert → um den Unterschied der Kopfhöhe verschieben
      const refFile = ['long', 'buns', 'buzzedfemale'].includes(hName) ? 'qfemale' : 'qmale';
      if (refFile !== (fem ? 'qfemale' : 'qmale')) {
        const ref = await load(refFile);
        if (this.disposed) return;
        ref.updateMatrixWorld(true);
        let refHead: THREE.Object3D | undefined;
        ref.traverse((o) => {
          if ((o as THREE.Bone).isBone && norm(o.name) === 'head') refHead = o;
        });
        if (refHead) {
          model.updateMatrixWorld(true);
          const mine = model.worldToLocal(B.head!.getWorldPosition(new THREE.Vector3()));
          const theirs = refHead.getWorldPosition(new THREE.Vector3());
          hair.position.add(mine.sub(theirs));
        }
      }
      // Frisur liegt in Modell-Koordinaten (Ruhelage) → an den Kopfknochen hängen
      model.add(hair);
      model.updateMatrixWorld(true);
      B.head!.attach(hair);
    }
  }

  /** Haltung vom unsichtbaren Cartoon-Avatar übernehmen */
  sync(src: PoseSource) {
    if (!this.ready) return;
    src.root.updateMatrixWorld(true);
    const rootQinv = src.root.getWorldQuaternion(_q2).invert().clone();
    const charQ = (o: THREE.Object3D, out: THREE.Quaternion) => out.copy(rootQinv).multiply(o.getWorldQuaternion(_q));
    const rootWorld = src.root.getWorldQuaternion(new THREE.Quaternion());
    // Knochen so drehen, dass er in Avatar-Raum die Zielrichtung zeigt
    const aim = (k: string, dir: THREE.Vector3 | null, extra?: THREE.Quaternion) => {
      const d = this.drives[k];
      if (!d) return;
      const want = new THREE.Quaternion();
      if (dir) want.setFromUnitVectors(d.restDir, dir.clone().normalize());
      if (extra) want.premultiply(extra);
      want.multiply(d.restQ); // Ziel in Avatar-Raum (restQ ist relativ zur Ruhelage des Avatars)
      // in Welt umrechnen, dann relativ zum Elternknochen
      const worldWant = rootWorld.clone().multiply(want);
      const parentQ = d.bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      d.bone.quaternion.copy(parentQ.invert().multiply(worldWant));
      d.bone.updateMatrixWorld(true);
    };
    // Oberkörper atmet/wippt mit
    const bodyQ = charQ(src.body, new THREE.Quaternion());
    this.group.position.y = src.body.position.y;
    aim('spine', null, bodyQ);
    aim('head', null, charQ(src.head, new THREE.Quaternion()));
    // Richtungen aus Gelenk-Positionen des Cartoon-Avatars (robust, egal wie die Gruppen gedreht sind)
    const toChar = (v: THREE.Vector3) => v.applyQuaternion(rootQinv);
    const P = (o: THREE.Object3D, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(0, y, z));
    for (const arm of src.arms) {
      const sk = this.sideOf(arm.side > 0 ? 1 : -1);
      const sh = P(arm.g);
      const el = P(arm.fore);
      const ha = P(arm.fore, 0, 0.27); // Cartoon-Unterarm zeigt entlang +Z
      aim('up' + sk, toChar(el.clone().sub(sh)));
      aim('fore' + sk, toChar(ha.sub(el)));
    }
    for (const leg of src.legs) {
      const sk = this.sideOf(leg.hip.position.x > 0 ? 1 : -1);
      const hp = P(leg.hip);
      const kn = P(leg.knee);
      const ft = P(leg.knee, -0.41);
      aim('thigh' + sk, toChar(kn.clone().sub(hp)));
      aim('shin' + sk, toChar(ft.sub(kn)));
    }
  }

  /** welche Modellseite (L/R) liegt auf dieser x-Seite des Avatars? */
  private sideCache: Record<number, string> = {};
  private sideOf(x: number) {
    return this.sideCache[x] ?? (x > 0 ? 'L' : 'R');
  }
}
