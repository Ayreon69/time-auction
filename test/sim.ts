// Simulation : les bots entre eux et contre des joueurs au hasard, pour juger leur niveau (npx tsx test/sim.ts 200 [joueurs] [format]).
import { FORMATS, isFormat, type Format } from '../shared/protocol';
import { SKILLS, botBid, type Skill } from '../server/bots';
import { Game } from '../server/game';
import { sealedRound } from './sealed';

const N = Number(process.argv[2] ?? 100);
const ONLY = process.argv[3] ? Number(process.argv[3]) : null;
const FORMAT: Format = isFormat(process.argv[4]) ? process.argv[4] : 'court';

const LEVELS: Record<string, Skill> = { ...SKILLS };

type Brain = Skill | 'random';

/** Un joueur au hasard : il enchérit une fois sur deux, d'un temps pris au hasard jusqu'à une fois et demie la part d'un jeton. */
function randomBid(g: Game, id: string): number | null {
  if (Math.random() < 0.5) return null;
  const share = (g.bankStart * g.order.length) / g.rounds;
  return Math.max(1, Math.min(g.left(id), Math.round(Math.random() * share * 1.5)));
}

function play(order: string[], brain: (id: string) => Brain): Game {
  const f = FORMATS[FORMAT];
  const g = new Game(order, f.rounds, f.bank);
  while (g.stage !== 'over') {
    const bids: Record<string, number | null> = {};
    for (const id of g.order) {
      const b = brain(id);
      bids[id] = b === 'random' ? randomBid(g, id) : botBid(g, id, b);
    }
    sealedRound(g, bids);
  }
  return g;
}

const counts = ONLY ? [ONLY] : [2, 3, 4, 5, 6, 7, 8];
for (const n of counts) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const names = Object.keys(LEVELS);
  const winsBy = new Map<string, number>();
  const seatsBy = new Map<string, number>();
  let wall = 0;
  let voids = 0;
  let spentAll = 0;
  for (let k = 0; k < N; k++) {
    const brains = new Map(ids.map((id, i) => [id, names[(i + k) % names.length]]));
    const g = play(ids, (id) => LEVELS[brains.get(id)!]);
    for (const l of brains.values()) seatsBy.set(l, (seatsBy.get(l) ?? 0) + 1);
    wall += g.history.reduce((a, h) => a + h.time, 0);
    voids += g.history.filter((h) => h.kind !== 'won').length;
    spentAll += g.order.filter((id) => g.left(id) === 0).length / n;
    for (const row of g.standings().filter((x) => x.place === 1)) {
      const label = brains.get(row.id)!;
      winsBy.set(label, (winsBy.get(label) ?? 0) + 1);
    }
  }
  // Un bot « habile » contre des joueurs qui enchérissent au hasard.
  let beat = 0;
  let last = 0;
  const M = Math.max(20, N);
  for (let k = 0; k < M; k++) {
    const me = ids[k % n];
    const g = play(ids, (id) => (id === me ? LEVELS.habile : 'random'));
    const rows = g.standings();
    if (rows.some((x) => x.id === me && x.place === 1)) beat++;
    if (rows.find((x) => x.id === me)!.place === Math.max(...rows.map((r) => r.place))) last++;
  }
  const f = FORMATS[FORMAT];
  // Par siège : la part des parties gagnées par un bot de ce niveau (au hasard : 1 sur n).
  const share = names.filter((l) => seatsBy.get(l)).map((l) => `${l} ${Math.round((100 * (winsBy.get(l) ?? 0)) / seatsBy.get(l)!)} %`).join(', ');
  console.log(
    `${n} joueurs, ${f.rounds} enchères de ${f.bank / 600} min : temps des enchères ${(wall / N / 600).toFixed(1)} min par partie, ` +
      `${(voids / N).toFixed(1)} jetons perdus ou sans preneur, ${Math.round((100 * spentAll) / N)} % finissent à sec. Victoires par bot : ${share}. ` +
      `Un bot « habile » contre le hasard gagne ${Math.round((100 * beat) / M)} % (au hasard : ${Math.round(100 / n)} %), dernier ${Math.round((100 * last) / M)} %.`,
  );
}
