// Prozedurale Texturen für das Kahvehane (keine Bilddateien nötig)

import * as THREE from 'three';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

export function woodFloor() {
  return canvasTex(512, 512, (g) => {
    for (let i = 0; i < 8; i++) {
      const base = 90 + Math.random() * 30;
      g.fillStyle = `rgb(${base + 40},${base},${base - 40})`;
      g.fillRect(0, i * 64, 512, 64);
      g.strokeStyle = 'rgba(40,20,10,0.5)';
      g.lineWidth = 3;
      g.strokeRect(0, i * 64, 512, 64);
      const off = Math.random() * 400;
      g.beginPath();
      g.moveTo(off, i * 64);
      g.lineTo(off, i * 64 + 64);
      g.stroke();
      for (let k = 0; k < 20; k++) {
        g.strokeStyle = `rgba(60,30,15,${Math.random() * 0.15})`;
        g.lineWidth = 1;
        g.beginPath();
        const y = i * 64 + Math.random() * 64;
        g.moveTo(0, y);
        g.bezierCurveTo(150, y + 4, 350, y - 4, 512, y);
        g.stroke();
      }
    }
  }, [6, 6]);
}

export function wallTiles() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#e9dfc9';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++) {
        g.fillStyle = (x + y) % 2 ? '#2f6f8f' : '#e9dfc9';
        g.save();
        g.translate(x * 64 + 32, y * 64 + 32);
        g.rotate(Math.PI / 4);
        g.fillRect(-14, -14, 28, 28);
        g.restore();
        g.strokeStyle = '#bfae8a';
        g.strokeRect(x * 64, y * 64, 64, 64);
      }
  }, [12, 1]);
}

export function kilim(seed = 1) {
  const palettes = [
    ['#8e1b1b', '#e3b04b', '#1d3557', '#f1e3c6', '#2a6041'],
    ['#7a2e1f', '#d9a441', '#24453a', '#efe1c2', '#3b2a50'],
  ];
  const p = palettes[seed % palettes.length];
  return canvasTex(512, 768, (g) => {
    g.fillStyle = p[0];
    g.fillRect(0, 0, 512, 768);
    g.fillStyle = p[3];
    g.fillRect(24, 24, 464, 720);
    g.fillStyle = p[0];
    g.fillRect(40, 40, 432, 688);
    for (let row = 0; row < 5; row++) {
      const cy = 110 + row * 137;
      for (let k = 0; k < 3; k++) {
        const s = 60 - k * 18;
        g.fillStyle = p[(row + k + 1) % p.length];
        g.beginPath();
        g.moveTo(256, cy - s);
        g.lineTo(256 + s * 1.6, cy);
        g.lineTo(256, cy + s);
        g.lineTo(256 - s * 1.6, cy);
        g.closePath();
        g.fill();
      }
      for (const x of [90, 422]) {
        g.fillStyle = p[(row + 2) % p.length];
        g.beginPath();
        g.moveTo(x, cy - 30);
        g.lineTo(x + 25, cy);
        g.lineTo(x, cy + 30);
        g.lineTo(x - 25, cy);
        g.fill();
      }
    }
    // Fransen
    g.strokeStyle = p[3];
    for (let x = 30; x < 490; x += 10) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 22);
      g.moveTo(x, 746);
      g.lineTo(x, 768);
      g.stroke();
    }
  });
}

/** Türkische Flagge */
export function flag() {
  return canvasTex(600, 400, (g) => {
    g.fillStyle = '#e30a17';
    g.fillRect(0, 0, 600, 400);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(225, 200, 100, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e30a17';
    g.beginPath();
    g.arc(250, 200, 80, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    const cx = 345;
    const cy = 200;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 50 : 20;
      const a = (i * Math.PI) / 5 - Math.PI / 2 + Math.PI / 2;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });
}

/** Erfundenes Schwarz-Weiß-Porträt im Yeşilçam-Stil (keine echte Person) */
export function portrait(seed: number) {
  const rnd = (n: number) => {
    const x = Math.sin(seed * 999 + n * 77) * 10000;
    return x - Math.floor(x);
  };
  return canvasTex(300, 400, (g) => {
    const bg = g.createRadialGradient(150, 160, 20, 150, 200, 260);
    bg.addColorStop(0, '#bdbdbd');
    bg.addColorStop(1, '#3a3a3a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 300, 400);
    // Schultern
    g.fillStyle = '#1e1e1e';
    g.beginPath();
    g.ellipse(150, 420, 140, 120, 0, Math.PI, 0);
    g.fill();
    // Hals + Kopf
    g.fillStyle = '#9a9a9a';
    g.fillRect(128, 230, 44, 60);
    g.fillStyle = '#b4b4b4';
    g.beginPath();
    g.ellipse(150, 180, 62 + rnd(1) * 10, 78 + rnd(2) * 10, 0, 0, Math.PI * 2);
    g.fill();
    // Haare
    g.fillStyle = '#202020';
    g.beginPath();
    g.ellipse(150, 130 - rnd(3) * 10, 66, 40, 0, Math.PI, 0);
    g.fill();
    if (rnd(4) > 0.5) {
      g.beginPath();
      g.ellipse(115, 125, 30, 18, -0.4, 0, Math.PI * 2);
      g.fill();
    }
    // Augen, Brauen, Schnurrbart
    g.fillStyle = '#2a2a2a';
    for (const x of [125, 175]) {
      g.beginPath();
      g.ellipse(x, 175, 8, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x - 14, 157 - rnd(5) * 4, 28, 5);
    }
    if (rnd(6) > 0.35) {
      g.beginPath();
      g.ellipse(150, 222, 26, 8, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#7a7a7a';
    g.fillRect(146, 185, 8, 25);
    // Körnung + Vignette
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},0.05)`;
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(Math.random() * 300, Math.random() * 400, 2, 2);
    }
    g.strokeStyle = '#efe8d8';
    g.lineWidth = 14;
    g.strokeRect(0, 0, 300, 400);
  });
}

export function cityWindow(mode: 'day' | 'evening' | 'night') {
  return canvasTex(512, 384, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 384);
    if (mode === 'day') {
      sky.addColorStop(0, '#8ec5ea');
      sky.addColorStop(1, '#dff0fa');
    } else if (mode === 'evening') {
      sky.addColorStop(0, '#3b3f7a');
      sky.addColorStop(0.6, '#e8835a');
      sky.addColorStop(1, '#f6c27a');
    } else {
      sky.addColorStop(0, '#060a1a');
      sky.addColorStop(1, '#1a2240');
    }
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 384);
    // Moschee-Silhouette + Häuser
    g.fillStyle = mode === 'day' ? '#7b8796' : mode === 'evening' ? '#3a2e3e' : '#0b0e18';
    g.beginPath();
    g.arc(256, 250, 60, Math.PI, 0);
    g.fill();
    g.fillRect(196, 250, 120, 140);
    for (const x of [150, 362]) {
      g.fillRect(x - 6, 120, 12, 270);
      g.beginPath();
      g.moveTo(x - 8, 120);
      g.lineTo(x, 90);
      g.lineTo(x + 8, 120);
      g.fill();
    }
    for (let i = 0; i < 12; i++) {
      const x = i * 45 - 10;
      const h = 80 + ((i * 37) % 70);
      g.fillRect(x, 384 - h, 40, h);
      if (mode !== 'day') {
        g.fillStyle = '#ffd77a';
        for (let k = 0; k < 4; k++) if ((i + k) % 3 === 0) g.fillRect(x + 8 + (k % 2) * 16, 384 - h + 12 + Math.floor(k / 2) * 22, 8, 10);
        g.fillStyle = mode === 'evening' ? '#3a2e3e' : '#0b0e18';
      }
    }
    if (mode === 'night') {
      g.fillStyle = '#fff';
      for (let i = 0; i < 60; i++) g.fillRect(Math.random() * 512, Math.random() * 180, 2, 2);
      g.beginPath();
      g.arc(420, 70, 22, 0, Math.PI * 2);
      g.fill();
    }
    // Fensterkreuz
    g.fillStyle = '#5a3a22';
    g.fillRect(250, 0, 12, 384);
    g.fillRect(0, 186, 512, 12);
  });
}

export function clockFace() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#f7f0df';
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a2a1a';
    g.lineWidth = 10;
    g.stroke();
    g.fillStyle = '#2a1d14';
    g.font = 'bold 30px Georgia';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(String(i), 128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
    }
  });
}

export function signText(text: string, color = '#ffd27a', bg = '#5a1d14') {
  return canvasTex(1024, 256, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = '#d9a441';
    g.lineWidth = 12;
    g.strokeRect(10, 10, 1004, 236);
    g.fillStyle = color;
    g.font = 'bold 120px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 512, 135);
  });
}

export function feltTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#1f5a3a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  }, [3, 3]);
}

export function smokeSprite() {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(235,235,235,0.55)');
    gr.addColorStop(1, 'rgba(235,235,235,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  });
}
