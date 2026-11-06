// Moteur de Time Auction, sans réseau ni horloge : les doigts posés, le compte à rebours, l'enchère, le jeton et le classement.
// Toutes les durées sont en dixièmes de seconde. C'est la table (room.ts) qui mesure le temps et appelle ces étapes.
import crypto from 'node:crypto';
import type { ResultKind, ResultView, RevealRound, Stage } from '../shared/protocol';

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Standing {
  id: string;
  tokens: number;
  left: number;
  place: number;
}

export class Game {
  readonly order: string[];
  readonly rounds: number;
  /** Le temps de départ de chacun. */
  readonly bankStart: number;
  stage: Stage = 'ready';
  round = 1;
  seq = 0;
  /** Le temps restant de chacun : personne ne le voit, pas même son propriétaire. */
  readonly bank = new Map<string, number>();
  readonly tokens = new Map<string, number>();
  /** Les doigts posés : pendant la préparation et le compte à rebours, tous ceux qui appuient ; pendant l'enchère, ceux qui tiennent encore. */
  readonly holding = new Set<string>();
  /** Ceux qui ont levé le doigt pendant le compte à rebours : ils passent cette enchère. */
  readonly passed = new Set<string>();
  /** Ceux qui tenaient quand le temps a commencé à filer. */
  readonly bidders = new Set<string>();
  /** Le temps tenu par chacun, une fois le doigt levé. */
  readonly bids = new Map<string, number>();
  /** Ceux dont le bouton a été éjecté cette enchère, faute de temps. */
  readonly pushed = new Set<string>();
  /** Ceux dont le temps est épuisé, et qui le savent. */
  readonly spent = new Set<string>();
  result: ResultView | null = null;
  readonly history: RevealRound[] = [];

  constructor(order: string[], rounds: number, bank: number) {
    this.order = [...order];
    this.rounds = rounds;
    this.bankStart = bank;
    for (const id of order) {
      this.bank.set(id, bank);
      this.tokens.set(id, 0);
    }
  }

  has(id: string): boolean {
    return this.order.includes(id);
  }

  left(id: string): number {
    return this.bank.get(id) ?? 0;
  }

  tokensOf(id: string): number {
    return this.tokens.get(id) ?? 0;
  }

  /** Le doigt se pose : pendant la préparation, ou pendant le compte à rebours si l'on n'a pas encore passé. */
  down(id: string): string | undefined {
    if (!this.has(id)) return "Tu n'as pas de place à cette table.";
    if (this.stage !== 'ready' && this.stage !== 'countdown') return "L'enchère a déjà commencé.";
    if (this.passed.has(id)) return 'Tu as passé cette enchère.';
    if (this.holding.has(id)) return undefined;
    this.holding.add(id);
    this.seq++;
    return undefined;
  }

  /** Le doigt se lève avant que le temps ne file : pendant le compte à rebours, c'est passer. */
  up(id: string): void {
    if (this.stage !== 'ready' && this.stage !== 'countdown') return;
    if (!this.holding.delete(id)) return;
    if (this.stage === 'countdown') this.passed.add(id);
    this.seq++;
  }

  /** Tout le monde attendu a le doigt posé. */
  allHolding(ids: string[]): boolean {
    return ids.every((id) => this.holding.has(id));
  }

  startCountdown(): void {
    if (this.stage !== 'ready') return;
    this.stage = 'countdown';
    this.seq++;
  }

  /**
   * Le temps commence à filer pour ceux qui tiennent. Un joueur qui n'a plus de temps est éjecté sur-le-champ :
   * il l'apprend, mais il n'enchérit pas. Renvoie les éjectés.
   */
  startAuction(): string[] {
    if (this.stage !== 'countdown') return [];
    this.stage = 'auction';
    const out: string[] = [];
    for (const id of [...this.holding]) {
      if (this.left(id) > 0) {
        this.bidders.add(id);
        continue;
      }
      this.holding.delete(id);
      this.pushed.add(id);
      this.spent.add(id);
      out.push(id);
    }
    this.seq++;
    return out;
  }

  /** Un joueur dont le compte à rebours n'était pas fini chez lui quand il a levé le doigt : il passe, sans rien payer. */
  withdraw(id: string): void {
    if (this.stage !== 'auction' || !this.holding.has(id)) return;
    this.holding.delete(id);
    this.bidders.delete(id);
    this.passed.add(id);
    this.seq++;
  }

  /**
   * Le doigt se lève pendant l'enchère : le temps tenu est la mise, d'au moins un dixième, jamais plus que le temps restant.
   * Renvoie la mise retenue.
   */
  release(id: string, tenths: number): number | null {
    if (this.stage !== 'auction' || !this.holding.has(id)) return null;
    const bank = this.left(id);
    const bid = Math.min(bank, Math.max(1, Math.floor(tenths)));
    this.holding.delete(id);
    this.bids.set(id, bid);
    if (bid >= bank) {
      // Tout le temps y est passé : le bouton saute.
      this.pushed.add(id);
      this.spent.add(id);
    }
    this.seq++;
    return bid;
  }

  /** Le temps restant est épuisé alors que le doigt tient encore : le bouton est éjecté. */
  pushOut(id: string): void {
    this.release(id, this.left(id));
  }

  /** Plus personne ne tient : chacun paie son temps, le plus long gagne le jeton, sauf égalité au dixième. */
  close(): ResultView | null {
    if (this.stage !== 'auction' || this.holding.size > 0) return null;
    let kind: ResultKind = 'nobody';
    let winner: string | null = null;
    let time = 0;
    if (this.bids.size > 0) {
      time = Math.max(...this.bids.values());
      const top = [...this.bids].filter(([, b]) => b === time).map(([id]) => id);
      if (top.length === 1) {
        kind = 'won';
        winner = top[0];
        this.tokens.set(winner, this.tokensOf(winner) + 1);
      } else kind = 'tie';
    }
    for (const [id, b] of this.bids) this.bank.set(id, Math.max(0, this.left(id) - b));
    this.result = { round: this.round, kind, winner, time };
    this.history.push({
      round: this.round,
      kind,
      winner,
      time,
      bids: this.order.filter((id) => this.bids.has(id)).map((id) => ({ id, time: this.bids.get(id)!, pushed: this.pushed.has(id) })),
    });
    this.stage = 'result';
    this.seq++;
    return this.result;
  }

  /** L'enchère suivante, ou la fin. */
  next(): void {
    if (this.stage !== 'result') return;
    this.holding.clear();
    this.passed.clear();
    this.bidders.clear();
    this.bids.clear();
    this.pushed.clear();
    if (this.round >= this.rounds) this.stage = 'over';
    else {
      this.round++;
      this.stage = 'ready';
      this.result = null;
    }
    this.seq++;
  }

  /** Le plus de jetons, puis le plus de temps restant ; à égalité parfaite, la place est partagée. */
  standings(): Standing[] {
    const rows = this.order.map((id) => ({ id, tokens: this.tokensOf(id), left: this.left(id), place: 0 }));
    rows.sort((a, b) => b.tokens - a.tokens || b.left - a.left);
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.place = prev && prev.tokens === r.tokens && prev.left === r.left ? prev.place : i + 1;
    });
    return rows;
  }

  /** Le temps tenu par les gagnants de chacun, connu de tous : le temps restant d'un joueur ne peut pas dépasser le départ moins ces victoires. */
  wonTime(id: string): number {
    return this.history.reduce((a, h) => a + (h.winner === id ? h.time : 0), 0);
  }
}
