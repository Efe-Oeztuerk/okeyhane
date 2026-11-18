// Steuerung ohne Maus: Tastenkürzel, Controller (Gamepad) und Touch-Oberfläche.

import { h } from './dom.ts';
import { settings, keyLabel, isTouch } from './settings.ts';
import { getLang } from './i18n.ts';
import type { World } from './scene.ts';
import type { Istaka } from './istaka.ts';

export interface ControlApi {
  inCafe(): boolean;
  /** sitzt selbst am Tisch (nicht Zuschauer) */
  seated(): boolean;
  started(): boolean;
  drawPile(): void;
  drawSide(): void;
  discard(): void;
  finish(): void;
  indicator(): void;
  okeyBir(): void;
  sortRuns(): void;
  sortPairs(): void;
  emote(key: string): void;
  eye(key: string): void;
  openCayci(): void;
  openQuick(): void;
  openEmotes(): void;
  focusChat(): void;
  toggleChat(): void;
  toggleSheet(): void;
  openMedia(): void;
  escape(): void;
}

const de = () => getLang() === 'de';

// ------------------------------------------------------------------ Auswahl-Menü (Çaycı, Sprüche, Emotes)

interface MenuItem {
  label: string;
  fn: () => void;
}
let openMenu: { el: HTMLElement; items: MenuItem[]; idx: number } | null = null;

export function closeMenu() {
  openMenu?.el.remove();
  openMenu = null;
}

/** Nummeriertes Menü: Ziffern, Controller (Steuerkreuz + A) oder Tippen */
export function popupMenu(title: string, items: MenuItem[]) {
  closeMenu();
  const el = h('div', { class: 'popmenu panel' }, h('div', { class: 'pm-title' }, title));
  const rows = items.map((it, i) =>
    h(
      'button',
      {
        class: 'pm-item' + (i === 0 ? ' hl' : ''),
        onclick: () => {
          closeMenu();
          it.fn();
        },
      },
      h('span', { class: 'pm-num' }, String(i + 1)),
      it.label,
    ),
  );
  el.append(...rows, h('div', { class: 'pm-foot muted' }, de() ? '1–9 wählen · Esc schließen' : '1–9 seç · Esc kapat'));
  document.getElementById('ui')!.append(el);
  openMenu = { el, items, idx: 0 };
}

function menuMove(d: number) {
  if (!openMenu) return;
  const n = openMenu.items.length;
  openMenu.idx = (openMenu.idx + d + n) % n;
  openMenu.el.querySelectorAll('.pm-item').forEach((b, i) => b.classList.toggle('hl', i === openMenu!.idx));
}
function menuPick(i = openMenu?.idx ?? 0) {
  if (!openMenu) return;
  const it = openMenu.items[i];
  closeMenu();
  it?.fn();
}

// ------------------------------------------------------------------ Emote-Rad

interface WheelItem {
  icon: string;
  label: string;
  fn: () => void;
}
let wheel: { el: HTMLElement; items: WheelItem[]; idx: number; openedAt: number; vx: number; vy: number } | null = null;
export function wheelIsOpen() {
  return !!wheel;
}

export function openWheel(items: WheelItem[]) {
  closeWheel();
  closeMenu();
  const el = h('div', { class: 'wheel' });
  const ring = h('div', { class: 'wheel-ring' });
  const center = h('div', { class: 'wheel-center' });
  const R = 150;
  items.forEach((it, i) => {
    const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
    const b = h(
      'div',
      {
        class: 'wheel-item',
        style: { left: `calc(50% + ${Math.cos(a) * R}px)`, top: `calc(50% + ${Math.sin(a) * R}px)` },
        onclick: () => pickWheel(i),
        onmouseenter: () => selWheel(i),
      },
      h('span', { class: 'wi-icon' }, it.icon),
      h('span', { class: 'wi-num' }, String((i + 1) % 10)),
    );
    ring.append(b);
  });
  el.append(
    h('div', { class: 'wheel-title' }, de() ? 'EMOTES' : 'HAREKETLER'),
    ring,
    center,
    h('div', { class: 'wheel-foot' }, de() ? '← → wählen · Enter/E auslösen · Esc schließen' : '← → seç · Enter/E yap · Esc kapat'),
  );
  document.getElementById('ui')!.append(el);
  wheel = { el, items, idx: 0, openedAt: performance.now(), vx: 0, vy: 0 };
  (window as any).__wheelOpen = true;
  selWheel(0);
}
function selWheel(i: number) {
  if (!wheel) return;
  const n = wheel.items.length;
  wheel.idx = ((i % n) + n) % n;
  wheel.el.querySelectorAll('.wheel-item').forEach((b, k) => b.classList.toggle('hl', k === wheel!.idx));
  (wheel.el.querySelector('.wheel-center') as HTMLElement).textContent = wheel.items[wheel.idx].icon + ' ' + wheel.items[wheel.idx].label;
}
function pickWheel(i = wheel?.idx ?? 0) {
  if (!wheel) return;
  const it = wheel.items[i];
  closeWheel();
  it?.fn();
}
export function closeWheel() {
  wheel?.el.remove();
  wheel = null;
  (window as any).__wheelOpen = false;
}
/** Richtung (Maus/Stick) → Eintrag */
function aimWheel(x: number, y: number) {
  if (!wheel || Math.hypot(x, y) < 0.35) return;
  const a = Math.atan2(y, x) + Math.PI / 2;
  const n = wheel.items.length;
  selWheel(Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / n)) % n);
}
addEventListener('mousemove', (e) => {
  if (!wheel) return;
  if (document.pointerLockElement) {
    // beim Umschauen: Mausbewegung lenkt das Rad
    wheel.vx = Math.max(-120, Math.min(120, wheel.vx + e.movementX));
    wheel.vy = Math.max(-120, Math.min(120, wheel.vy + e.movementY));
    aimWheel(wheel.vx / 120, wheel.vy / 120);
  } else {
    const r = wheel.el.getBoundingClientRect();
    aimWheel((e.clientX - (r.left + r.width / 2)) / 100, (e.clientY - (r.top + r.height / 2)) / 100);
  }
});

// ------------------------------------------------------------------ Tastatur

export function setupControls(world: World, istaka: Istaka, api: ControlApi) {
  const typing = (e: Event) => {
    const t = e.target as HTMLElement;
    return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  };

  addEventListener('keydown', (e) => {
    if (!api.inCafe() || typing(e) || e.repeat) return;
    if (document.querySelector('.modal')) return;
    const K = settings.keys;
    const c = e.code;
    // Emote-Rad
    if (wheel) {
      e.preventDefault();
      if (c === 'Escape') return closeWheel();
      if (c === 'ArrowRight' || c === 'ArrowDown') return selWheel(wheel.idx + 1);
      if (c === 'ArrowLeft' || c === 'ArrowUp') return selWheel(wheel.idx - 1);
      if (c === 'Enter' || c === 'Space' || c === K.emoteWheel) return pickWheel();
      const n = /^(Digit|Numpad)([0-9])$/.exec(c);
      if (n) return pickWheel((Number(n[2]) + 9) % 10);
      return;
    }
    if (c === K.emoteWheel && api.seated()) {
      e.preventDefault();
      return api.openEmotes();
    }
    // offenes Menü zuerst
    if (openMenu) {
      if (c === 'Escape') return closeMenu();
      const n = /^(Digit|Numpad)([1-9])$/.exec(c);
      if (n) {
        e.preventDefault();
        return menuPick(Number(n[2]) - 1);
      }
      if (c === 'ArrowDown' || c === 'ArrowRight') return menuMove(1);
      if (c === 'ArrowUp' || c === 'ArrowLeft') return menuMove(-1);
      if (c === 'Enter') return menuPick();
    }
    const seatedGame = api.seated() && api.started();
    const focused = world.seated !== null && world.focus;
    // Istaka-Cursor mit Pfeiltasten (nur am Brett)
    if (focused && api.seated()) {
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[c]) {
        e.preventDefault();
        istaka.moveCursor(arrows[c][0], arrows[c][1], e.shiftKey);
        return;
      }
    }
    if (seatedGame) {
      if (c === K.drawPile) return api.drawPile();
      if (c === K.drawSide) return api.drawSide();
      if (c === K.discard) return api.discard();
      if (c === K.finish) return api.finish();
      if (c === K.indicator) return api.indicator();
      if (c === K.okeyBir) return api.okeyBir();
      if (c === K.sortRuns) return api.sortRuns();
      if (c === K.sortPairs) return api.sortPairs();
    }
    if (api.seated()) {
      if (c === K.select) return istaka.toggleAtCursor(e.shiftKey);
      if (c === K.flip) return istaka.flipAtCursor();
      const em: [string, string][] = [
        [K.emoteTea, 'tea'],
        [K.emoteNargile, 'nargile'],
        [K.emoteSlam, 'slam'],
        [K.emoteTespih, 'tespih'],
        [K.emoteHeadshake, 'headshake'],
        [K.emoteRub, 'rubhands'],
      ];
      for (const [k, v] of em) if (c === k) return api.emote(v);
      if (c === K.wink) return api.eye('wink');
      if (c === K.blink) return api.eye('blink');
      if (c === K.wide) return api.eye('wide');
    }
    if (c === K.cayci) return api.openCayci();
    if (c === K.quick) return api.openQuick();
    if (c === K.sheet) return api.toggleSheet();
    if (c === K.media) return api.openMedia();
    if (c === K.chat) {
      e.preventDefault();
      return api.focusChat();
    }
    if (c === 'Escape') {
      if (istaka.cursor >= 0) {
        istaka.cursor = -1;
        istaka.render();
      }
      api.escape();
    }
  });

  // E gedrückt halten, zielen, loslassen = auslösen (wie bei Fortnite)
  addEventListener('keyup', (e) => {
    if (wheel && e.code === settings.keys.emoteWheel && performance.now() - wheel.openedAt > 350) pickWheel();
  });
  setupGamepad(world, istaka, api);
  setupTouch(world, api);
}

// ------------------------------------------------------------------ Controller

/** Standard-Belegung (Xbox-/PlayStation-Layout) */
export const PAD_HELP = () =>
  de()
    ? [
        ['Linker Stick', 'Laufen'],
        ['Rechter Stick', 'Umschauen'],
        ['A / ✕', 'Stein markieren · Stuhl / Brett wählen'],
        ['B / ○', 'Umschauen ↔ Brett'],
        ['X / □', 'Aus der Mitte ziehen'],
        ['Y / △', 'Von der Seite nehmen'],
        ['RB / R1', 'Abwerfen'],
        ['Start', 'Bitirmek (Fertig)'],
        ['Steuerkreuz', 'Cursor auf der Istaka'],
        ['LB + Steuerkreuz', 'Markierte Steine verschieben'],
        ['LB + A', 'Stein umdrehen'],
        ['LT halten', '3rd Person von hinten (LB+LT: von vorne)'],
        ['RT halten', 'Zoom'],
        ['Select / Share', 'Çaycı rufen'],
        ['LB + Select', 'Punktezettel'],
        ['L3', 'Çay trinken'],
        ['R3', 'Emote-Rad (Stick zielen, A auslösen)'],
      ]
    : [
        ['Sol çubuk', 'Yürü'],
        ['Sağ çubuk', 'Etrafa bak'],
        ['A / ✕', 'Taş seç · Sandalye / masa'],
        ['B / ○', 'Etrafa bak ↔ masa'],
        ['X / □', 'Ortadan çek'],
        ['Y / △', 'Yandan al'],
        ['RB / R1', 'Taş at'],
        ['Start', 'Bitir'],
        ['Yön tuşları', 'Istaka imleci'],
        ['LB + yön', 'Seçili taşları kaydır'],
        ['LB + A', 'Taşı çevir'],
        ['LT basılı', 'Arkadan bak (LB+LT: önden)'],
        ['RT basılı', 'Yakınlaştır'],
        ['Select / Share', 'Çaycıyı çağır'],
        ['LB + Select', 'Puan kağıdı'],
        ['L3', 'Çay iç'],
        ['R3', 'Hareket çarkı (çubukla seç, A)'],
      ];

function setupGamepad(world: World, istaka: Istaka, api: ControlApi) {
  const prev: boolean[] = [];
  let repeatT = 0;
  const loop = () => {
    requestAnimationFrame(loop);
    const pads = navigator.getGamepads?.() ?? [];
    const p = [...pads].find((x) => x && x.connected);
    if (!p || !api.inCafe()) return;
    const b = p.buttons.map((x) => x.pressed);
    const down = (i: number) => b[i] && !prev[i];
    const up = (i: number) => !b[i] && prev[i];
    const LB = b[4];
    // gehaltene Tasten
    world.setZoom(!!b[7]);
    world.setThird(b[6] ? (LB ? 'front' : 'back') : null);

    if (wheel) {
      const ax = p.axes;
      if (Math.hypot(ax[0], ax[1]) > 0.5) aimWheel(ax[0], ax[1]);
      else if (Math.hypot(ax[2] ?? 0, ax[3] ?? 0) > 0.5) aimWheel(ax[2], ax[3]);
      if (down(14) || down(12)) selWheel(wheel.idx - 1);
      if (down(15) || down(13)) selWheel(wheel.idx + 1);
      if (down(0)) pickWheel();
      if (down(1) || down(11)) closeWheel();
      for (let i = 0; i < b.length; i++) prev[i] = b[i];
      return;
    }
    if (openMenu) {
      if (down(12) || down(14)) menuMove(-1);
      if (down(13) || down(15)) menuMove(1);
      if (down(0)) menuPick();
      if (down(1)) closeMenu();
    } else {
      const seated = api.seated();
      const focused = world.seated !== null && world.focus;
      // Steuerkreuz mit Wiederholung
      const dir: [number, number] | null = b[14] ? [-1, 0] : b[15] ? [1, 0] : b[12] ? [0, -1] : b[13] ? [0, 1] : null;
      const dirDown = down(12) || down(13) || down(14) || down(15);
      if (dir && focused && seated) {
        repeatT -= 1 / 60;
        if (dirDown) repeatT = 0.35;
        if (dirDown || repeatT <= 0) {
          if (!dirDown) repeatT = 0.11;
          istaka.moveCursor(dir[0], dir[1], LB);
        }
      }
      if (down(0)) {
        if (world.seated === null || !world.focus) world.interact();
        else if (seated) LB ? istaka.flipAtCursor() : istaka.toggleAtCursor();
      }
      if (down(1) && world.seated !== null) world.setFocus(!world.focus);
      if (seated && api.started()) {
        if (down(2)) api.drawPile();
        if (down(3)) api.drawSide();
        if (down(5)) api.discard();
        if (down(9)) api.finish();
      }
      if (down(8)) LB ? api.toggleSheet() : api.openCayci();
      if (seated && down(10)) api.emote('tea');
      if (seated && down(11)) api.openEmotes();
    }
    if (up(7)) world.setZoom(false);
    for (let i = 0; i < b.length; i++) prev[i] = b[i];
  };
  addEventListener('gamepadconnected', () => {
    document.body.classList.add('pad');
  });
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ Touch (Handy / Tablet / Stift)

export function touchActive() {
  return settings.touchUi === 'on' || (settings.touchUi === 'auto' && isTouch);
}

function setupTouch(world: World, api: ControlApi) {
  const root = h('div', { class: 'touch-ui' });
  // Joystick zum Laufen
  const knob = h('div', { class: 'knob' });
  const stick = h('div', { class: 'joystick' }, knob);
  let sid: number | null = null;
  let c0 = { x: 0, y: 0 };
  stick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    c0 = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    world.touchMoving = true;
    e.stopPropagation();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    const R = 46;
    let dx = e.clientX - c0.x;
    let dy = e.clientY - c0.y;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    world.moveInput = { x: dx / R, y: -dy / R };
  });
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== sid) return;
    sid = null;
    knob.style.transform = '';
    world.moveInput = { x: 0, y: 0 };
    world.touchMoving = false;
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  const hold = (label: string, title: string, on: () => void, off: () => void) => {
    const b = h('button', { class: 'tbtn', title }, label);
    b.addEventListener('pointerdown', (e) => (e.preventDefault(), b.setPointerCapture(e.pointerId), on()));
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    return b;
  };
  const tap = (label: string, title: string, fn: () => void, cls = '') => h('button', { class: 'tbtn ' + cls, title, onclick: fn }, label);
  const lookBtn = tap('👁', 'Umschauen / Brett', () => world.setFocus(!world.focus), 'seated-only');
  const btns = h(
    'div',
    { class: 'tbtns' },
    lookBtn,
    hold('🔍', 'Zoom', () => world.setZoom(true), () => world.setZoom(false)),
    hold('🎥', '3rd Person', () => world.setThird('back'), () => world.setThird(null)),
    hold('🪞', 'Von vorne', () => world.setThird('front'), () => world.setThird(null)),
    tap('☕', 'Çaycı', () => api.openCayci()),
    tap('😊', 'Emotes', () => api.openEmotes(), 'seated-only'),
    tap('💬', 'Chat', () => api.toggleChat()),
  );
  root.append(stick, btns);
  document.body.append(root);
  const sync = () => {
    const on = touchActive() && api.inCafe();
    root.classList.toggle('hidden', !on);
    document.body.classList.toggle('touch', touchActive());
    root.classList.toggle('seated', world.seated !== null);
  };
  setInterval(sync, 300);
  sync();
}

/** Kurze Tastenhilfe für die Fokus-Anzeige */
export function keyHintLine() {
  const K = settings.keys;
  const L = keyLabel;
  return de()
    ? `${L(K.drawPile)} Mitte · ${L(K.drawSide)} Seite · ${L(K.discard)} Abwerfen · ${L(K.finish)} Fertig · ←→↑↓ Cursor · ${L(K.select)} Markieren (Shift+Pfeil = schieben) · ${L(K.emoteWheel)} Emotes · ${L(K.cayci)} Çaycı · ${L(K.thirdBack)}/${L(K.thirdFront)} halten = 3rd Person`
    : `${L(K.drawPile)} orta · ${L(K.drawSide)} yan · ${L(K.discard)} at · ${L(K.finish)} bitir · ←→↑↓ imleç · ${L(K.select)} seç (Shift+ok = kaydır) · ${L(K.emoteWheel)} hareketler · ${L(K.cayci)} çaycı · ${L(K.thirdBack)}/${L(K.thirdFront)} basılı = 3. şahıs`;
}
