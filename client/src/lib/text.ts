// Les mots de la table : noms, places, formats et durée d'une partie.
import { FORMATS, type Format, type RoomView } from '../../../shared/protocol';

export function nameOf(view: RoomView, id: string | undefined | null): string {
  if (!id) return '?';
  if (id === view.me) return 'toi';
  return view.players.find((p) => p.id === id)?.name ?? '?';
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « Léa, Zino et Sam ». */
export function listing(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** « 1re », « 2e ». */
export function placeLabel(n: number): string {
  return n === 1 ? '1re' : `${n}e`;
}

export const FORMAT_LABEL: Record<Format, string> = { court: 'Court', moyen: 'Moyen', emission: 'Émission' };

export function formatSub(f: Format): string {
  const { rounds, bank } = FORMATS[f];
  // Deux lignes : « 19 enchères » puis « 10 min », jamais un « min » orphelin.
  return `${rounds} enchères\n${Math.round(bank / 600)} min`;
}

/**
 * La durée d'une partie, mesurée sur des parties de bots : le temps des enchères gagnées fait à peu près
 * la moitié du temps de tout le monde, plus une douzaine de secondes par enchère pour se préparer et lire le résultat.
 */
export function durationLine(players: number, f: Format): string {
  const n = Math.max(2, players);
  const { rounds, bank } = FORMATS[f];
  const min = Math.round((bank / 600) * n * 0.5 + (rounds * 12) / 60);
  return `${rounds} enchères, ${Math.round(bank / 600)} minutes chacun : environ ${Math.max(5, Math.round(min / 5) * 5)} min de partie à ${n}.`;
}
