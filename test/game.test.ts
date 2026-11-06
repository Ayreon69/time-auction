// Tests du moteur : doigts posés, compte à rebours, enchère, jeton, égalité au dixième, temps épuisé, classement, et les bots.
import { describe, expect, it } from 'vitest';
import { FORMATS, clock } from '../shared/protocol';
import { AUTOPILOT, botBid, randomSkill, type Skill } from '../server/bots';
import { Game } from '../server/game';
import { sealedRound } from './sealed';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const HABILE: Skill = { level: 'habile', greed: 1.2, snipe: 0, forget: 0, counts: true };

describe('le tableau', () => {
  it('affiche les minutes, les secondes et les dixièmes', () => {
    expect(clock(0)).toBe('00:00.0');
    expect(clock(834)).toBe('01:23.4');
    expect(clock(6000)).toBe('10:00.0');
  });
  it('reprend l’émission dans son format le plus long : 19 enchères, 10 minutes', () => {
    expect(FORMATS.emission).toEqual({ rounds: 19, bank: 6000 });
  });
});

describe('une enchère', () => {
  it('donne le jeton au dernier à lâcher, et chacun paie le temps qu’il a tenu', () => {
    const g = new Game(ids(4), 9, 1800);
    sealedRound(g, { p0: 120, p1: 345, p2: null, p3: 200 });
    expect(g.history[0]).toMatchObject({ kind: 'won', winner: 'p1', time: 345 });
    expect(g.tokensOf('p1')).toBe(1);
    expect(g.left('p0')).toBe(1680);
    expect(g.left('p1')).toBe(1455);
    expect(g.left('p2')).toBe(1800);
    expect(g.left('p3')).toBe(1600);
    expect(g.round).toBe(2);
  });

  it('perd le jeton quand deux joueurs lâchent au même dixième', () => {
    const g = new Game(ids(3), 9, 1800);
    sealedRound(g, { p0: 300, p1: 300, p2: 100 });
    expect(g.history[0]).toMatchObject({ kind: 'tie', winner: null, time: 300 });
    expect([...g.tokens.values()].every((t) => t === 0)).toBe(true);
    expect(g.left('p2')).toBe(1700);
  });

  it('ne coûte rien quand personne n’enchérit', () => {
    const g = new Game(ids(3), 9, 1800);
    sealedRound(g, { p0: null, p1: null, p2: null });
    expect(g.history[0]).toMatchObject({ kind: 'nobody', winner: null, time: 0, bids: [] });
    expect(g.left('p0')).toBe(1800);
  });

  it('compte au moins un dixième à qui tenait quand le temps a filé', () => {
    const g = new Game(ids(2), 9, 1800);
    sealedRound(g, { p0: 0, p1: null });
    expect(g.history[0]).toMatchObject({ kind: 'won', winner: 'p0', time: 1 });
    expect(g.left('p0')).toBe(1799);
  });

  it('laisse passer pendant le compte à rebours, sans retour possible', () => {
    const g = new Game(ids(2), 9, 1800);
    g.down('p0');
    g.up('p0');
    expect(g.passed.has('p0')).toBe(false);
    g.down('p0');
    g.down('p1');
    g.startCountdown();
    g.up('p0');
    expect(g.passed.has('p0')).toBe(true);
    expect(g.down('p0')).toMatch(/passé/);
    g.startAuction();
    expect([...g.bidders]).toEqual(['p1']);
  });

  it('laisse passer sans payer celui dont le compte à rebours n’était pas fini chez lui', () => {
    const g = new Game(ids(2), 9, 1800);
    g.down('p0');
    g.down('p1');
    g.startCountdown();
    g.startAuction();
    g.withdraw('p0');
    g.release('p1', 50);
    g.close();
    expect(g.left('p0')).toBe(1800);
    expect(g.history[0].bids.map((b) => b.id)).toEqual(['p1']);
  });

  it('refuse un doigt posé pendant l’enchère', () => {
    const g = new Game(ids(2), 9, 1800);
    g.down('p0');
    g.startCountdown();
    g.startAuction();
    expect(g.down('p1')).toMatch(/commencé/);
    expect(g.down('zz')).toMatch(/place/);
  });
});

describe('le temps épuisé', () => {
  it('éjecte le bouton : la mise ne dépasse jamais le temps restant', () => {
    const g = new Game(ids(2), 9, 100);
    sealedRound(g, { p0: 250, p1: 40 });
    expect(g.history[0]).toMatchObject({ kind: 'won', winner: 'p0', time: 100 });
    expect(g.history[0].bids.find((b) => b.id === 'p0')?.pushed).toBe(true);
    expect(g.left('p0')).toBe(0);
    expect(g.spent.has('p0')).toBe(true);
  });

  it('éjecte d’emblée celui qui n’a plus rien : il ne peut plus enchérir', () => {
    const g = new Game(ids(2), 9, 100);
    sealedRound(g, { p0: 100, p1: null });
    for (const id of g.order) g.down(id);
    g.startCountdown();
    const out = g.startAuction();
    expect(out).toEqual(['p0']);
    expect(g.bidders.has('p0')).toBe(false);
    expect(g.pushed.has('p0')).toBe(true);
  });
});

describe('la fin', () => {
  it('arrive après la dernière enchère', () => {
    const g = new Game(ids(2), 3, 600);
    for (let i = 0; i < 3; i++) sealedRound(g, { p0: 10 + i, p1: null });
    expect(g.stage).toBe('over');
    expect(g.round).toBe(3);
    expect(g.history).toHaveLength(3);
  });

  it('classe au nombre de jetons, puis au temps restant, et partage une égalité parfaite', () => {
    const g = new Game(ids(4), 3, 600);
    sealedRound(g, { p0: 100, p1: 50, p2: null, p3: null });
    sealedRound(g, { p0: null, p1: 100, p2: 50, p3: null });
    sealedRound(g, { p0: null, p1: null, p2: null, p3: null });
    const rows = g.standings();
    // p0 et p1 ont un jeton chacun ; p1 a moins de temps (150 contre 100 dépensés).
    expect(rows.map((r) => r.id)).toEqual(['p0', 'p1', 'p3', 'p2']);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    const h = new Game(ids(2), 1, 600);
    sealedRound(h, { p0: null, p1: null });
    expect(h.standings().map((r) => r.place)).toEqual([1, 1]);
  });

  it('connaît le temps des enchères gagnées par chacun, public comme le tableau', () => {
    const g = new Game(ids(3), 9, 1800);
    sealedRound(g, { p0: 120, p1: 80, p2: null });
    sealedRound(g, { p0: null, p1: 300, p2: 299 });
    expect(g.wonTime('p0')).toBe(120);
    expect(g.wonTime('p1')).toBe(300);
    expect(g.wonTime('p2')).toBe(0);
  });
});

describe('les bots', () => {
  it('misent un temps qu’ils ont, ou passent', () => {
    for (let k = 0; k < 300; k++) {
      const g = new Game(ids(5), 9, 1800);
      for (let r = 0; r < 9; r++) {
        const bids: Record<string, number | null> = {};
        for (const id of g.order) {
          const b = botBid(g, id, randomSkill());
          if (b !== null) expect(b).toBeGreaterThanOrEqual(1);
          if (b !== null) expect(b).toBeLessThanOrEqual(g.left(id));
          bids[id] = b;
        }
        sealedRound(g, bids);
      }
      expect(g.stage).toBe('over');
    }
  });

  it('ne misent plus rien quand leur temps est épuisé', () => {
    const g = new Game(ids(3), 9, 100);
    sealedRound(g, { p0: 100, p1: null, p2: null });
    expect(botBid(g, 'p0', AUTOPILOT)).toBeNull();
  });

  it('gagnent à coup sûr quand personne ne peut plus tenir aussi longtemps', () => {
    const g = new Game(ids(3), 9, 600);
    // p1 et p2 ont gagné en tenant très longtemps : il leur reste au plus 50 dixièmes.
    sealedRound(g, { p0: null, p1: 550, p2: null });
    sealedRound(g, { p0: null, p1: null, p2: 550 });
    expect(botBid(g, 'p0', HABILE, () => 0)).toBe(51);
  });

  it('mettent tout à la dernière enchère quand ils sont à la traîne', () => {
    const g = new Game(ids(3), 3, 600);
    sealedRound(g, { p0: 50, p1: 100, p2: null });
    sealedRound(g, { p0: null, p1: null, p2: 10 });
    // À la dernière enchère, p0 n'a rien gagné : il met tout. p2 peut encore avoir 590, plus que ses 550 : pas de victoire certaine.
    expect(botBid(g, 'p0', HABILE, () => 0.9)).toBe(550);
    // Avec plus de temps que quiconque ne peut en avoir, il gagne à coup sûr pour moins que tout.
    const h = new Game(ids(3), 3, 600);
    sealedRound(h, { p0: null, p1: 100, p2: null });
    sealedRound(h, { p0: null, p1: null, p2: 590 });
    expect(botBid(h, 'p0', HABILE, () => 0.9)).toBe(501);
  });

  it('ne coûtent qu’un instant à décider', () => {
    const g = new Game(ids(8), 19, 6000);
    const t = performance.now();
    for (let i = 0; i < 1000; i++) botBid(g, 'p3', randomSkill());
    expect((performance.now() - t) / 1000).toBeLessThan(1);
  });
});
