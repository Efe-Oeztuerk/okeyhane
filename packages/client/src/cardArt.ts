// Spielkarten für Pişti: Texturen (3D) und HTML-Karten (Hand)
import * as THREE from 'three';
import { h } from './dom.ts';

export interface PCard {
  id: number;
  suit: 'S' | 'H' | 'D' | 'C';
  rank: number;
}

export const SUIT_SYM: Record<PCard['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const isRed = (c: PCard) => c.suit === 'H' || c.suit === 'D';
export const rankLabel = (r: number) => (r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r));

const RED = '#c8102e';
const BLACK = '#141414';

const texCache = new Map<string, THREE.CanvasTexture>();

/** Kartenvorderseite / -rückseite als Textur (63 × 88 Verhältnis) */
export function cardTexture(c: PCard | null): THREE.CanvasTexture {
  const key = c ? `${c.suit}${c.rank}` : 'back';
  const hit = texCache.get(key);
  if (hit) return hit;
  const W = 252;
  const H = 352;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const round = (x: number, y: number, w: number, hh: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, hh, r);
  };
  if (!c) {
    // Rückseite: dunkelrot mit Çini-Rauten und Okeyhane-Schriftzug
    round(0, 0, W, H, 18);
    g.fillStyle = '#f4ecd8';
    g.fill();
    round(10, 10, W - 20, H - 20, 12);
    g.fillStyle = '#7d1420';
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(240,200,120,0.35)';
    g.lineWidth = 2;
    for (let i = -H; i < W + H; i += 22) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H, H);
      g.moveTo(i + H, 0);
      g.lineTo(i, H);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = '#e8c27a';
    g.lineWidth = 4;
    round(22, 22, W - 44, H - 44, 8);
    g.stroke();
    g.fillStyle = '#e8c27a';
    g.font = '700 34px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-Math.PI / 2);
    g.fillText('OKEYHANE', 0, 0);
    g.restore();
  } else {
    const col = isRed(c) ? RED : BLACK;
    const sym = SUIT_SYM[c.suit];
    const lab = rankLabel(c.rank);
    round(0, 0, W, H, 18);
    g.fillStyle = '#fbf7ee';
    g.fill();
    g.strokeStyle = '#d8ccb2';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = col;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // große Ecke oben links + unten rechts (lesbar auch klein)
    const corner = (rot: boolean) => {
      g.save();
      if (rot) {
        g.translate(W, H);
        g.rotate(Math.PI);
      }
      g.font = `900 ${lab.length > 1 ? 66 : 76}px Georgia, serif`;
      g.fillText(lab, 46, 50);
      g.font = '62px serif';
      g.fillText(sym, 46, 110);
      g.restore();
    };
    corner(false);
    corner(true);
    // Mitte: Bildkarten mit Rahmen + Buchstabe, sonst großes Symbol
    if (c.rank >= 11) {
      g.strokeStyle = col;
      g.lineWidth = 3;
      round(82, 76, W - 164, H - 152, 10);
      g.stroke();
      g.fillStyle = isRed(c) ? 'rgba(200,16,46,0.08)' : 'rgba(20,20,20,0.06)';
      g.fill();
      g.fillStyle = col;
      g.font = '900 96px Georgia, serif';
      g.fillText(lab, W / 2, H / 2 - 14);
      g.font = '46px serif';
      g.fillText(sym, W / 2, H / 2 + 54);
    } else {
      g.font = `${c.rank === 1 ? 150 : 120}px serif`;
      g.fillText(sym, W / 2 + 18, H / 2 + 8);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(key, tex);
  return tex;
}

const geo = new THREE.BoxGeometry(0.082, 0.0012, 0.114);
const edgeMat = new THREE.MeshStandardMaterial({ color: '#f1ead8', roughness: 0.7 });
const matCache = new Map<string, THREE.Material>();
function faceMat(c: PCard | null) {
  const key = c ? `${c.suit}${c.rank}` : 'back';
  let m = matCache.get(key);
  if (!m) {
    const map = cardTexture(c);
    m = new THREE.MeshStandardMaterial({ map, roughness: 0.65, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.35 });
    matCache.set(key, m);
  }
  return m;
}

/** flache 3D-Karte (Vorderseite oben, wenn faceUp) */
export function cardMesh(c: PCard | null, faceUp = true): THREE.Mesh {
  const top = faceUp && c ? faceMat(c) : faceMat(null);
  const bottom = faceMat(null);
  // Box-Seiten: +x, -x, +y (oben), -y (unten), +z, -z
  const m = new THREE.Mesh(geo, [edgeMat, edgeMat, top, bottom, edgeMat, edgeMat]);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** HTML-Karte für die Hand */
export function cardElement(c: PCard | null): HTMLElement {
  if (!c) return h('div', { class: 'pcard back' });
  const col = isRed(c) ? 'red' : 'black';
  const lab = rankLabel(c.rank);
  const sym = SUIT_SYM[c.suit];
  return h(
    'div',
    { class: `pcard ${col}${c.rank >= 11 ? ' face' : ''}` },
    h('div', { class: 'pc-corner' }, h('b', {}, lab), h('span', {}, sym)),
    h('div', { class: 'pc-mid' }, c.rank >= 11 ? lab : sym),
  );
}
