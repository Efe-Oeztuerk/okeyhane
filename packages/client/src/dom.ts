// Kleine DOM-Hilfe

type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, any> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(text: string, color?: string) {
  const el = h('div', { class: 'toast', style: color ? { background: color } : {} }, text);
  document.getElementById('ui')!.append(el);
  setTimeout(() => el.remove(), 3300);
}
