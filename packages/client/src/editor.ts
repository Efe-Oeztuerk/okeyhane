// Charakter-Editor mit 3D-Vorschau und Unterschrift

import type { Avatar } from '../../server/src/protocol.ts';
import { h } from './dom.ts';
import { t } from './i18n.ts';
import { World } from './scene.ts';
import type { Profile } from './settings.ts';

const OPTIONS: { key: keyof Avatar; values: string[]; labels: Record<string, string> }[] = [
  { key: 'face', values: ['round', 'long', 'square'], labels: { round: 'Yuvarlak · Rund', long: 'Uzun · Lang', square: 'Köşeli · Eckig' } },
  { key: 'hair', values: ['none', 'short', 'curly', 'slick', 'long'], labels: { none: 'Kel · Glatze', short: 'Kısa · Kurz', curly: 'Kıvırcık · Lockig', slick: 'Briyantinli · Gegelt', long: 'Uzun · Lang' } },
  { key: 'eyebrows', values: ['thin', 'thick'], labels: { thin: 'İnce · Dünn', thick: 'Kalın · Dick' } },
  { key: 'beard', values: ['none', 'stubble', 'full'], labels: { none: 'Yok · Keiner', stubble: 'Kirli sakal · Stoppeln', full: 'Gür · Vollbart' } },
  { key: 'mustache', values: ['none', 'classic', 'thick'], labels: { none: 'Yok · Keiner', classic: 'Klasik', thick: 'Pala · Dick' } },
  { key: 'shirt', values: ['gomlek', 'takim', 'esofman', 'trikot', 'hirka'], labels: { gomlek: 'Gömlek · Hemd', takim: 'Takım · Anzug', esofman: 'Eşofman · Trainingsanzug', trikot: 'Forma · Trikot', hirka: 'Hırka · Strickjacke' } },
  { key: 'hat', values: ['none', 'kasket', 'takke', 'bere'], labels: { none: 'Yok · Keine', kasket: 'Kasket', takke: 'Takke', bere: 'Bere · Mütze' } },
  { key: 'glasses', values: ['none', 'reading', 'sun'], labels: { none: 'Yok · Keine', reading: 'Okuma · Lesebrille', sun: 'Güneş · Sonnenbrille' } },
  { key: 'accessory', values: ['none', 'tespih', 'cigar', 'toothpick'], labels: { none: 'Yok · Nichts', tespih: 'Tespih', cigar: 'Puro · Zigarre', toothpick: 'Kürdan · Zahnstocher' } },
  { key: 'jewelry', values: ['none', 'chain', 'ring', 'watch'], labels: { none: 'Yok · Nichts', chain: 'Kolye · Kette', ring: 'Yüzük · Ring', watch: 'Saat · Uhr' } },
];
const SKINS = ['#f3d2b3', '#e8b991', '#d9a77c', '#c48a5c', '#a26e4a', '#7a4f32', '#5a3a24'];
const HAIR = ['#1a1a1a', '#2b1d14', '#4a3020', '#7a5a3a', '#a8a8a8', '#e0e0e0', '#b5651d'];
const CLOTH = ['#7a3b2e', '#2f4f6f', '#2d5a3a', '#444444', '#e8e2d4', '#8e1b1b', '#d4a017', '#5a2d6a', '#1a3a8a', '#c0392b'];

export function openEditor(profile: Profile, onSave: (p: Profile) => void) {
  const p: Profile = JSON.parse(JSON.stringify(profile));
  const root = h('div', { class: 'editor' });
  const previewBox = h('div', { class: 'preview', style: { height: '100%' } });
  const opts = h('div', { class: 'opts' });
  const nameInput = h('input', { value: p.name, maxLength: 20, oninput: () => ((p.name = nameInput.value), refresh()) });

  const sig = h('canvas', { class: 'sigpad', width: 600, height: 160 }) as HTMLCanvasElement;
  const g = sig.getContext('2d')!;
  g.lineWidth = 3.2;
  g.lineCap = 'round';
  g.strokeStyle = '#1d2a6b';
  if (p.signature) {
    const img = new Image();
    img.onload = () => g.drawImage(img, 0, 0, 600, 160);
    img.src = p.signature;
  }
  let drawing = false;
  let dirtySig = false;
  const pos = (e: PointerEvent) => {
    const r = sig.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 600, ((e.clientY - r.top) / r.height) * 160];
  };
  sig.addEventListener('pointerdown', (e) => {
    drawing = true;
    dirtySig = true;
    const [x, y] = pos(e);
    g.beginPath();
    g.moveTo(x, y);
    sig.setPointerCapture(e.pointerId);
  });
  sig.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    g.lineTo(x, y);
    g.stroke();
  });
  sig.addEventListener('pointerup', () => (drawing = false));

  const preview = World.preview(previewBox, p.avatar, p.name);
  const refresh = () => {
    preview.update(p.avatar, p.name || '...');
    build();
  };

  function build() {
    opts.innerHTML = '';
    opts.append(h('label', {}, t('yourName')), nameInput);
    const swatchRow = (label: string, key: keyof Avatar, colors: string[]) => {
      opts.append(
        h('label', {}, label),
        h(
          'div',
          { class: 'swatches' },
          colors.map((c) =>
            h('div', {
              class: 'swatch' + ((p.avatar as any)[key] === c ? ' on' : ''),
              style: { background: c },
              onclick: () => {
                (p.avatar as any)[key] = c;
                refresh();
              },
            }),
          ),
          h('input', {
            type: 'color',
            value: (p.avatar as any)[key],
            onchange: (e: Event) => {
              (p.avatar as any)[key] = (e.target as HTMLInputElement).value;
              refresh();
            },
          }),
        ),
      );
    };
    swatchRow(t('char_skin'), 'skin', SKINS);
    for (const o of OPTIONS) {
      opts.append(
        h('label', {}, t('char_' + o.key)),
        h(
          'div',
          { class: 'chips' },
          o.values.map((v) =>
            h(
              'div',
              {
                class: 'chip' + ((p.avatar as any)[o.key] === v ? ' on' : ''),
                onclick: () => {
                  (p.avatar as any)[o.key] = v;
                  refresh();
                },
              },
              o.labels[v],
            ),
          ),
        ),
      );
      if (o.key === 'hair') swatchRow(t('char_hairColor'), 'hairColor', HAIR);
      if (o.key === 'shirt') swatchRow(t('char_shirtColor'), 'shirtColor', CLOTH);
    }
    opts.append(
      h('label', {}, t('signature')),
      sig,
      h('div', { class: 'row' }, h('button', { class: 'small ghost', onclick: () => (g.clearRect(0, 0, 600, 160), (dirtySig = true)) }, t('clear'))),
    );
  }
  build();

  const emoteRow = h(
    'div',
    { class: 'row', style: { marginTop: '8px' } },
    ['tea', 'nargile', 'slam', 'tespih'].map((k) => h('button', { class: 'small ghost', onclick: () => preview.emote(k) }, t('e_' + k))),
  );

  root.append(
    h(
      'div',
      { class: 'card panel' },
      h('div', { class: 'col' }, previewBox, emoteRow),
      h(
        'div',
        { class: 'col', style: { minHeight: 0 } },
        h('h2', {}, t('editChar')),
        opts,
        h(
          'div',
          { class: 'row', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'ghost', onclick: () => close() }, t('back')),
          h(
            'button',
            {
              class: 'primary',
              onclick: () => {
                if (dirtySig) {
                  const blank = !g.getImageData(0, 0, 600, 160).data.some((x, i) => i % 4 === 3 && x > 0);
                  p.signature = blank ? null : sig.toDataURL('image/png');
                }
                p.name = (p.name || '').trim() || 'Oyuncu';
                onSave(p);
                close();
              },
            },
            t('save'),
          ),
        ),
      ),
    ),
  );
  document.getElementById('ui')!.append(root);
  requestAnimationFrame(() => preview.resize());
  function close() {
    preview.dispose();
    root.remove();
  }
}
