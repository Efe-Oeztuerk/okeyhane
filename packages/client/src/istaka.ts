// Eigene Istaka: 2 Reihen × 16 Plätze, Drag & Drop, Auswahl, Sortieren.

import { arrange, toCounts, COLORS, isRealOkey, type Tile, type OkeyIdentity } from '@okeyhane/engine';
import { h } from './dom.ts';
import { tileElement } from './tileArt.ts';
import { sfx } from './sound.ts';

export const COLS = 16;
export const SLOTS = COLS * 2;

export class Istaka {
  el: HTMLDivElement;
  slots: (number | null)[] = new Array(SLOTS).fill(null);
  tiles = new Map<number, Tile>();
  selected = new Set<number>();
  okey: OkeyIdentity | null = null;
  private dragId: number | null = null;
  private ghost: HTMLElement | null = null;
  private justAdded = new Set<number>();
  onDropZone: ((zone: string, id: number) => void) | null = null;
  onChange: (() => void) | null = null;

  constructor() {
    this.el = h('div', { class: 'istaka' });
    try {
      const saved = JSON.parse(sessionStorage.getItem('istaka') || 'null');
      if (Array.isArray(saved) && saved.length === SLOTS) this.slots = saved;
    } catch {}
  }

  /** Neue Hand vom Server: bekannte Steine bleiben an ihrem Platz. */
  setHand(hand: Tile[], okey: OkeyIdentity) {
    this.okey = okey;
    const ids = new Set(hand.map((t) => t.id));
    this.justAdded.clear();
    for (let i = 0; i < SLOTS; i++) if (this.slots[i] !== null && !ids.has(this.slots[i]!)) this.slots[i] = null;
    for (const s of [...this.selected]) if (!ids.has(s)) this.selected.delete(s);
    for (const f of [...this.flipped]) if (!ids.has(f)) this.flipped.delete(f);
    this.tiles = new Map(hand.map((t) => [t.id, t]));
    const placed = new Set(this.slots.filter((x) => x !== null));
    const fresh = hand.filter((t) => !placed.has(t.id));
    const isNewHand = placed.size === 0;
    if (isNewHand) {
      this.slots.fill(null);
      fresh.forEach((t, i) => (this.slots[i] = t.id));
    } else {
      for (const t of fresh) {
        // per Ziehen auf einen Platz gelegt → genau dorthin
        if (this.pendingSlot !== null && this.slots[this.pendingSlot] === null) {
          this.slots[this.pendingSlot] = t.id;
          this.justAdded.add(t.id);
          this.pendingSlot = null;
          continue;
        }
        // neuer Stein: hinten in der unteren Reihe, sonst erster freier Platz
        let i = -1;
        for (let k = SLOTS - 1; k >= COLS; k--) if (this.slots[k] === null) { i = k; break; }
        if (i < 0) i = this.slots.indexOf(null);
        this.slots[i] = t.id;
        this.justAdded.add(t.id);
      }
    }
    this.pendingSlot = null;
    this.render();
    this.flyIn();
  }

  /** Platz, auf den der nächste gezogene Stein soll (Drag aus der Mitte/Seite) */
  pendingSlot: number | null = null;
  /** Bildschirmpunkt, von dem der nächste neue Stein einfliegt */
  flyFrom: { x: number; y: number } | null = null;

  /** neuer Stein fliegt von der Tischmitte/Seite in seinen Platz */
  private flyIn() {
    const from = this.flyFrom;
    this.flyFrom = null;
    if (!from) return;
    for (const id of this.justAdded) {
      const el = this.el.querySelector(`.tile[data-id="${id}"]`) as HTMLElement | null;
      if (!el) continue;
      el.classList.remove('new');
      const r = el.getBoundingClientRect();
      const dx = from.x - (r.left + r.width / 2);
      const dy = from.y - (r.top + r.height / 2);
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px) scale(0.45) rotate(-8deg)`;
      el.style.zIndex = '20';
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.42s cubic-bezier(.2,.8,.25,1)';
          el.style.transform = '';
          setTimeout(() => {
            el.style.transition = '';
            el.style.zIndex = '';
          }, 450);
        }),
      );
    }
  }

  /** Stein von außen (Mitte/Seite) auf die Istaka ziehen. onDrop: Platz-Index oder null */
  externalDrag(ghostTile: HTMLElement, e: PointerEvent, onDrop: (slot: number | null, moved: boolean, x: number, y: number) => void) {
    const ghost = h('div', { class: 'dragghost pull' });
    ghost.append(ghostTile);
    document.body.append(ghost);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const place = (x: number, y: number) => {
      ghost.style.left = x - 23 + 'px';
      ghost.style.top = y - 32 + 'px';
    };
    place(sx, sy);
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) moved = true;
      place(ev.clientX, ev.clientY);
      document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
      const t = this.targetAt(ev.clientX, ev.clientY);
      if (t?.dataset.slot !== undefined) t.classList.add('over');
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
      ghost.remove();
      const t = this.targetAt(ev.clientX, ev.clientY);
      const slot = t?.dataset.slot !== undefined ? Number(t.dataset.slot) : null;
      onDrop(moved && slot !== null && this.slots[slot] === null ? slot : moved && slot !== null ? this.nearestFree(slot) : null, moved, ev.clientX, ev.clientY);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  private nearestFree(slot: number) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < SLOTS; i++) {
      if (this.slots[i] !== null) continue;
      const d = Math.abs(i - slot) + (Math.floor(i / COLS) === Math.floor(slot / COLS) ? 0 : 40);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  clear() {
    this.flipped.clear();
    this.slots.fill(null);
    this.tiles.clear();
    this.selected.clear();
    this.render();
  }

  private persist() {
    sessionStorage.setItem('istaka', JSON.stringify(this.slots));
  }

  /** Umgedrehte Steine (z. B. um den Okey zu verstecken) – nur lokal */
  flipped = new Set<number>(JSON.parse(sessionStorage.getItem('flipped') || '[]'));
  /** Wurfzone unter dem Punkt (Mitte = beenden, rechts = abwerfen) */
  zoneAt: ((x: number, y: number) => 'finish' | 'discard' | null) | null = null;
  /** Zonen auf dem Tisch anzeigen (false = aus) */
  onZoneHover: ((z: 'finish' | 'discard' | null | false) => void) | null = null;
  /** Darf gerade abgeworfen werden? */
  canDiscard: (() => boolean) | null = null;
  private lastClick = { id: -1, t: 0 };

  render() {
    this.persist();
    sessionStorage.setItem('flipped', JSON.stringify([...this.flipped]));
    this.el.innerHTML = '';
    for (let r = 0; r < 2; r++) {
      const row = h('div', { class: 'rowslots' });
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const slot = h('div', { class: 'slot' + (idx === this.cursor ? ' cursor' : '') });
        slot.dataset.slot = String(idx);
        const id = this.slots[idx];
        if (id !== null) {
          const tile = this.tiles.get(id);
          if (tile) {
            const te = tileElement(tile, this.okey ?? undefined);
            if (this.flipped.has(id)) te.classList.add('flipped');
            if (this.selected.has(id)) te.classList.add('sel');
            if (this.justAdded.has(id)) te.classList.add('new');
            te.addEventListener('pointerdown', (e) => this.startDrag(e, id, te));
            slot.append(te);
          }
        }
        row.append(slot);
      }
      this.el.append(row);
    }
  }

  // ---------------------------------------------------------- Tastatur / Controller

  /** Cursor-Platz für Tastatur und Controller (-1 = aus) */
  cursor = -1;

  /** Cursor bewegen; mit carry wandern die markierten Steine mit */
  moveCursor(dx: number, dy: number, carry = false) {
    if (this.cursor < 0) {
      // beim ersten Druck: auf den ersten Stein
      const first = this.slots.findIndex((x) => x !== null);
      this.cursor = first < 0 ? 0 : first;
      this.render();
      return;
    }
    let r = Math.floor(this.cursor / COLS);
    let c = this.cursor % COLS;
    const nr = Math.max(0, Math.min(1, r + dy));
    const nc = Math.max(0, Math.min(COLS - 1, c + dx));
    if (carry && this.selected.size) {
      const sel = this.orderedSelection();
      const idx = sel.map((id) => this.slots.indexOf(id));
      const moved = idx.map((i) => {
        const rr = Math.floor(i / COLS) + (nr - r);
        const cc = (i % COLS) + (nc - c);
        return rr < 0 || rr > 1 || cc < 0 || cc >= COLS ? -1 : rr * COLS + cc;
      });
      if (moved.every((m) => m >= 0)) {
        const free = moved.every((m) => this.slots[m] === null || this.selected.has(this.slots[m]!));
        if (free) {
          idx.forEach((i) => (this.slots[i] = null));
          moved.forEach((m, k) => (this.slots[m] = sel[k]));
        } else if (sel.length === 1) {
          // einzelner Stein: Platz tauschen
          const other = this.slots[moved[0]];
          this.slots[moved[0]] = sel[0];
          this.slots[idx[0]] = other;
        } else return;
        sfx.tile();
      } else return;
    }
    r = nr;
    c = nc;
    this.cursor = r * COLS + c;
    this.render();
    this.onChange?.();
  }

  cursorTile(): number | null {
    return this.cursor >= 0 ? this.slots[this.cursor] : null;
  }

  /** Stein unter dem Cursor (de)markieren */
  toggleAtCursor(group = false) {
    const id = this.cursorTile();
    if (id === null) return;
    if (group) {
      const g = this.groupOf(id);
      const allSel = g.every((x) => this.selected.has(x));
      for (const x of g) allSel ? this.selected.delete(x) : this.selected.add(x);
    } else if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.refreshSelection();
    this.onChange?.();
  }

  /** Stein unter dem Cursor umdrehen */
  flipAtCursor() {
    const id = this.cursorTile() ?? (this.selected.size === 1 ? [...this.selected][0] : null);
    if (id === null) return;
    if (this.flipped.has(id)) this.flipped.delete(id);
    else this.flipped.add(id);
    this.refreshSelection();
    sfx.tile();
  }

  /** Stein für Abwerfen/Bitirmek: genau ein markierter, sonst der unter dem Cursor */
  actionTile(): number | null {
    if (this.selected.size === 1) return [...this.selected][0];
    return this.cursorTile();
  }

  /** Auswahl ohne kompletten Neuaufbau aktualisieren */
  private refreshSelection() {
    this.el.querySelectorAll('.tile').forEach((el) => {
      const id = Number((el as HTMLElement).dataset.id);
      el.classList.toggle('sel', this.selected.has(id));
      el.classList.toggle('flipped', this.flipped.has(id));
    });
    sessionStorage.setItem('flipped', JSON.stringify([...this.flipped]));
  }

  /** Zusammenhängende Gruppe (Peri) um einen Stein */
  private groupOf(id: number): number[] {
    const i = this.slots.indexOf(id);
    const rowStart = Math.floor(i / COLS) * COLS;
    let a = i;
    let b = i;
    while (a > rowStart && this.slots[a - 1] !== null) a--;
    while (b < rowStart + COLS - 1 && this.slots[b + 1] !== null) b++;
    return this.slots.slice(a, b + 1) as number[];
  }

  private startDrag(e: PointerEvent, id: number, te: HTMLElement) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    // Wird ein markierter Stein gezogen, wandern alle markierten mit
    const group = this.selected.has(id) && this.selected.size > 1 ? this.orderedSelection() : [id];
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        moved = true;
        this.dragId = id;
        this.ghost = h('div', { class: 'dragghost', style: { display: 'flex', gap: '3px' } });
        for (const gid of group) {
          const src = this.el.querySelector(`.tile[data-id="${gid}"]`) as HTMLElement | null;
          if (src) {
            this.ghost.append(src.cloneNode(true));
            src.classList.add('dragging');
          }
        }
        document.body.append(this.ghost);
      }
      if (moved && this.ghost) {
        this.ghost.style.left = ev.clientX - 23 + 'px';
        this.ghost.style.top = ev.clientY - 32 + 'px';
        document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
        const target = this.targetAt(ev.clientX, ev.clientY);
        target?.classList.add('over');
        const canThrow = group.length === 1 && !!this.canDiscard?.();
        const zone = canThrow && !target ? this.zoneAt?.(ev.clientX, ev.clientY) ?? null : null;
        if (canThrow) this.onZoneHover?.(zone);
        this.ghost.classList.toggle('throw', zone === 'discard');
        this.ghost.classList.toggle('finishing', zone === 'finish');
      }
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
      if (!moved) {
        const now = performance.now();
        if (this.lastClick.id === id && now - this.lastClick.t < 450) {
          // Doppelklick: Stein umdrehen
          this.lastClick = { id: -1, t: 0 };
          if (this.flipped.has(id)) this.flipped.delete(id);
          else this.flipped.add(id);
          // der erste Klick hatte ausgewählt → wieder zurücknehmen
          if (this.selected.has(id)) this.selected.delete(id);
          else this.selected.add(id);
          this.refreshSelection();
          this.onChange?.();
          sfx.tile();
          return;
        }
        this.lastClick = { id, t: now };
        if (ev.shiftKey) {
          // Shift+Klick: ganze Peri auswählen
          const g = this.groupOf(id);
          const allSel = g.every((x) => this.selected.has(x));
          for (const x of g) allSel ? this.selected.delete(x) : this.selected.add(x);
        } else if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.refreshSelection();
        this.onChange?.();
        return;
      }
      this.ghost?.remove();
      this.ghost = null;
      this.dragId = null;
      const target = this.targetAt(ev.clientX, ev.clientY);
      if (target?.dataset.slot !== undefined) {
        if (group.length > 1) {
          this.moveGroup(group, Number(target.dataset.slot));
          // Aktion erledigt → Auswahl aufheben
          this.selected.clear();
          this.onChange?.();
        } else this.moveTo(id, Number(target.dataset.slot));
        sfx.tile();
      } else if (target?.dataset.zone) {
        this.onDropZone?.(target.dataset.zone, id);
      } else if (group.length === 1 && this.canDiscard?.()) {
        // rechts auf den eigenen Stapel = abwerfen, in die Mitte = beenden; sonst zurück
        const zone = this.zoneAt?.(ev.clientX, ev.clientY) ?? null;
        if (zone) this.onDropZone?.(zone, id);
      }
      this.onZoneHover?.(false);
      this.render();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  private orderedSelection(): number[] {
    return this.slots.filter((x): x is number => x !== null && this.selected.has(x));
  }

  /** Mehrere Steine zusammen an eine Stelle legen (Reihenfolge bleibt) */
  private moveGroup(ids: number[], target: number) {
    const n = ids.length;
    for (let i = 0; i < SLOTS; i++) if (this.slots[i] !== null && ids.includes(this.slots[i]!)) this.slots[i] = null;
    const rowStart = Math.floor(target / COLS) * COLS;
    let start = Math.min(target, rowStart + COLS - n);
    if (start < rowStart) start = rowStart;
    const displaced: number[] = [];
    for (let k = 0; k < n && start + k < SLOTS; k++) {
      const cur = this.slots[start + k];
      if (cur !== null) displaced.push(cur);
      this.slots[start + k] = ids[k];
    }
    // Verdrängte Steine: nächster freier Platz (gleiche Reihe zuerst)
    for (const d of displaced) {
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < SLOTS; i++) {
        if (this.slots[i] !== null) continue;
        const dist = Math.abs(i - start) + (Math.floor(i / COLS) === Math.floor(start / COLS) ? 0 : 50);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      if (best >= 0) this.slots[best] = d;
    }
  }

  private targetAt(x: number, y: number): HTMLElement | null {
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    for (const el of els) {
      if (el.closest('.dragghost')) continue;
      const slot = el.closest('.slot') as HTMLElement | null;
      if (slot && this.el.contains(slot)) return slot;
      const zone = el.closest('.zone') as HTMLElement | null;
      if (zone) return zone;
    }
    return null;
  }

  /** Stein auf Platz legen; ist er belegt, werden die Steine verschoben. */
  private moveTo(id: number, target: number) {
    const from = this.slots.indexOf(id);
    if (from === target) return;
    this.slots[from] = null;
    if (this.slots[target] === null) {
      this.slots[target] = id;
      return;
    }
    // nach rechts schieben bis zur nächsten Lücke in der Reihe, sonst nach links
    const rowStart = Math.floor(target / COLS) * COLS;
    const rowEnd = rowStart + COLS - 1;
    let gap = -1;
    for (let i = target; i <= rowEnd; i++) if (this.slots[i] === null) { gap = i; break; }
    if (gap >= 0) {
      for (let i = gap; i > target; i--) this.slots[i] = this.slots[i - 1];
    } else {
      for (let i = target; i >= rowStart; i--) if (this.slots[i] === null) { gap = i; break; }
      if (gap < 0) {
        this.slots[from] = id;
        return;
      }
      for (let i = gap; i < target; i++) this.slots[i] = this.slots[i + 1];
    }
    this.slots[target] = id;
  }

  /** Gruppen = zusammenhängende Steine (Lücken trennen) */
  groups(onlySelected: boolean): number[][] {
    const out: number[][] = [];
    for (let r = 0; r < 2; r++) {
      let cur: number[] = [];
      for (let c = 0; c < COLS; c++) {
        const id = this.slots[r * COLS + c];
        const ok = id !== null && (!onlySelected || this.selected.has(id));
        if (ok) cur.push(id!);
        else {
          if (cur.length) out.push(cur);
          cur = [];
        }
      }
      if (cur.length) out.push(cur);
    }
    return out;
  }

  /** Auto-Sortieren nach Reihen/Gruppen */
  sortRuns() {
    if (!this.okey) return;
    const okey = this.okey;
    const hand = [...this.tiles.values()];
    const { counts, wilds } = toCounts(hand, okey);
    const arr = arrange(counts, wilds, (c) => 10 + c.v, 0);
    const pool = [...hand];
    const take = (pred: (t: Tile) => boolean) => {
      const i = pool.findIndex(pred);
      return i >= 0 ? pool.splice(i, 1)[0] : null;
    };
    const cIdx = (t: Tile) => (t.fake ? COLORS.indexOf(okey.color) : COLORS.indexOf(t.color!));
    const val = (t: Tile) => (t.fake ? okey.value : t.value);
    const groups: Tile[][] = [];
    for (const m of arr.melds) {
      const g: Tile[] = [];
      for (const cell of m.cells) {
        const t = 'wild' in cell ? take((x) => isRealOkey(x, okey)) : take((x) => !isRealOkey(x, okey) && cIdx(x) === cell.real.c && val(x) === cell.real.v);
        if (t) g.push(t);
      }
      groups.push(g);
    }
    pool.sort((a, b) => (isRealOkey(a, okey) ? 1 : 0) - (isRealOkey(b, okey) ? 1 : 0) || cIdx(a) - cIdx(b) || val(a) - val(b));
    this.layout(groups, pool);
  }

  sortPairs() {
    if (!this.okey) return;
    const okey = this.okey;
    const hand = [...this.tiles.values()];
    const key = (t: Tile) => (t.fake ? `${okey.color}-${okey.value}` : `${t.color}-${t.value}`);
    const map = new Map<string, Tile[]>();
    const wild: Tile[] = [];
    for (const t of hand) {
      if (isRealOkey(t, okey)) wild.push(t);
      else map.set(key(t), [...(map.get(key(t)) ?? []), t]);
    }
    const pairs: Tile[][] = [];
    const singles: Tile[] = [];
    for (const list of map.values()) {
      while (list.length >= 2) pairs.push(list.splice(0, 2));
      singles.push(...list);
    }
    singles.sort((a, b) => key(a).localeCompare(key(b)));
    for (const w of wild) {
      const s = singles.shift();
      pairs.push(s ? [s, w] : [w]);
    }
    this.layout(pairs, singles);
  }

  private layout(groups: Tile[][], rest: Tile[]) {
    this.slots.fill(null);
    let pos = 0;
    const place = (g: Tile[]) => {
      const row = Math.floor(pos / COLS);
      if ((pos % COLS) + g.length > COLS && row === 0) pos = COLS;
      for (const t of g) if (pos < SLOTS) this.slots[pos++] = t.id;
      pos++;
    };
    for (const g of groups) place(g);
    if (pos < COLS) pos = COLS;
    for (const t of rest) {
      while (pos < SLOTS && this.slots[pos] !== null) pos++;
      if (pos < SLOTS) this.slots[pos++] = t.id;
      else {
        const free = this.slots.indexOf(null);
        this.slots[free] = t.id;
      }
    }
    this.selected.clear();
    this.render();
  }
}
