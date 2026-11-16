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

function drawFace(g: CanvasRenderingContext2D, w: number, h: number, tile: Tile | null) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#fffaf0');
  grad.addColorStop(1, '#efe3c8');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c9b48a';
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  if (!tile) return;
  if (tile.fake) {
    g.fillStyle = '#2e7d32';
    g.font = `bold ${h * 0.45}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('★', w / 2, h * 0.45);
    return;
  }
  const col = TILE_COLORS[tile.color!];
  g.fillStyle = col;
  g.font = `bold ${h * 0.42}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(tile.value), w / 2, h * 0.38);
  // kleines Herz wie bei echten Steinen
  g.beginPath();
  const cx = w / 2;
  const cy = h * 0.72;
  const r = w * 0.1;
  g.moveTo(cx, cy + r * 1.2);
  g.bezierCurveTo(cx - r * 2, cy - r * 0.2, cx - r, cy - r * 1.6, cx, cy - r * 0.6);
  g.bezierCurveTo(cx + r, cy - r * 1.6, cx + r * 2, cy - r * 0.2, cx, cy + r * 1.2);
  g.fill();
}

export function tileTexture(tile: Tile | null): THREE.Texture {
  const key = tile ? (tile.fake ? 'fake' : `${tile.color}-${tile.value}`) : 'blank';
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 180;
  drawFace(c.getContext('2d')!, c.width, c.height, tile);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

const tileGeo = new THREE.BoxGeometry(0.036, 0.05, 0.012);
const sideMat = new THREE.MeshStandardMaterial({ color: '#efe3c8', roughness: 0.5 });
const backMat = new THREE.MeshStandardMaterial({ color: '#e6d8b8', roughness: 0.5 });

/** Ein Stein als 3D-Objekt. Vorderseite +Z. */
export function tileMesh(tile: Tile | null, faceUp = true): THREE.Mesh {
  const faceMat = new THREE.MeshStandardMaterial({ map: tileTexture(faceUp ? tile : null), roughness: 0.45 });
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
