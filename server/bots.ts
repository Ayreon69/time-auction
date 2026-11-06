// Les bots : ils décident, au moment où le temps commence à filer, s'ils enchérissent et jusqu'où ils tiendront.
// Ils ne savent que ce qu'un joueur saurait : leur propre temps (qu'un bot compte sans se tromper), les jetons de chacun
// et le temps des enchères gagnées, dont ils se souviennent plus ou moins bien. Jamais les mises des autres.
import type { Game } from './game';

export interface Skill {
  level: 'novice' | 'habile' | 'retors';
  /** Ce qu'il est prêt à payer par rapport au prix habituel d'un jeton. */
  greed: number;
  /** La chance de tenter une toute petite enchère, au cas où personne n'enchérirait. */
  snipe: number;
  /** L'imprécision de sa mémoire des temps gagnants (0 : parfaite). */
  forget: number;
  /** Il se sert des temps gagnants pour savoir quand personne ne peut plus le battre. */
  counts: boolean;
}

export const SKILLS: Record<Skill['level'], Skill> = {
  novice: { level: 'novice', greed: 1, snipe: 0.04, forget: 0.4, counts: false },
  habile: { level: 'habile', greed: 1.2, snipe: 0.1, forget: 0.1, counts: true },
  retors: { level: 'retors', greed: 1.3, snipe: 0.25, forget: 0.02, counts: true },
};

export const AUTOPILOT: Skill = { ...SKILLS.habile, snipe: 0.05 };

export function randomSkill(rand: () => number = Math.random): Skill {
  const r = rand();
  return r < 0.25 ? SKILLS.novice : r < 0.7 ? SKILLS.habile : SKILLS.retors;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** La mise du bot pour l'enchère qui commence, en dixièmes ; null : il passe. */
export function botBid(g: Game, id: string, skill: Skill, rand: () => number = Math.random): number | null {
  const n = g.order.length;
  const mine = g.left(id);
  if (mine <= 0) return null;
  const novice = skill.level === 'novice';
  const left = g.rounds - g.round + 1;
  const myTokens = g.tokensOf(id);
  const others = g.order.filter((x) => x !== id);
  const best = Math.max(...others.map((x) => g.tokensOf(x)));
  const worst = Math.min(...others.map((x) => g.tokensOf(x)));
  const fit = (t: number) => Math.max(1, Math.min(mine, Math.round(t)));

  // Ce que personne ne peut dépasser : le temps de départ, moins les enchères que chacun a gagnées sous nos yeux.
  const ceiling = Math.max(0, ...others.map((x) => g.bankStart - g.wonTime(x)));
  const sure = skill.counts && ceiling + 1 <= mine ? ceiling + 1 : null;

  // La dernière enchère : le temps restant ne sert plus qu'à départager.
  if (left === 1) {
    if (novice) return rand() < 0.7 ? fit(mine * (0.4 + rand() * 0.6)) : null;
    const ahead = myTokens - best;
    // Devant d'au moins un jeton : un rival qui gagne paierait cher pour une égalité qu'on départagerait au temps.
    if (ahead >= 1) return null;
    return sure ?? mine;
  }

  // Les jetons visés : sa part, et pour les meilleurs, de quoi rester devant le premier.
  const fair = g.rounds / n;
  const target = novice ? Math.round(fair) : Math.max(Math.ceil(fair), best + (skill.level === 'retors' ? 1 : 0));
  const need = Math.max(0, target - myTokens);
  const budget = mine / Math.max(1, need);

  // Une victoire certaine, à un prix qu'il peut se permettre.
  if (sure !== null && need > 0 && sure <= budget * 1.15) return sure;

  // Le prix d'un jeton : les derniers temps gagnants, tels qu'il s'en souvient.
  const won = g.history.filter((h) => h.kind === 'won').map((h) => h.time * (1 + (rand() * 2 - 1) * skill.forget));
  const price = won.length ? median(won.slice(-4)) : (g.bankStart * n * 0.4) / g.rounds;

  // Faut-il y aller ? D'autant plus qu'il manque de jetons et qu'il reste peu d'enchères ; et vite, s'il est dernier.
  let chance = need === 0 ? 0.1 : Math.min(1, (need / left) * 1.3);
  if (myTokens < worst && left <= Math.ceil(fair) + 1) chance = Math.max(chance, 0.75);
  if (novice) chance = Math.min(1, 0.15 + rand() * 0.5);
  if (rand() >= chance) return rand() < skill.snipe ? fit(1 + rand() * 12) : null;

  if (novice) return fit(price * (0.4 + rand() * 1.3));
  // Assez pour passer devant le prix habituel, sans dépasser ce que ses jetons manquants lui laissent.
  const beat = price * skill.greed * (1 + rand() * 0.3);
  return fit(Math.min(budget * (0.9 + rand() * 0.2), Math.max(beat, budget * 0.5)) + rand() * 6);
}
