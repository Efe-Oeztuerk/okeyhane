// Accounts + Freundschaften: liegen in Supabase (Postgres), Zugriff nur über abgesicherte RPC-Funktionen.
// Der Schlüssel ist der öffentliche "publishable key" – alle Funktionen verlangen ein Sitzungs-Token.
// OKEY_MOCK_DB=1 → In-Memory-Ersatz für lokale Tests ohne Internet.

import crypto from 'node:crypto';

const URL = process.env.SUPABASE_URL ?? 'https://viunjhdorlqhghebaatt.supabase.co';
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_xX-bDow8zqGAcY0FwqPJng_R69gX5AY';
const MOCK = process.env.OKEY_MOCK_DB === '1';

export interface UserRow {
  id: string;
  username: string;
  avatar: any;
}
export interface FriendRow {
  id: string;
  username: string;
  status: 'pending' | 'accepted';
  incoming: boolean;
}

export class AccountError extends Error {}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (MOCK) return mock(fn, args) as T;
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let key = 'server';
    try {
      const j = JSON.parse(text);
      if (/^[a-zA-Z]+$/.test(j.message ?? '')) key = j.message;
    } catch {}
    throw new AccountError(key);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export const accounts = {
  register: (username: string, password: string, avatar: unknown) =>
    rpc<{ token: string; user: UserRow }>('okey_register', { p_username: username, p_password: password, p_avatar: avatar ?? null }),
  login: (username: string, password: string) => rpc<{ token: string; user: UserRow }>('okey_login', { p_username: username, p_password: password }),
  me: (token: string) => rpc<UserRow>('okey_me', { p_token: token }),
  logout: (token: string) => rpc<void>('okey_logout', { p_token: token }),
  saveAvatar: (token: string, avatar: unknown) => rpc<void>('okey_save_avatar', { p_token: token, p_avatar: avatar }),
  friends: (token: string) => rpc<FriendRow[]>('okey_friends_list', { p_token: token }),
  request: (token: string, username: string) =>
    rpc<{ status: 'pending' | 'accepted'; id: string }>('okey_friend_request', { p_token: token, p_username: username }),
  respond: (token: string, user: string, accept: boolean) => rpc<void>('okey_friend_respond', { p_token: token, p_user: user, p_accept: accept }),
  remove: (token: string, user: string) => rpc<void>('okey_friend_remove', { p_token: token, p_user: user }),
  recordResult: (token: string, mode: string, won: boolean) => rpc<StatsMap>('okey_record_result', { p_token: token, p_mode: mode, p_won: won }),
  myStats: (token: string) => rpc<StatsMap>('okey_my_stats', { p_token: token }),
  leaderboard: (mode: string) => rpc<LeaderRow[]>('okey_leaderboard', { p_mode: mode }),
};
export type StatsMap = Record<string, { wins: number; losses: number; streak?: number; best?: number }>;
export interface LeaderRow {
  username: string;
  wins: number;
  losses: number;
  best: number;
  rate: number;
}

// ------------------------------------------------------------------ Mock (lokale Tests)

const mUsers = new Map<string, UserRow & { pass: string }>();
const mSessions = new Map<string, string>();
const mFriends = new Map<string, { status: 'pending' | 'accepted'; by: string }>();
const fkey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function uid(token: any) {
  const u = mSessions.get(String(token));
  if (!u) throw new AccountError('badSession');
  return u;
}
function byName(n: any) {
  return [...mUsers.values()].find((u) => u.username.toLowerCase() === String(n).trim().toLowerCase());
}
function session(id: string) {
  const t = crypto.randomBytes(16).toString('hex');
  mSessions.set(t, id);
  const u = mUsers.get(id)!;
  return { token: t, user: { id: u.id, username: u.username, avatar: u.avatar } };
}
const mStats = new Map<string, StatsMap>();
function mock(fn: string, a: Record<string, any>): unknown {
  switch (fn) {
    case 'okey_record_result': {
      const id = uid(a.p_token);
      const st = mStats.get(id) ?? {};
      const m = (st[a.p_mode] ??= { wins: 0, losses: 0, streak: 0, best: 0 });
      if (a.p_won) (m.wins++, (m.streak = (m.streak ?? 0) + 1), (m.best = Math.max(m.best ?? 0, m.streak)));
      else (m.losses++, (m.streak = 0));
      mStats.set(id, st);
      return st;
    }
    case 'okey_my_stats':
      return mStats.get(uid(a.p_token)) ?? {};
    case 'okey_leaderboard':
      return [...mStats.entries()]
        .map(([id, st]) => ({ username: mUsers.get(id)!.username, ...(st[a.p_mode] ?? { wins: 0, losses: 0, best: 0 }) }))
        .filter((r) => r.wins + r.losses > 0)
        .map((r) => ({ username: r.username, wins: r.wins, losses: r.losses, best: r.best ?? 0, rate: Math.round((100 * r.wins) / Math.max(1, r.wins + r.losses)) }))
        .sort((x, y) => y.wins - x.wins || y.rate - x.rate);
    case 'okey_register': {
      const name = String(a.p_username).trim();
      if (!/^[A-Za-z0-9_.ÇĞİÖŞÜçğıöşüÄäß-]{3,20}$/.test(name)) throw new AccountError('badName');
      if (String(a.p_password ?? '').length < 6) throw new AccountError('shortPassword');
      if (byName(name)) throw new AccountError('nameTaken');
      const id = crypto.randomUUID();
      mUsers.set(id, { id, username: name, avatar: a.p_avatar, pass: a.p_password });
      return session(id);
    }
    case 'okey_login': {
      const u = byName(a.p_username);
      if (!u || u.pass !== a.p_password) throw new AccountError('badLogin');
      return session(u.id);
    }
    case 'okey_me': {
      const u = mUsers.get(uid(a.p_token))!;
      return { id: u.id, username: u.username, avatar: u.avatar };
    }
    case 'okey_logout':
      mSessions.delete(a.p_token);
      return null;
    case 'okey_save_avatar':
      mUsers.get(uid(a.p_token))!.avatar = a.p_avatar;
      return null;
    case 'okey_friends_list': {
      const me = uid(a.p_token);
      const out: FriendRow[] = [];
      for (const [k, f] of mFriends) {
        const [x, y] = k.split('|');
        if (x !== me && y !== me) continue;
        const o = mUsers.get(x === me ? y : x)!;
        out.push({ id: o.id, username: o.username, status: f.status, incoming: f.status === 'pending' && f.by !== me });
      }
      return out;
    }
    case 'okey_friend_request': {
      const me = uid(a.p_token);
      const o = byName(a.p_username);
      if (!o) throw new AccountError('noUser');
      if (o.id === me) throw new AccountError('self');
      const k = fkey(me, o.id);
      const f = mFriends.get(k);
      if (!f) {
        mFriends.set(k, { status: 'pending', by: me });
        return { status: 'pending', id: o.id };
      }
      if (f.status === 'pending' && f.by === o.id) f.status = 'accepted';
      return { status: f.status, id: o.id };
    }
    case 'okey_friend_respond': {
      const me = uid(a.p_token);
      const k = fkey(me, a.p_user);
      const f = mFriends.get(k);
      if (f && f.status === 'pending' && f.by === a.p_user) {
        if (a.p_accept) f.status = 'accepted';
        else mFriends.delete(k);
      }
      return null;
    }
    case 'okey_friend_remove':
      mFriends.delete(fkey(uid(a.p_token), a.p_user));
      return null;
  }
  throw new AccountError('server');
}
