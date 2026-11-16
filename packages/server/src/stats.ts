// Einfache Statistik: Siege/Niederlagen pro Spielername und Modus (JSON-Datei).
// Später durch Supabase ersetzbar.

import fs from 'node:fs';
import path from 'node:path';

type Entry = Record<string, { wins: number; losses: number }>;
const FILE = path.resolve(process.env.STATS_FILE ?? 'stats.json');
let data: Record<string, Entry> = {};

export function loadStats() {
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    data = {};
  }
}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data));
  } catch (e) {
    console.error('Statistik konnte nicht gespeichert werden', e);
  }
}

export function recordResult(name: string, mode: string, won: boolean) {
  const e = (data[name] ??= {});
  const m = (e[mode] ??= { wins: 0, losses: 0 });
  if (won) m.wins++;
  else m.losses++;
  save();
}

export function getStats(name: string): Entry {
  return data[name] ?? {};
}
