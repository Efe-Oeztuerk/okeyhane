// Account (Anmeldung), Freunde und Lobby-Liste

import { h, toast } from './dom.ts';
import { send, on } from './net.ts';
import { getLang } from './i18n.ts';

export interface Account {
  id: string;
  username: string;
  avatar: any;
}
export interface Friend {
  id: string;
  username: string;
  status: 'pending' | 'accepted';
  incoming: boolean;
  online: boolean;
  where: { code: string | null; isPublic: boolean; started: boolean; mode: string; free: number } | null;
}
export interface Lobby {
  code: string;
  mode: string;
  started: boolean;
  seats: ({ name: string; bot: boolean } | null)[];
  free: number;
  spectators: number;
  friends: string[];
}

const de = () => getLang() === 'de';
const L = (d: string, t: string) => (de() ? d : t);

let token: string | null = localStorage.getItem('okeyToken');
export let account: Account | null = null;
export let friends: Friend[] = [];
export let lobbies: Lobby[] = [];
export let onlineCount = 0;

type Deps = {
  modal: (...c: (HTMLElement | string)[]) => HTMLElement;
  join: (msg: any) => void;
  inTable: () => boolean;
  onAccount: (a: Account | null) => void;
  modeName: (m: string) => string;
};
let deps: Deps;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

const ERR: Record<string, [string, string]> = {
  badName: ['Name: 3–20 Zeichen, nur Buchstaben, Zahlen, _ . -', 'İsim: 3–20 karakter, harf, rakam, _ . -'],
  nameTaken: ['Der Name ist schon vergeben', 'Bu isim alınmış'],
  shortPassword: ['Passwort braucht mindestens 6 Zeichen', 'Şifre en az 6 karakter olmalı'],
  badLogin: ['Name oder Passwort falsch', 'İsim veya şifre yanlış'],
  badSession: ['Bitte neu anmelden', 'Lütfen tekrar giriş yap'],
  noUser: ['Diesen Spieler gibt es nicht', 'Böyle bir oyuncu yok'],
  self: ['Das bist du selbst 🙂', 'Bu sensin 🙂'],
  needLogin: ['Dafür musst du angemeldet sein', 'Bunun için giriş yapmalısın'],
  server: ['Server gerade nicht erreichbar', 'Sunucuya ulaşılamıyor'],
};
const errText = (k: string) => (ERR[k] ?? ERR.server)[de() ? 0 : 1];

export function initSocial(d: Deps) {
  deps = d;
  on('auth', (m) => {
    token = m.token;
    localStorage.setItem('okeyToken', m.token);
    account = m.user;
    deps.onAccount(account);
    changed();
  });
  on('loggedOut', () => {
    account = null;
    friends = [];
    deps.onAccount(null);
    changed();
  });
  on('authError', (m) => {
    if (m.key === 'badSession') {
      token = null;
      localStorage.removeItem('okeyToken');
      account = null;
      deps.onAccount(null);
    }
    if (m.for !== 'resume') toast(errText(m.key), '#7a2a1a');
    authErrorCb?.(errText(m.key));
    changed();
  });
  on('friendOk', (m) => toast(m.status === 'accepted' ? L(`Ihr seid jetzt Freunde mit ${m.name} 🤝`, `${m.name} ile artık arkadaşsınız 🤝`) : L(`Anfrage an ${m.name} geschickt`, `${m.name} kişisine istek gönderildi`), '#2d5a3a'));
  on('invited', (m) => toast(L(`${m.name} eingeladen`, `${m.name} davet edildi`), '#2d5a3a'));
  on('social', (m) => {
    const before = new Set(friends.filter((f) => f.incoming).map((f) => f.id));
    friends = m.friends;
    lobbies = m.lobbies;
    onlineCount = m.online;
    for (const f of friends) if (f.incoming && !before.has(f.id)) toast(L(`👥 Freundschaftsanfrage von ${f.username}`, `👥 ${f.username} arkadaşlık isteği gönderdi`), '#5a3a1d');
    changed();
  });
  on('invite', (m) => {
    const box = deps.modal(
      h('h2', {}, '📨 ' + L('Einladung', 'Davet')),
      h('p', {}, L(`${m.from} lädt dich an seinen Tisch ein (${deps.modeName(m.mode)}).`, `${m.from} seni masasına davet ediyor (${deps.modeName(m.mode)}).`)),
      h('button', { class: 'primary', onclick: () => (box.remove(), deps.join({ type: 'joinTable', code: m.code })) }, '🀄 ' + L('Hinsetzen', 'Otur')),
    );
  });
}

/** nach (Wieder-)Verbindung: gespeicherte Sitzung fortsetzen */
export function resume() {
  if (token) send({ type: 'resume', token });
}

export function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

let authErrorCb: ((t: string) => void) | null = null;

export function openAuth(startRegister = false) {
  let register = startRegister;
  const user = h('input', { placeholder: L('Benutzername', 'Kullanıcı adı'), maxLength: 20, autocomplete: 'username' });
  const pass = h('input', { type: 'password', placeholder: L('Passwort', 'Şifre'), autocomplete: 'current-password' });
  const err = h('div', { class: 'auth-err' });
  const title = h('h2', {});
  const submit = h('button', { class: 'primary' });
  const toggle = h('button', { class: 'ghost small' });
  const paint = () => {
    title.textContent = register ? '✨ ' + L('Account erstellen', 'Hesap oluştur') : '👤 ' + L('Anmelden', 'Giriş yap');
    submit.textContent = register ? L('Registrieren', 'Kayıt ol') : L('Anmelden', 'Giriş yap');
    toggle.textContent = register ? L('Schon einen Account? Anmelden', 'Hesabın var mı? Giriş yap') : L('Neu hier? Account erstellen', 'Yeni misin? Hesap oluştur');
    pass.autocomplete = register ? 'new-password' : 'current-password';
    err.textContent = '';
  };
  const go = () => {
    err.textContent = '';
    submit.disabled = true;
    send({ type: register ? 'register' : 'login', username: user.value.trim(), password: pass.value });
  };
  submit.onclick = go;
  toggle.onclick = () => ((register = !register), paint());
  pass.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && (e.stopPropagation(), e.preventDefault(), go()));
  user.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && (e.stopPropagation(), e.preventDefault(), pass.focus()));
  paint();
  const box = deps.modal(
    title,
    h('div', { class: 'muted' }, L('Mit Account kannst du Freunde hinzufügen und sehen, wo sie gerade spielen. Kein E-Mail nötig.', 'Hesapla arkadaş ekleyebilir ve nerede oynadıklarını görebilirsin. E-posta gerekmez.')),
    h('div', { class: 'col', style: { gap: '8px', marginTop: '10px' } }, user, pass, err, submit, toggle),
  );
  authErrorCb = (t) => {
    err.textContent = t;
    submit.disabled = false;
  };
  const off = subscribe(() => {
    if (account) {
      off();
      authErrorCb = null;
      box.remove();
      toast(L(`Willkommen, ${account.username}!`, `Hoş geldin, ${account.username}!`), '#2d5a3a');
    }
  });
  setTimeout(() => user.focus(), 50);
}

export function logout() {
  send({ type: 'logout' });
  token = null;
  localStorage.removeItem('okeyToken');
}

export function pendingCount() {
  return friends.filter((f) => f.incoming).length;
}

function whereText(f: Friend) {
  if (!f.online) return L('offline', 'çevrimdışı');
  if (!f.where) return L('online · im Menü', 'çevrimiçi · menüde');
  const w = f.where;
  const mode = deps.modeName(w.mode);
  if (!w.isPublic) return L(`an einem privaten Tisch · ${mode}`, `özel bir masada · ${mode}`);
  return w.started ? L(`spielt ${mode} · ${w.code}`, `${mode} oynuyor · ${w.code}`) : L(`wartet an ${w.code} · ${w.free} frei`, `${w.code} masasında bekliyor · ${w.free} boş`);
}

export function openFriends() {
  if (!account) return openAuth();
  const input = h('input', { placeholder: L('Benutzername', 'Kullanıcı adı'), maxLength: 20 });
  const add = () => {
    if (!input.value.trim()) return;
    send({ type: 'friendRequest', username: input.value.trim() });
    input.value = '';
  };
  input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && (e.stopPropagation(), e.preventDefault(), add()));
  const list = h('div', { class: 'friendlist' });
  const paint = () => {
    list.innerHTML = '';
    const inc = friends.filter((f) => f.incoming);
    const out = friends.filter((f) => f.status === 'pending' && !f.incoming);
    const acc = friends.filter((f) => f.status === 'accepted').sort((a, b) => Number(b.online) - Number(a.online) || Number(!!b.where) - Number(!!a.where));
    if (inc.length) list.append(h('div', { class: 'fl-head' }, L('Anfragen', 'İstekler')));
    for (const f of inc)
      list.append(
        h(
          'div',
          { class: 'fl-row' },
          h('span', {}, '👋 ' + f.username),
          h(
            'span',
            { class: 'row', style: { gap: '4px' } },
            h('button', { class: 'small primary', onclick: () => send({ type: 'friendRespond', id: f.id, accept: true }) }, '✓ ' + L('Annehmen', 'Kabul')),
            h('button', { class: 'small ghost', onclick: () => send({ type: 'friendRespond', id: f.id, accept: false }) }, '✕'),
          ),
        ),
      );
    list.append(h('div', { class: 'fl-head' }, L(`Freunde (${acc.length})`, `Arkadaşlar (${acc.length})`)));
    if (!acc.length) list.append(h('div', { class: 'muted' }, L('Noch keine Freunde – füg oben jemanden über den Benutzernamen hinzu.', 'Henüz arkadaş yok – yukarıdan kullanıcı adıyla ekle.')));
    for (const f of acc) {
      const w = f.where;
      list.append(
        h(
          'div',
          { class: 'fl-row' + (f.online ? '' : ' off') },
          h('span', { class: 'col', style: { gap: '0' } }, h('b', {}, (f.online ? '🟢 ' : '⚪ ') + f.username), h('small', { class: 'muted' }, whereText(f))),
          h(
            'span',
            { class: 'row', style: { gap: '4px' } },
            w && w.code ? h('button', { class: 'small primary', onclick: () => (closeAll(), deps.join({ type: 'joinTable', code: w.code, spectate: w.started || w.free === 0 })) }, w.started || w.free === 0 ? '👁 ' + L('Zuschauen', 'İzle') : '🀄 ' + L('Dazusetzen', 'Katıl')) : null,
            f.online && deps.inTable() ? h('button', { class: 'small', onclick: () => send({ type: 'invite', userId: f.id }) }, '📨 ' + L('Einladen', 'Davet')) : null,
            h('button', { class: 'small ghost', title: L('Entfernen', 'Kaldır'), onclick: () => confirm(L(`${f.username} entfernen?`, `${f.username} kaldırılsın mı?`)) && send({ type: 'friendRemove', id: f.id }) }, '🗑'),
          ),
        ),
      );
    }
    if (out.length) {
      list.append(h('div', { class: 'fl-head' }, L('Gesendet', 'Gönderilen')));
      for (const f of out) list.append(h('div', { class: 'fl-row off' }, h('span', {}, '⏳ ' + f.username), h('button', { class: 'small ghost', onclick: () => send({ type: 'friendRemove', id: f.id }) }, L('Zurückziehen', 'Geri al'))));
    }
  };
  paint();
  const box = deps.modal(
    h('h2', {}, '👥 ' + L('Freunde', 'Arkadaşlar')),
    h('div', { class: 'muted' }, L(`Du bist ${account.username}. Freunde finden dich über diesen Namen.`, `Sen ${account.username}. Arkadaşların seni bu isimle bulur.`)),
    h('div', { class: 'row', style: { flexWrap: 'nowrap', margin: '8px 0' } }, input, h('button', { class: 'primary', onclick: add }, '➕ ' + L('Hinzufügen', 'Ekle'))),
    list,
  );
  const off = subscribe(paint);
  const closeAll = () => box.remove();
  new MutationObserver((_, o) => {
    if (!box.isConnected) {
      off();
      o.disconnect();
    }
  }).observe(box.parentElement!, { childList: true });
  send({ type: 'lobbies' });
}

export function openLobbies() {
  const list = h('div', { class: 'lobbylist' });
  const head = h('div', { class: 'muted' });
  const paint = () => {
    list.innerHTML = '';
    head.textContent = L(`${onlineCount} Spieler online · ${lobbies.length} öffentliche Tische`, `${onlineCount} oyuncu çevrimiçi · ${lobbies.length} açık masa`);
    if (!lobbies.length) list.append(h('div', { class: 'muted', style: { padding: '14px 0' } }, L('Gerade kein öffentlicher Tisch offen – mach einen auf!', 'Şu an açık masa yok – bir tane kur!')));
    for (const lb of lobbies) {
      const full = lb.free === 0 || lb.started;
      list.append(
        h(
          'div',
          { class: 'lb-row' + (lb.friends.length ? ' friend' : '') },
          h(
            'div',
            { class: 'col', style: { gap: '2px' } },
            h('b', {}, `${deps.modeName(lb.mode)} · ${lb.code}` + (lb.started ? L(' · läuft', ' · oynanıyor') : '')),
            lb.friends.length ? h('small', { class: 'lb-friends' }, '👥 ' + lb.friends.join(', ') + L(' ist hier', ' burada')) : null,
            h('small', { class: 'muted' }, lb.seats.map((s) => (s ? (s.bot ? '🤖 ' : '') + s.name : '·')).join('  ')),
          ),
          h(
            'button',
            { class: 'small ' + (full ? 'ghost' : 'primary'), onclick: () => (box.remove(), deps.join({ type: 'joinTable', code: lb.code, spectate: full })) },
            full ? '👁 ' + L('Zuschauen', 'İzle') : `🀄 ${L('Setzen', 'Otur')} (${lb.free})`,
          ),
        ),
      );
    }
  };
  paint();
  const box = deps.modal(
    h('h2', {}, '🌐 ' + L('Offene Tische', 'Açık masalar')),
    head,
    list,
    h(
      'div',
      { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'primary', onclick: () => (box.remove(), deps.join({ type: 'findPublic' })) }, '🎲 ' + L('Schnell beitreten', 'Hızlı katıl')),
      h('button', { onclick: () => (box.remove(), deps.join({ type: 'createTable', isPublic: true })) }, '➕ ' + L('Öffentlichen Tisch erstellen', 'Açık masa kur')),
    ),
    h('div', { class: 'muted', style: { marginTop: '8px', fontSize: '12px' } }, L('Private Tische erscheinen hier nicht – dort kommt man nur per Code oder Einladung rein.', 'Özel masalar burada görünmez – onlara sadece kod veya davetle girilir.')),
  );
  const off = subscribe(paint);
  new MutationObserver((_, o) => {
    if (!box.isConnected) {
      off();
      o.disconnect();
    }
  }).observe(box.parentElement!, { childList: true });
  send({ type: 'lobbies' });
}
