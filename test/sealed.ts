// Une enchère jouée d'un coup, sans horloge : chacun pose le doigt, ceux qui passent le lèvent pendant le compte à rebours,
// puis chacun lâche à sa mise, du plus court au plus long. Sert aux tests du moteur et à la simulation des bots.
import type { Game } from '../server/game';

export function sealedRound(g: Game, bids: Record<string, number | null>): void {
  for (const id of g.order) g.down(id);
  g.startCountdown();
  for (const id of g.order) if (bids[id] === null || bids[id] === undefined) g.up(id);
  g.startAuction();
  const holding = [...g.holding].sort((a, b) => (bids[a] ?? 0) - (bids[b] ?? 0));
  for (const id of holding) {
    const bid = bids[id]!;
    if (bid >= g.left(id)) g.pushOut(id);
    else g.release(id, bid);
  }
  g.close();
  g.next();
}
