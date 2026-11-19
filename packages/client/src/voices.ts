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

let previewAudio: HTMLAudioElement | null = null;
/** Hörprobe im Charakter-Menü (eine läuft gleichzeitig) */
export function playPreview(id: string, volume = 1) {
  try {
    previewAudio?.pause();
    previewAudio = new Audio(voiceUrl(id, 'preview'));
    previewAudio.volume = Math.max(0, Math.min(1, volume));
    void previewAudio.play().catch(() => {});
  } catch {}
}
export function stopPreview() {
  previewAudio?.pause();
  previewAudio = null;
}
