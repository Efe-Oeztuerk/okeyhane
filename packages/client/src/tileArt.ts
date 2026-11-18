// Aussehen der Okey-Steine (Canvas-Texturen für 3D und HTML-Elemente für die Istaka)

import * as THREE from 'three';
import type { Tile } from '@okeyhane/engine';

export const TILE_COLORS: Record<string, string> = {
  red: '#c62828',
  black: '#1e1e1e',
  yellow: '#d58a00',
  blue: '#1756a9',
};

const cache = new Map<string, THREE.Texture>();

/** kräftigere Farben + dunkler Rand nur für die 3D-Steine auf dem Tisch */
// klar unterscheidbar, auch klein und von weitem: Rot, Schwarz, Gelb-Orange, Blau
const TABLE_INK: Record<string, [string, string]> = {
  red: ['#e8141b', '#4a0000'],
  black: ['#0b0b0b', '#000000'],
  yellow: ['#ffa400', '#6b3c00'],
  blue: ['#0a5cff', '#001a4d'],
};

function drawFace(g: CanvasRenderingContext2D, w: number, h: number, tile: Tile | null) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#fffdf6');
  grad.addColorStop(1, '#f1e7cf');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c9b48a';
  g.lineWidth = w * 0.04;
  g.strokeRect(w * 0.02, w * 0.02, w - w * 0.04, h - w * 0.04);
  if (!tile) return;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (tile.fake) {
    g.fillStyle = '#1f8a3a';
    g.font = `bold ${h * 0.55}px Georgia, serif`;
    g.fillText('★', w / 2, h * 0.48);
    return;
  }
  const [col, dark] = TABLE_INK[tile.color!];
  // große, fette Zahl mit dunklem Rand → auch klein auf dem Tisch gut lesbar
  // sehr große, fette Zahl (breiter bei 10–13), dunkler Rand
  const two = tile.value >= 10;
  g.font = `900 ${h * (two ? 0.5 : 0.6)}px Arial Black, Arial, sans-serif`;
  g.lineJoin = 'round';
  g.lineWidth = w * 0.06;
  g.strokeStyle = dark;
  g.save();
  if (two) {
    g.translate(w / 2, h * 0.4);
    g.scale(0.82, 1);
    g.translate(-w / 2, -h * 0.4);
  }
  g.strokeText(String(tile.value), w / 2, h * 0.4);
  g.fillStyle = col;
  g.fillText(String(tile.value), w / 2, h * 0.4);
  g.restore();
  // breiter Farbbalken unten → Farbe auch von weitem auf einen Blick
  g.fillStyle = col;
  g.beginPath();
  g.roundRect(w * 0.12, h * 0.74, w * 0.76, h * 0.15, h * 0.05);
  g.fill();
}

export function tileTexture(tile: Tile | null): THREE.Texture {
  const key = tile ? (tile.fake ? 'fake' : `${tile.color}-${tile.value}`) : 'blank';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 448;
  drawFace(c.getContext('2d')!, c.width, c.height, tile);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  cache.set(key, tex);
  return tex;
}

const tileGeo = new THREE.BoxGeometry(0.036, 0.05, 0.012);
const sideMat = new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.5 });
const backMat = new THREE.MeshStandardMaterial({ color: '#e6d8b8', roughness: 0.5 });

/** Ein Stein als 3D-Objekt. Vorderseite +Z. */
export function tileMesh(tile: Tile | null, faceUp = true): THREE.Mesh {
  // Gesicht leuchtet leicht selbst → im dunklen Café nicht matschig, Farben bleiben kräftig
  const map = tileTexture(faceUp ? tile : null);
  const faceMat = new THREE.MeshStandardMaterial({ map, roughness: 0.6, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.45 });
  const mats = [sideMat, sideMat, sideMat, sideMat, faceUp ? faceMat : backMat, backMat];
  const m = new THREE.Mesh(tileGeo, mats);
  m.castShadow = true;
  m.userData.tile = tile;
  return m;
}

/** Stein als HTML-Element für die eigene Istaka */
export function tileElement(tile: Tile, okey?: { color: string; value: number }): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.id = String(tile.id);
  if (tile.fake) {
    el.innerHTML = `<span class="num fake">★</span>`;
  } else {
    el.innerHTML = `<span class="num" style="color:${TILE_COLORS[tile.color!]}">${tile.value}</span><span class="heart" style="color:${TILE_COLORS[tile.color!]}">♥</span>`;
    if (okey && tile.color === okey.color && tile.value === okey.value) el.classList.add('okey');
  }
  return el;
}
