// Gemeinsame Nachrichtentypen zwischen Client und Server.

export interface Avatar {
  /** Körperbau: m = Amca, f = Teyze */
  body?: 'm' | 'f';
  skin: string;
  face: 'round' | 'long' | 'square';
  hair: 'none' | 'short' | 'curly' | 'slick' | 'long' | 'bun' | 'wavy';
  hairColor: string;
  eyebrows: 'thin' | 'thick';
  beard: 'none' | 'stubble' | 'full';
  mustache: 'none' | 'classic' | 'thick';
  shirt: 'gomlek' | 'takim' | 'esofman' | 'trikot' | 'hirka' | 'elbise' | 'bluz' | 'yelek';
  shirtColor: string;
  hat: 'none' | 'kasket' | 'takke' | 'bere';
  /** Kopftuch */
  scarf?: 'none' | 'basortu' | 'tulbent' | 'esarp';
  scarfColor?: string;
  /** Schminke */
  makeup?: 'none' | 'light' | 'full';
  lipColor?: string;
  glasses: 'none' | 'reading' | 'sun';
  accessory: 'none' | 'tespih' | 'cigar' | 'toothpick';
  jewelry: 'none' | 'chain' | 'ring' | 'watch' | 'earrings' | 'bilezik';
  /** Retro-Trikot-Variante (nur bei shirt = trikot) */
  kit?: 'aYildiz' | 'sariKirmizi' | 'sariLacivert' | 'siyahBeyaz' | 'duz';
  /** eigene Nargile neben dem Stuhl */
  shisha?: 'classic' | 'gold' | 'crystal' | 'ruby' | 'emerald' | 'black' | 'saray' | 'usta' | 'sultan';
  /** 'real' = realistische Figur statt Cartoon */
  style?: 'cartoon' | 'real';
  /** realistische Figur: Basis (qm/qf oder Berufsfigur) */
  realBase?: string;
  /** Hautton: Farbe (#rrggbb) oder alt 'light'/'dark' */
  realSkin?: string;
  realHair?: string;
  realBeard?: boolean;
  pantsColor?: string;
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
