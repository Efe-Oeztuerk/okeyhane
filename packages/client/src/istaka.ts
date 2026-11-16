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
  onDoubleClick: ((id: number) => void) | null = null;
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
    this.tiles = new Map(hand.map((t) => [t.id, t]));
    const placed = new Set(this.slots.filter((x) => x !== null));
    const fresh = hand.filter((t) => !placed.has(t.id));
    const isNewHand = placed.size === 0;
    if (isNewHand) {
      this.slots.fill(null);
      fresh.forEach((t, i) => (this.slots[i] = t.id));
    } else {
      for (const t of fresh) {
        // neuer Stein: hinten in der unteren Reihe, sonst erster freier Platz
        let i = -1;
        for (let k = SLOTS - 1; k >= COLS; k--) if (this.slots[k] === null) { i = k; break; }
        if (i < 0) i = this.slots.indexOf(null);
        this.slots[i] = t.id;
        this.justAdded.add(t.id);
      }
    }
    this.render();
  }

  clear() {
    this.slots.fill(null);
    this.tiles.clear();
    this.selected.clear();
    this.render();
  }

  private persist() {
    sessionStorage.setItem('istaka', JSON.stringify(this.slots));
  }

  render() {
    this.persist();
    this.el.innerHTML = '';
    for (let r = 0; r < 2; r++) {
      const row = h('div', { class: 'rowslots' });
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const slot = h('div', { class: 'slot' });
        slot.dataset.slot = String(idx);
        const id = this.slots[idx];
        if (id !== null) {
          const tile = this.tiles.get(id);
          if (tile) {
            const te = tileElement(tile, this.okey ?? undefined);
            if (this.selected.has(id)) te.classList.add('sel');
            if (this.justAdded.has(id)) te.classList.add('new');
            te.addEventListener('pointerdown', (e) => this.startDrag(e, id, te));
            te.addEventListener('dblclick', () => this.onDoubleClick?.(id));
            slot.append(te);
          }
        }
        row.append(slot);
      }
      this.el.append(row);
    }
  }

  private startDrag(e: PointerEvent, id: number, te: HTMLElement) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
        moved = true;
        this.dragId = id;
        this.ghost = te.cloneNode(true) as HTMLElement;
        this.ghost.classList.add('dragghost');
        document.body.append(this.ghost);
        te.classList.add('dragging');
      }
      if (moved && this.ghost) {
        this.ghost.style.left = ev.clientX - 23 + 'px';
        this.ghost.style.top = ev.clientY - 32 + 'px';
        document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
        const target = this.targetAt(ev.clientX, ev.clientY);
        target?.classList.add('over');
      }
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
      if (!moved) {
        // Klick = auswählen
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.render();
        this.onChange?.();
        return;
      }
      this.ghost?.remove();
      this.ghost = null;
      this.dragId = null;
      const target = this.targetAt(ev.clientX, ev.clientY);
      if (target?.dataset.slot !== undefined) {
        this.moveTo(id, Number(target.dataset.slot));
        sfx.tile();
      } else if (target?.dataset.zone) {
        this.onDropZone?.(target.dataset.zone, id);
      }
      this.render();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  private targetAt(x: number, y: number): HTMLElement | null {
    const els = document.elementsFromPoint(x, y) as HTMLElement[];
    for (const el of els) {
      if (el.classList.contains('dragghost')) continue;
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
