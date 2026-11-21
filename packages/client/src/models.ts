// Externe 3D-Modelle (Sketchfab, CC BY) laden, normalisieren und cachen.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Group>>();

export function loadModel(name: string): Promise<THREE.Group> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`/models/${name}.glb`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      return g.scene;
    });
    cache.set(name, p);
  }
  return p.then((s) => s.clone(true));
}

/**
 * Modell in einen Container packen: Boden auf y=0, mittig, auf Zielgröße skaliert.
 * fit = 'height' | 'width' (größte waagerechte Seite)
 */
export function placeModel(
  target: THREE.Object3D,
  name: string,
  size: number,
  fit: 'height' | 'width' = 'height',
  opts: { layFlat?: boolean; upZ?: boolean; material?: THREE.Material } = {},
) {
  loadModel(name)
    .then((model) => {
      const wrap = new THREE.Group();
      wrap.add(model);
      if (opts.upZ) model.rotation.x = -Math.PI / 2; // Z-oben (3D-Druck) -> Y-oben
      if (opts.material) {
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
            m.material = opts.material!;
          }
        });
      }
      if (opts.layFlat) {
        const b0 = new THREE.Box3().setFromObject(model);
        const s0 = b0.getSize(new THREE.Vector3());
        // steht das Modell hochkant? dann flach legen
        if (s0.y > Math.min(s0.x, s0.z)) model.rotation.x = -Math.PI / 2;
      }
      const box = new THREE.Box3().setFromObject(wrap);
      const sz = box.getSize(new THREE.Vector3());
      const ref = fit === 'height' ? sz.y : Math.max(sz.x, sz.z);
      const k = ref > 0 ? size / ref : 1;
      wrap.scale.setScalar(k);
      const box2 = new THREE.Box3().setFromObject(wrap);
      const c = box2.getCenter(new THREE.Vector3());
      wrap.position.set(-c.x, -box2.min.y, -c.z);
      target.add(wrap);
    })
    .catch((e) => console.warn('Modell konnte nicht geladen werden', name, e));
}

/** Namensnennung (CC BY 4.0) – wird im Menü unter „Credits“ angezeigt */
export const CREDITS = [
  { what: '3D Model Backgammon – Tavla (Brett, CC BY 4.0)', author: 'Serhat Siri', url: 'https://sketchfab.com/3d-models/3d-model-backgammon-tavla-d9827b365a4547d58b8099698084f2ab' },
  { what: 'Hookah (Saray)', author: 'NicKravchenko', url: 'https://sketchfab.com/3d-models/hookah-adfa9957e99c469fa8cf8d9252e36707' },
  { what: 'Hookah (Usta)', author: 'QwertModels', url: 'https://sketchfab.com/3d-models/hookah-e14b842465864eada037488b7e4281f2' },
  { what: 'Hookah (Sultan)', author: 'artyrey', url: 'https://sketchfab.com/3d-models/hookah-422820f79eed4502ac419b2fe9875696' },
  { what: 'Turkish Delight Scene', author: 'nur_ay', url: 'https://sketchfab.com/3d-models/turkish-delight-scene-0fb7741c63a442a19b6932a4f8f9fecc' },
  { what: 'Atatürk Büste', author: 'metdiu3dprint', url: 'https://www.printables.com/' },
  { what: 'Antique Turkish Runner Carpet', author: 'mfb64', url: 'https://sketchfab.com/3d-models/antique-turkish-runner-carpet-8509133148294571a5ac062a6bdf6d98' },
  { what: 'Universal Base Characters (realistische Figuren, CC0)', author: 'Quaternius', url: 'https://quaternius.com' },
  { what: 'low poly cars vol 01 (Autos, Royalty Free)', author: 'ilkhom23', url: 'https://www.cgtrader.com/free-3d-models/car/concept-car/cars-pack-41-objects-cars-tyres-trucks-lowpoly' },
  { what: 'Ahmet, der Çaycı (Avaturn-Avatar)', author: 'Efe Öztürk / avaturn.me', url: 'https://avaturn.me' },
  { what: 'Stimmen der Spielfiguren (KI-Stimmen)', author: 'ElevenLabs', url: 'https://elevenlabs.io' },
  { what: 'Playing Cards – Pişti-Karten (CC BY)', author: 'DudleyLong', url: 'https://sketchfab.com/3d-models/playing-cards-793274af15df4f20848d83ab6d127493' },
  { what: 'Glass of water (CC BY)', author: 'Hoshi_Takase_Moppy', url: 'https://sketchfab.com/3d-models/glass-of-water-90a9fc57892e4811aca10922fec6f084' },
  { what: 'Bowl of nuts (CC BY)', author: 'Bastian_01', url: 'https://sketchfab.com/3d-models/bowl-of-nuts-fa80b79d252740b4a2d1d3dfa915c515' },
  { what: 'Red Bull Energy Drink Can (CC BY)', author: 'martin_dalm', url: 'https://sketchfab.com/3d-models/red-bull-energy-drink-can-2a29aa47ffd74b6395d07cd270db4735' },
  { what: 'Soda Cans – 500ml (CC BY-NC)', author: 'Mark Peters', url: 'https://sketchfab.com/3d-models/soda-cans-500ml-free-download-84452c6420a44ea4be84c49fc6b2df6c' },
  { what: 'Çay-Untertasse (Textur aus „Tea“, 3dexport)', author: '3dexport', url: 'https://3dexport.com' },
  { what: 'Vocations and Uniforms (Gäste & Berufsfiguren, CC BY-SA – angepasst)', author: 'itch.io-Asset „Vocations and Uniforms“', url: 'https://itch.io' },
];
