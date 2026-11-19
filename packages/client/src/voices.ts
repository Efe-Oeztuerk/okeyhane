// Stimmen der Spielfiguren (mit ElevenLabs erstellt, als feste Dateien unter /voices/<id>/)
export type VoiceLine = 'pisti' | 'okey' | 'cay' | 'kola';

export interface VoiceDef {
  id: string;
  label: string;
  /** Sätze, die es für diese Stimme gibt (fehlt einer, kommt der normale Ton) */
  lines: VoiceLine[];
}

const ALL: VoiceLine[] = ['pisti', 'okey', 'cay', 'kola'];
export const VOICES: VoiceDef[] = [
  { id: 'kayseri', label: 'Kayserili · 50', lines: ALL },
  { id: 'karadeniz', label: 'Karadenizli uşak', lines: ALL },
  { id: 'genco', label: 'Genç · 20', lines: ALL },
  { id: 'abi', label: 'Abi · tok ses', lines: ['pisti', 'okey', 'kola'] },
  { id: 'koylu', label: 'Köylü · sert', lines: ALL },
  { id: 'teyze', label: 'Teyze', lines: ALL },
  { id: 'istanbullu', label: 'İstanbullu kız', lines: ALL },
];

export const voiceUrl = (id: string, line: VoiceLine | 'preview') => `/voices/${id}/${line}.mp3`;
export const hasLine = (id: string | undefined | null, line: VoiceLine) => !!id && !!VOICES.find((v) => v.id === id)?.lines.includes(line);

import { playFile } from './sound.ts';
let previewToken = 0;
/** Hörprobe im Charakter-Menü (eine neue ersetzt die alte nur logisch; Proben sind kurz) */
export function playPreview(id: string, volume = 1) {
  previewToken++;
  void playFile(voiceUrl(id, 'preview'), volume, 'volSfx');
}
export function stopPreview() {
  previewToken++;
}
