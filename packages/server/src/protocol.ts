// Gemeinsame Nachrichtentypen zwischen Client und Server.

export interface Avatar {
  skin: string;
  face: 'round' | 'long' | 'square';
  hair: 'none' | 'short' | 'curly' | 'slick' | 'long';
  hairColor: string;
  eyebrows: 'thin' | 'thick';
  beard: 'none' | 'stubble' | 'full';
  mustache: 'none' | 'classic' | 'thick';
  shirt: 'gomlek' | 'takim' | 'esofman' | 'trikot' | 'hirka';
  shirtColor: string;
  hat: 'none' | 'kasket' | 'takke' | 'bere';
  glasses: 'none' | 'reading' | 'sun';
  accessory: 'none' | 'tespih' | 'cigar' | 'toothpick';
  jewelry: 'none' | 'chain' | 'ring' | 'watch';
  /** eigene Nargile neben dem Stuhl */
  shisha?: 'classic' | 'gold' | 'crystal' | 'ruby' | 'emerald' | 'black' | 'saray' | 'usta' | 'sultan';
}

export interface PlayerInfo {
  id: string;
  name: string;
  avatar: Avatar;
  signature: string | null;
  bot: boolean;
}

export type QuickKey =
  | 'hadi'
  | 'okeyBende'
  | 'caylar'
  | 'buElBizim'
  | 'yazik'
  | 'helal'
  | 'tesekkur'
  | 'gecmisOlsun';

export type EmoteKey = 'slam' | 'tea' | 'nargile' | 'headshake' | 'rubhands' | 'tespih';
export type EyeKey = 'wink' | 'blink' | 'wide';

export interface MediaState {
  /** YouTube-Video-ID oder Stream-URL */
  source: { kind: 'youtube'; id: string } | { kind: 'stream'; url: string } | null;
  playing: boolean;
  /** Position in Sekunden zum Zeitpunkt `at` */
  position: number;
  at: number;
  volume: number;
}
