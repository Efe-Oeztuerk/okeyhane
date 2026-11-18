// Charakter-Editor mit 3D-Vorschau und Unterschrift

import type { Avatar } from '../../server/src/protocol.ts';
import { h } from './dom.ts';
import { t } from './i18n.ts';
import { World } from './scene.ts';
import { KITS } from './avatar.ts';
import { REAL_BASES, REAL_HAIR } from './realbody.ts';
import type { Profile } from './settings.ts';

type Opt = { key: keyof Avatar; values: string[]; labels: Record<string, string>; only?: 'm' | 'f' };
const OPTIONS: Opt[] = [
  { key: 'face', values: ['round', 'long', 'square'], labels: { round: 'Yuvarlak · Rund', long: 'Uzun · Lang', square: 'Köşeli · Eckig' } },
  { key: 'hair', values: ['none', 'short', 'curly', 'slick', 'long', 'bun', 'wavy'], labels: { none: 'Kel · Glatze', short: 'Kısa · Kurz', curly: 'Kıvırcık · Lockig', slick: 'Briyantinli · Gegelt', long: 'Uzun · Lang', bun: 'Topuz · Dutt', wavy: 'Dalgalı · Wellig' } },
  { key: 'scarf', values: ['none', 'basortu', 'tulbent', 'esarp'], labels: { none: 'Yok · Keins', basortu: 'Başörtüsü · Kopftuch', tulbent: 'Oyalı tülbent · Weißes Tuch mit Oya', esarp: 'Eşarp · Seidentuch' }, only: 'f' },
  { key: 'makeup', values: ['none', 'light', 'full'], labels: { none: 'Yok · Ohne', light: 'Hafif · Dezent', full: 'Tam · Voll' } },
  { key: 'eyebrows', values: ['thin', 'thick'], labels: { thin: 'İnce · Dünn', thick: 'Kalın · Dick' } },
  { key: 'beard', values: ['none', 'stubble', 'full'], labels: { none: 'Yok · Keiner', stubble: 'Kirli sakal · Stoppeln', full: 'Gür · Vollbart' }, only: 'm' },
  { key: 'mustache', values: ['none', 'classic', 'thick'], labels: { none: 'Yok · Keiner', classic: 'Klasik', thick: 'Pala · Dick' }, only: 'm' },
  { key: 'shirt', values: ['gomlek', 'takim', 'esofman', 'trikot', 'hirka', 'elbise', 'bluz', 'yelek'], labels: { gomlek: 'Gömlek · Hemd', takim: 'Takım · Anzug', esofman: 'Eşofman · Trainingsanzug', trikot: 'Forma · Trikot', hirka: 'Hırka · Strickjacke', elbise: 'Çiçekli elbise · Blumenkleid', bluz: 'Bluz · Bluse', yelek: 'Yelek · Weste' } },
  { key: 'hat', values: ['none', 'kasket', 'takke', 'bere'], labels: { none: 'Yok · Keine', kasket: 'Kasket', takke: 'Takke', bere: 'Bere · Mütze' } },
  { key: 'glasses', values: ['none', 'reading', 'sun'], labels: { none: 'Yok · Keine', reading: 'Okuma · Lesebrille', sun: 'Güneş · Sonnenbrille' } },
  { key: 'accessory', values: ['none', 'tespih', 'cigar', 'toothpick'], labels: { none: 'Yok · Nichts', tespih: 'Tespih', cigar: 'Puro · Zigarre', toothpick: 'Kürdan · Zahnstocher' } },
  { key: 'jewelry', values: ['none', 'chain', 'ring', 'watch', 'earrings', 'bilezik'], labels: { none: 'Yok · Nichts', chain: 'Kolye · Kette', ring: 'Yüzük · Ring', watch: 'Saat · Uhr', earrings: 'Küpe · Ohrringe', bilezik: 'Altın bilezik · Goldreifen' } },
  { key: 'shisha', values: ['classic', 'gold', 'crystal', 'ruby', 'emerald', 'black', 'saray', 'usta', 'sultan'], labels: { classic: 'Klasik', gold: 'Altın · Gold', crystal: 'Kristal', ruby: 'Yakut · Rubin', emerald: 'Zümrüt · Smaragd', black: 'Siyah · Schwarz', saray: '★ Saray', usta: '★ Usta', sultan: '★ Sultan' } },
];
const SCARF = ['#2f4f6f', '#7a3b2e', '#5a2d6a', '#2d5a3a', '#c9a04a', '#e8e2d4', '#1a1a1a', '#b5446e'];
const LIPS = ['#b8434e', '#9b2335', '#c2185b', '#a0522d', '#d4706f'];
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
    const chipRow = (label: string, items: [string, string][], cur: string, set: (v: string) => void) =>
      opts.append(
        h('label', {}, label),
        h(
          'div',
          { class: 'chips' },
          items.map(([v, l]) => h('div', { class: 'chip' + (cur === v ? ' on' : ''), onclick: () => (set(v), refresh()) }, l)),
        ),
      );
    const real = p.avatar.style === 'real';
    chipRow(
      'Stil · Tarz',
      [
        ['cartoon', '🎨 Cartoon'],
        ['real', '🧍 Realistisch · Gerçekçi'],
      ],
      real ? 'real' : 'cartoon',
      (v) => {
        p.avatar.style = v as any;
        if (v === 'real' && !p.avatar.realBase) Object.assign(p.avatar, { realBase: p.avatar.body === 'f' ? 'qf' : 'qm', realSkin: '#e6b896', realHair: p.avatar.body === 'f' ? 'long' : 'simpleparted', realBeard: p.avatar.beard !== 'none', pantsColor: '#3a342e' });
      },
    );
    if (real) {
      const base = REAL_BASES.find((b) => b.id === p.avatar.realBase) ?? REAL_BASES[0];
      chipRow(
        'Figur · Karakter',
        REAL_BASES.map((b) => [b.id, b.label]),
        base.id,
        (v) => {
          p.avatar.realBase = v;
          p.avatar.body = REAL_BASES.find((b) => b.id === v)?.fem ? 'f' : 'm';
        },
      );
      if (base.kind === 'q') {
        swatchRow('Hautton · Ten', 'realSkin', ['#f1cfb0', '#e6b896', '#d4a07a', '#b98058', '#9a6a45', '#7a4f32', '#5a3a24']);
        const hairs = base.fem ? ['long', 'buns', 'buzzedfemale', 'simpleparted', 'none'] : ['simpleparted', 'buzzed', 'long', 'none'];
        chipRow('Frisur · Saç', hairs.map((k) => [k, REAL_HAIR[k]]), p.avatar.realHair ?? hairs[0], (v) => (p.avatar.realHair = v));
        if (!base.fem)
          chipRow(
            'Bart · Sakal',
            [
              ['0', 'Ohne · Yok'],
              ['1', 'Vollbart · Sakal'],
            ],
            p.avatar.realBeard ? '1' : '0',
            (v) => (p.avatar.realBeard = v === '1'),
          );
        swatchRow(t('char_hairColor'), 'hairColor', HAIR);
        swatchRow(t('char_shirtColor'), 'shirtColor', CLOTH);
        swatchRow('Hose · Pantolon', 'pantsColor', ['#3a342e', '#1a1a1a', '#2f3e5c', '#5a4632', '#6b6b6b', '#e8e2d4', '#2d5a3a']);
      } else {
        opts.append(h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Diese Figur trägt feste Kleidung. · Bu karakterin kıyafeti sabit.'));
      }
      const sh = OPTIONS.find((o) => o.key === 'shisha')!;
      chipRow(t('char_shisha'), sh.values.map((v) => [v, sh.labels[v]]), p.avatar.shisha ?? 'classic', (v) => ((p.avatar as any).shisha = v));
      opts.append(
        h('label', {}, t('signature')),
        sig,
        h('div', { class: 'row' }, h('button', { class: 'small ghost', onclick: () => (g.clearRect(0, 0, 600, 160), (dirtySig = true)) }, t('clear'))),
      );
      return;
    }
    const fem = p.avatar.body === 'f';
    opts.append(
      h('label', {}, 'Tip · Typ'),
      h(
        'div',
        { class: 'chips' },
        (
          [
            ['m', 'Amca · Onkel'],
            ['f', 'Teyze · Tante'],
          ] as const
        ).map(([v, l]) =>
          h(
            'div',
            {
              class: 'chip' + ((p.avatar.body ?? 'm') === v ? ' on' : ''),
              onclick: () => {
                if ((p.avatar.body ?? 'm') === v) return;
                p.avatar.body = v;
                if (v === 'f') {
                  // passende Startwerte für eine Teyze
                  Object.assign(p.avatar, { beard: 'none', mustache: 'none', hat: 'none', hair: 'bun', scarf: 'basortu', scarfColor: p.avatar.scarfColor ?? '#2f4f6f', shirt: 'hirka', eyebrows: 'thin', makeup: 'light', jewelry: 'bilezik' });
                } else {
                  Object.assign(p.avatar, { scarf: 'none', makeup: 'none', hair: 'short', shirt: 'gomlek', mustache: 'classic', jewelry: 'none' });
                }
                refresh();
              },
            },
            l,
          ),
        ),
      ),
    );
    swatchRow(t('char_skin'), 'skin', SKINS);
    for (const o of OPTIONS) {
      if (o.only && o.only !== (fem ? 'f' : 'm')) continue;
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
      if (o.key === 'scarf' && p.avatar.scarf && p.avatar.scarf !== 'none' && p.avatar.scarf !== 'tulbent') swatchRow('Örtü rengi · Tuchfarbe', 'scarfColor', SCARF);
      if (o.key === 'makeup' && p.avatar.makeup && p.avatar.makeup !== 'none') swatchRow('Ruj · Lippenstift', 'lipColor', LIPS);
      if (o.key === 'shirt' && p.avatar.shirt === 'trikot') {
        opts.append(
          h('label', {}, 'Retro Forma · Retro-Trikot'),
          h(
            'div',
            { class: 'chips' },
            Object.entries(KITS).map(([k, kit]) =>
              h(
                'div',
                {
                  class: 'chip' + ((p.avatar.kit ?? 'duz') === k ? ' on' : ''),
                  onclick: () => {
                    p.avatar.kit = k as any;
                    refresh();
                  },
                },
                kit.label,
              ),
            ),
          ),
        );
      }
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
