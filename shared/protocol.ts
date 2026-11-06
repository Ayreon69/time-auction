// Contrat partagé entre le serveur et le client : formats de partie, vues de table, réglages et constantes.
// Les durées sont comptées en dixièmes de seconde, comme le tableau de l'émission.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** Un format : le nombre d'enchères et le temps de chacun. « emission » reprend l'épreuve : 19 enchères, 10 minutes. */
export const FORMATS = {
  court: { rounds: 9, bank: 1800 },
  moyen: { rounds: 13, bank: 3000 },
  emission: { rounds: 19, bank: 6000 },
} as const;
export type Format = keyof typeof FORMATS;
export const FORMAT_KEYS = Object.keys(FORMATS) as Format[];

/** Le compte à rebours avant que le temps ne file : lever le doigt pendant ce temps, c'est passer. */
export const COUNTDOWN_MS = 5_000;
/** Le temps laissé à chacun pour poser le doigt avant le compte à rebours. */
export const READY_MS = 15_000;
/** Le temps de lire le résultat d'une enchère. */
export const RESULT_MS = 4_800;

/** « 01:23.4 » */
export function clock(tenths: number): string {
  const t = Math.max(0, Math.floor(tenths));
  const m = Math.floor(t / 600);
  const s = Math.floor((t % 600) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${t % 10}`;
}

/** « 3 min », « 10 min » */
export function minutes(tenths: number): string {
  return `${Math.round(tenths / 600)} min`;
}

export const AVATARS = ['chrono', 'sablier', 'pendule', 'cloche', 'ampoule', 'lunette', 'aimant', 'engrenage', 'chapeau', 'diamant', 'hibou', 'tortue'] as const;
export const EMOTES = ['⏱️', '😬', '🔥', '🧊', '😈', '🤝'] as const;
export const TAUNTS = ['Je lâche !', 'Je tiens !', 'Bluff', 'On s’allie ?', 'Trop cher', 'Bien joué'] as const;

export type PlayerStatus = 'lobby' | 'playing' | 'spectator';

export interface Settings {
  format: Format;
}

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  autopilot: boolean;
  status: PlayerStatus;
  /** Parties gagnées à cette table. */
  wins: number;
  /** Sa place autour de la table (1 à 8), null hors partie. */
  seat: number | null;
  /** Ses jetons de victoire, visibles de tous comme dans l'émission ; null hors partie. */
  tokens: number | null;
  /** Pendant la préparation : son doigt est posé. Rien n'est dit ensuite, ni qui enchérit ni qui a lâché. */
  ready: boolean;
}

/**
 * ready : chacun pose le doigt sur son bouton.
 * countdown : cinq secondes ; lever le doigt, c'est passer.
 * auction : le temps file pour ceux qui tiennent ; le dernier à lâcher remporte le jeton.
 * result : le jeton est adjugé (ou perdu), avant l'enchère suivante.
 * over : la dernière enchère est jouée.
 */
export type Stage = 'ready' | 'countdown' | 'auction' | 'result' | 'over';

/** won : un seul a tenu le plus longtemps. tie : deux ou plus à égalité au dixième, le jeton est perdu. nobody : personne n'a enchéri. */
export type ResultKind = 'won' | 'tie' | 'nobody';

export interface ResultView {
  round: number;
  kind: ResultKind;
  winner: string | null;
  /** Le temps du tableau quand le dernier a lâché, en dixièmes. */
  time: number;
}

/** Ce que je sais de moi-même : mon doigt, et si mon bouton a été éjecté. Jamais mon temps restant. */
export interface MeView {
  /** Mon doigt est posé (pour le serveur). */
  holding: boolean;
  /** J'ai levé le doigt pendant le compte à rebours : je passe cette enchère. */
  passed: boolean;
  /** Je suis dans l'enchère en cours (doigt posé quand le temps a commencé à filer). */
  bidding: boolean;
  /** Mon temps s'est épuisé pendant cette enchère : le bouton m'a éjecté. */
  pushed: boolean;
  /** Mon bouton a déjà été éjecté une fois : il ne me reste plus rien. */
  spent: boolean;
}

export interface GameView {
  order: string[];
  stage: Stage;
  /** Enchère en cours, de 1 à rounds. */
  round: number;
  rounds: number;
  /** Le temps de départ de chacun, en dixièmes. */
  bank: number;
  /** Heure du serveur : fin de la préparation, du compte à rebours ou du résultat. */
  endsAt: number;
  /** Heure du serveur où le temps a commencé à filer (0 avant). */
  startedAt: number;
  /** Le résultat de l'enchère qui vient de se jouer (pendant result et over). Les précédents ne se lisent nulle part : on s'en souvient. */
  result: ResultView | null;
  me: MeView | null;
  /** Numéro de l'état : un geste envoyé pour une enchère déjà passée est ignoré. */
  seq: number;
}

/** Le grand dévoilement : qui a tenu combien de temps à chaque enchère. */
export interface RevealRound {
  round: number;
  kind: ResultKind;
  winner: string | null;
  time: number;
  /** Les enchères de chacun, en dixièmes ; un joueur absent de la liste a passé. */
  bids: { id: string; time: number; pushed: boolean }[];
}

export interface FinalPlayer {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  tokens: number;
  /** Son temps restant, enfin dévoilé. */
  left: number;
  place: number;
  wins: number;
  winner: boolean;
}

export interface FinalView {
  format: Format;
  rounds: number;
  bank: number;
  players: FinalPlayer[];
  history: RevealRound[];
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  me: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
  final: FinalView | null;
  serverNow: number;
}

export type Ack<T = unknown> = (res: { ok: boolean; error?: string; data?: T }) => void;

export function isFormat(x: unknown): x is Format {
  return typeof x === 'string' && x in FORMATS;
}

/** Une durée reçue du réseau, en dixièmes ; null si elle n'est pas lisible. */
export function parseTenths(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1e7 ? Math.floor(x) : null;
}
