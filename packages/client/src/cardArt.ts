// Spielkarten für Pişti: eine Zeichnung (Canvas) für 3D-Tisch und Hand
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

const RED = '#c4122f';
const BLACK = '#161616';
const GOLD = '#d4a23c';
const NAVY = '#1f3a6b';
const W = 400;
const H = 560;
const R = 30;

// Anordnung der Symbole auf Zahlenkarten (x, y in 0..1 des Mittelfelds; >0.5 unten = gedreht)
const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
};

const canvasCache = new Map<string, HTMLCanvasElement>();

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, hh, r);
}

/** kleine Krone / Diadem / Mütze für die Bildkarten */
function headwear(g: CanvasRenderingContext2D, rank: number, cx: number, cy: number, s: number, col: string) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = GOLD;
  g.strokeStyle = '#7a5410';
  g.lineWidth = 3;
  g.beginPath();
  if (rank === 13) {
    // Krone mit 5 Zacken
    g.moveTo(-s, s * 0.45);
    g.lineTo(-s, -s * 0.2);
    for (let i = 0; i < 5; i++) {
      const x0 = -s + (i * 2 * s) / 5;
      g.lineTo(x0 + s / 5, -s * 0.75);
      g.lineTo(x0 + (2 * s) / 5, -s * 0.2);
    }
    g.lineTo(s, s * 0.45);
    g.closePath();
  } else if (rank === 12) {
    // Diadem (Bogen mit Spitze)
    g.moveTo(-s, s * 0.4);
    g.quadraticCurveTo(-s * 0.6, -s * 0.5, 0, -s * 0.8);
    g.quadraticCurveTo(s * 0.6, -s * 0.5, s, s * 0.4);
    g.closePath();
  } else {
    // Mütze des Buben
    g.moveTo(-s, s * 0.45);
    g.quadraticCurveTo(-s * 0.9, -s * 0.6, 0, -s * 0.55);
    g.quadraticCurveTo(s * 1.1, -s * 0.5, s * 1.25, -s * 0.05);
    g.lineTo(s, s * 0.45);
    g.closePath();
  }
  g.fill();
  g.stroke();
  // Edelsteine
  g.fillStyle = col;
  for (const x of [-s * 0.5, 0, s * 0.5]) {
    g.beginPath();
    g.arc(x, s * 0.12, s * 0.11, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Karte als Canvas (wird für 3D-Textur und Handkarte benutzt) */
export function cardCanvas(c: PCard | null): HTMLCanvasElement {
  const key = c ? `${c.suit}${c.rank}` : 'back';
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (!c) {
    // Rückseite: weißer Rand, dunkelrot mit goldenem Çini-Gitter + Okeyhane
    rounded(g, 0, 0, W, H, R);
    g.fillStyle = '#f6efde';
    g.fill();
    rounded(g, 16, 16, W - 32, H - 32, R - 10);
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#8e1726');
    grd.addColorStop(1, '#5e0d18');
    g.fillStyle = grd;
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(232,194,122,0.28)';
    g.lineWidth = 2;
    for (let i = -H; i < W + H; i += 30) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H, H);
      g.moveTo(i + H, 0);
      g.lineTo(i, H);
      g.stroke();
    }
    // kleine Rauten in den Gitterpunkten
    g.fillStyle = 'rgba(232,194,122,0.45)';
    for (let y = 15; y < H; y += 30)
      for (let x = (y / 30) % 2 ? 0 : 15; x < W; x += 30) {
        g.beginPath();
        g.moveTo(x, y - 4);
        g.lineTo(x + 4, y);
        g.lineTo(x, y + 4);
        g.lineTo(x - 4, y);
        g.fill();
      }
    g.restore();
    g.strokeStyle = '#e8c27a';
    g.lineWidth = 5;
    rounded(g, 34, 34, W - 68, H - 68, 14);
    g.stroke();
    // Medaillon in der Mitte
    g.fillStyle = '#5e0d18';
    g.beginPath();
    g.ellipse(W / 2, H / 2, 108, 62, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#e8c27a';
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = '#f0cf8a';
    g.font = '700 40px Georgia, serif';
    g.fillText('OKEYHANE', W / 2, H / 2 + 2);
  } else {
    const col = isRed(c) ? RED : BLACK;
    const sym = SUIT_SYM[c.suit];
    const lab = rankLabel(c.rank);
    rounded(g, 0, 0, W, H, R);
    const paper = g.createLinearGradient(0, 0, 0, H);
    paper.addColorStop(0, '#fffdf7');
    paper.addColorStop(1, '#f5eedd');
    g.fillStyle = paper;
    g.fill();
    g.strokeStyle = '#d5c7a6';
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = col;
    // Ecken: groß und fett (auch klein auf dem Tisch lesbar)
    const corner = () => {
      g.font = `900 ${lab.length > 1 ? 84 : 96}px Georgia, serif`;
      g.fillText(lab, 60, 66);
      g.font = '74px serif';
      g.fillText(sym, 60, 142);
    };
    corner();
    g.save();
    g.translate(W, H);
    g.rotate(Math.PI);
    corner();
    g.restore();
    if (c.rank >= 2 && c.rank <= 10) {
      // Symbole wie auf echten Karten
      const x0 = 132;
      const x1 = W - 132;
      const y0 = 118;
      const y1 = H - 118;
      g.font = `${c.rank >= 9 ? 74 : 84}px serif`;
      for (const [px, py] of PIPS[c.rank]) {
        const x = x0 + (x1 - x0) * px;
        const y = y0 + (y1 - y0) * py;
        g.save();
        g.translate(x, y);
        if (py > 0.5) g.rotate(Math.PI);
        g.fillText(sym, 0, 0);
        g.restore();
      }
    } else if (c.rank === 1) {
      // Ass: großes Symbol mit feinem Ring
      g.strokeStyle = col;
      g.globalAlpha = 0.25;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(W / 2, H / 2, 120, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      g.font = '210px serif';
      g.fillText(sym, W / 2, H / 2 + 10);
    } else {
      // Bildkarte: Rahmen, Farbfeld, Kopfschmuck, Buchstabe – oben/unten gespiegelt
      const fx = 104;
      const fy = 92;
      const fw = W - 208;
      const fh = H - 184;
      rounded(g, fx, fy, fw, fh, 14);
      g.fillStyle = isRed(c) ? '#fbe3e1' : '#e3e8f3';
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = col;
      g.stroke();
      const half = () => {
        g.save();
        rounded(g, fx, fy, fw, fh / 2, 14);
        g.clip();
        // Gewand
        g.fillStyle = isRed(c) ? RED : NAVY;
        g.beginPath();
        g.moveTo(fx, fy + fh / 2);
        g.quadraticCurveTo(W / 2, fy + fh * 0.18, fx + fw, fy + fh / 2);
        g.fill();
        g.fillStyle = GOLD;
        g.fillRect(fx, fy + fh / 2 - 14, fw, 8);
        g.restore();
        headwear(g, c.rank, W / 2, fy + 64, 46, isRed(c) ? NAVY : RED);
        g.fillStyle = col;
        g.font = '900 78px Georgia, serif';
        g.fillText(lab, W / 2, fy + 150);
      };
      half();
      g.save();
      g.translate(W, H);
      g.rotate(Math.PI);
      half();
      g.restore();
      // Symbol in der Mitte
      g.fillStyle = '#fffdf7';
      g.beginPath();
      g.arc(W / 2, H / 2, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = col;
      g.font = '54px serif';
      g.fillText(sym, W / 2, H / 2 + 3);
    }
  }
  canvasCache.set(key, cv);
  return cv;
}

const texCache = new Map<string, THREE.CanvasTexture>();
export function cardTexture(c: PCard | null): THREE.CanvasTexture {
  const key = c ? `${c.suit}${c.rank}` : 'back';
  let tex = texCache.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(cardCanvas(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    texCache.set(key, tex);
  }
  return tex;
}

// 3D: zwei Flächen (Vorder- und Rückseite) mit runden Ecken (Alpha), dazu ein ganz dünner Kartenrand
const CW = 0.082;
const CH = 0.1148;
const planeGeo = new THREE.PlaneGeometry(CW, CH);
const matCache = new Map<string, THREE.Material>();
function sideMat(c: PCard | null) {
  const key = c ? `${c.suit}${c.rank}` : 'back';
  let m = matCache.get(key);
  if (!m) {
    {
      // Vorder- und Rückseite: nur das echte Kartenbild – keine Ersatz-Zeichnung darunter (sonst zwei Designs ineinander)
      const mat = new THREE.MeshStandardMaterial({ color: '#f4f1ea', alphaTest: 0.5, roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.32 });
      m = mat;
      new THREE.TextureLoader().load(cardUrl(key), (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 16;
        mat.color.set('#ffffff');
        mat.map = t;
        mat.emissiveMap = t;
        mat.needsUpdate = true;
      });
    }
    matCache.set(key, m);
  }
  return m;
}

/** flache 3D-Karte (Vorderseite oben, wenn faceUp) */
export function cardMesh(c: PCard | null, faceUp = true): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(planeGeo, sideMat(faceUp && c ? c : null));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0004;
  const bottom = new THREE.Mesh(planeGeo, sideMat(faceUp ? null : c));
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -0.0004;
  top.receiveShadow = bottom.receiveShadow = true;
  g.add(top, bottom);
  return g;
}

/** Pfad der Kartengrafik (Deck: „Playing Cards“ von DudleyLong, CC BY 4.0) */
function cardUrl(key: string) {
  return `/cards/${key}.webp?v=3`;
}

/** HTML-Karte für die Hand (dieselbe Grafik wie auf dem Tisch) */
export function cardElement(c: PCard | null): HTMLElement {
  const key = c ? `${c.suit}${c.rank}` : 'back';
  const img = h('img', { src: cardUrl(key), alt: c ? rankLabel(c.rank) + SUIT_SYM[c.suit] : '', draggable: 'false' }) as HTMLImageElement;
  // Ersatz, falls die Datei nicht lädt: selbst gezeichnete Karte
  img.onerror = () => {
    img.onerror = null;
    img.src = cardCanvas(c).toDataURL('image/png');
  };
  return h('div', { class: 'pcard' + (c ? '' : ' back') }, img);
}
