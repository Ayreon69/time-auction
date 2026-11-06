// Une table de Time Auction : salon, partie, horloge des enchères, bots, pilote automatique et vue de chacun.
// Chaque téléphone mesure lui-même le temps tenu, pour que la latence ne compte pas ; le serveur vérifie que la durée annoncée
// colle à ce qu'il a vu, éjecte un bouton dont le temps est épuisé et désigne le gagnant.
import crypto from 'node:crypto';
import {
  AVATARS,
  COUNTDOWN_MS,
  FORMATS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  READY_MS,
  RESULT_MS,
  isFormat,
  parseTenths,
  type FinalView,
  type GameView,
  type PlayerStatus,
  type RoomView,
  type Settings,
  type Stage,
} from '../shared/protocol';
import { AUTOPILOT, botBid, randomSkill, type Skill } from './bots';
import { Game, shuffle } from './game';

const BOT_NAMES = ['Minuit', 'Sablier', 'Pendule', 'Coucou', 'Seconde', 'Aiguille', 'Marteau', 'Métronome', 'Tic-Tac', 'Midi'];
const MAX_MEMBERS = 16;
/** Délai laissé à un joueur déconnecté avant que le pilote automatique ne prenne le relais. */
const GRACE_MS = 20_000;
/** Mode accéléré pour les tests locaux (TA_FAST=1) : une minute de réserve devient une seconde, et tout s'enchaîne vite. */
const FAST = process.env.TA_FAST === '1';
const BANK_SCALE = FAST ? 60 : 1;
const T = {
  ready: FAST ? 500 : READY_MS,
  countdown: FAST ? 300 : COUNTDOWN_MS,
  result: FAST ? 80 : RESULT_MS,
  finish: FAST ? 100 : 2_400,
  /** Un doigt automatique se pose entre autoMin et autoMin + autoSpread après le début de la préparation, comme une main. */
  autoMin: FAST ? 0 : 500,
  autoSpread: FAST ? 150 : 2_500,
};
/** Le retard toléré entre le doigt levé et l'arrivée du message, aller et retour compris. */
const MAX_LAG = 25;
/** Un temps épuisé éjecte le bouton un peu après l'échéance, pour laisser arriver un doigt levé juste avant. */
const PUSH_GRACE_MS = FAST ? 40 : 600;
/** Le rang de chaque étape dans une enchère, pour le numéro d'état public. */
const STAGE_STEP: Record<Stage, number> = { ready: 0, countdown: 1, auction: 2, result: 3, over: 4 };

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  isBot: boolean;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number;
  left: boolean;
  status: PlayerStatus;
}

function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  settings: Settings = { format: 'court' };
  players: Player[] = [];
  game: Game | null = null;
  final: FinalView | null = null;
  wins = new Map<string, number>();
  skills = new Map<string, Skill>();
  /** Fin de la préparation, du compte à rebours ou du résultat (heure du serveur). */
  stageEndsAt = 0;
  /** Le moment où le temps a commencé à filer. */
  startedAt = 0;
  /** Quand lâcher pour les bots et le pilote automatique, et quand éjecter le bouton d'un humain dont le temps s'épuise. */
  private releases = new Map<string, { at: number; bid: number | null }>();
  /** Pendant la préparation, quand chaque doigt automatique se pose : pas tous à l'instant, sinon on les reconnaîtrait. */
  private autoAt = new Map<string, number>();
  finishAt = 0;
  lastActive = Date.now();
  onChange: () => void = () => {};
  /** Envoie sa vue à un seul joueur : pendant le compte à rebours et l'enchère, le geste d'un joueur ne doit rien changer chez les autres. */
  onPrivate: (playerId: string) => void = () => {};
  onEmote: (playerId: string, text: string) => void = () => {};

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ───────────────────────────── Membres ─────────────────────────────

  get(id: string | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  findByToken(playerId: unknown, token: unknown): Player | undefined {
    if (typeof playerId !== 'string' || typeof token !== 'string') return undefined;
    const p = this.get(playerId);
    return p && !p.isBot && p.token === token ? p : undefined;
  }

  get seated(): Player[] {
    return this.players.filter((p) => p.status !== 'spectator');
  }

  get humansOnline(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  private makePlayer(name: string, avatar: string, isBot: boolean, status: PlayerStatus): Player {
    return {
      id: uid(),
      token: uid() + uid(),
      name: this.uniqueName(name),
      avatar,
      isBot,
      sockets: new Set(),
      connected: isBot,
      disconnectedAt: Date.now(),
      left: false,
      status,
    };
  }

  addHuman(name: string, avatar: string): Player | string {
    if (this.players.length >= MAX_MEMBERS) return 'Cette table est pleine.';
    if (this.phase === 'lobby' && this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const p = this.makePlayer(name, avatar, false, this.phase === 'lobby' ? 'lobby' : 'spectator');
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  addBot(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.phase !== 'lobby') return 'On ajoute des bots dans le salon.';
    if (this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const used = new Set(this.players.map((p) => p.name));
    const names = BOT_NAMES.filter((n) => !used.has(n));
    const name = names.length ? names[crypto.randomInt(names.length)] : `Bot ${this.players.length + 1}`;
    const usedAvatars = new Set(this.players.map((p) => p.avatar));
    const free = AVATARS.filter((a) => !usedAvatars.has(a));
    const pool = free.length ? free : AVATARS;
    this.players.push(this.makePlayer(name, pool[crypto.randomInt(pool.length)], true, 'lobby'));
    return undefined;
  }

  kick(by: string, target: string): { sockets: string[] } | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (this.phase !== 'lobby') return 'On ne peut retirer un joueur que dans le salon.';
    const p = this.get(target);
    if (!p || p.id === by) return 'Joueur introuvable.';
    this.players = this.players.filter((x) => x.id !== p.id);
    return { sockets: [...p.sockets] };
  }

  leave(id: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.clear();
    p.connected = false;
    p.disconnectedAt = Date.now();
    // En partie, sa place reste à la table : le pilote automatique joue pour lui.
    if (this.phase === 'lobby' || p.status === 'spectator') this.players = this.players.filter((x) => x.id !== id);
    else {
      p.left = true;
      this.fingerGone(id);
    }
    if (this.hostId === id) this.transferHost();
  }

  private transferHost(): void {
    const next = this.players.find((p) => !p.isBot && !p.left && p.connected) ?? this.players.find((p) => !p.isBot && !p.left);
    this.hostId = next?.id ?? '';
  }

  connect(p: Player, socketId: string): void {
    p.sockets.add(socketId);
    p.connected = true;
    p.left = false;
    if (!this.hostId || !this.get(this.hostId) || this.get(this.hostId)?.left) this.hostId = p.id;
  }

  disconnect(id: string | undefined, socketId: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.connected = false;
      p.disconnectedAt = Date.now();
      this.fingerGone(p.id);
    }
  }

  /** Un téléphone qui disparaît ne peut plus tenir son bouton : le doigt est levé à l'instant où on l'a perdu. */
  private fingerGone(id: string): void {
    const g = this.game;
    // Sans temps restant, le doigt est automatique : il reste posé, comme pour tous ceux dans ce cas.
    if (this.phase !== 'playing' || !g || !g.holding.has(id) || g.spent.has(id)) return;
    if (g.stage === 'auction') {
      this.releases.delete(id);
      g.release(id, Math.floor((Date.now() - this.startedAt) / 100));
      this.maybeClose();
    } else g.up(id);
  }

  isAuto(p: Player): boolean {
    return p.isBot || p.left || (!p.connected && Date.now() - p.disconnectedAt >= GRACE_MS);
  }

  updateSettings(by: string, payload: Record<string, unknown>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se changent dans le salon.';
    if (isFormat(payload.format)) this.settings.format = payload.format;
    return undefined;
  }

  // ───────────────────────────── Partie ─────────────────────────────

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase !== 'lobby') return 'La partie est déjà lancée.';
    const seated = this.seated;
    if (seated.length < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (ajoute un bot si besoin).`;
    for (const p of seated) p.status = 'playing';
    const order = shuffle(seated.map((p) => p.id));
    const spectators = this.players.filter((p) => p.status === 'spectator');
    this.players = [...order.map((id) => this.get(id)!), ...spectators];
    const f = FORMATS[this.settings.format];
    this.game = new Game(order, f.rounds, Math.max(10, Math.round(f.bank / BANK_SCALE)));
    this.skills.clear();
    for (const p of this.players) if (p.isBot && p.status === 'playing') this.skills.set(p.id, randomSkill());
    this.phase = 'playing';
    this.final = null;
    this.enterReady();
    return undefined;
  }

  restart(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut relancer une partie.";
    if (this.phase === 'lobby') return undefined;
    this.clearTimer();
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'lobby' : 'spectator';
      if (p.status === 'lobby') seats++;
    }
    this.phase = 'lobby';
    this.game = null;
    this.final = null;
    this.skills.clear();
    this.releases.clear();
    return undefined;
  }

  endEarly(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut arrêter la partie.";
    if (this.phase !== 'playing') return undefined;
    return this.restart(by);
  }

  /** Ceux qu'on attend avant le compte à rebours : les humains présents à la table qui ont encore du temps. */
  private awaited(): string[] {
    const g = this.game!;
    return g.order.filter((id) => {
      const p = this.get(id);
      return p && !this.isAuto(p) && p.connected && !g.spent.has(id);
    });
  }

  /**
   * Les bots, les absents et ceux dont le temps est épuisé posent le doigt d'office, comme tout le monde :
   * personne ne doit deviner à la préparation qui n'a plus de temps.
   */
  private autoHold(now = Infinity): void {
    const g = this.game!;
    for (const id of g.order) {
      const p = this.get(id);
      if (p && (this.isAuto(p) || g.spent.has(id)) && !g.holding.has(id) && (this.autoAt.get(id) ?? 0) <= now) g.down(id);
    }
  }

  private enterReady(): void {
    this.releases.clear();
    this.startedAt = 0;
    const now = Date.now();
    this.stageEndsAt = now + T.ready;
    this.autoAt.clear();
    for (const id of this.game!.order) this.autoAt.set(id, now + T.autoMin + crypto.randomInt(T.autoSpread));
    this.autoHold(now);
    this.maybeCountdown();
  }

  /** Le compte à rebours part dès que tous les doigts attendus sont posés. */
  private maybeCountdown(): void {
    const g = this.game;
    if (!g || g.stage !== 'ready') return;
    if (!g.allHolding(this.awaited())) return;
    this.startCountdown();
  }

  private startCountdown(): void {
    const g = this.game!;
    this.autoHold();
    g.startCountdown();
    this.stageEndsAt = Date.now() + T.countdown;
  }

  /** Le temps file : les bots et les absents décident jusqu'où ils tiendront, et chaque bouton humain reçoit son échéance. */
  private startAuction(): void {
    const g = this.game!;
    const now = Date.now();
    const plans = new Map<string, number | null>();
    for (const id of [...g.holding]) {
      const p = this.get(id);
      if (!p || !this.isAuto(p)) continue;
      const bid = botBid(g, id, (p.isBot && this.skills.get(id)) || AUTOPILOT);
      plans.set(id, bid);
      if (bid === null) g.up(id);
    }
    g.startAuction();
    this.startedAt = now;
    this.stageEndsAt = 0;
    this.releases.clear();
    for (const id of g.holding) {
      const plan = plans.get(id);
      if (plan !== undefined && plan !== null) this.releases.set(id, { at: now + Math.min(plan, g.left(id)) * 100, bid: plan });
      else this.releases.set(id, { at: now + g.left(id) * 100 + PUSH_GRACE_MS, bid: null });
    }
    this.maybeClose();
  }

  /** Plus personne ne tient : le jeton est adjugé. */
  private maybeClose(): void {
    const g = this.game!;
    if (g.stage !== 'auction' || g.holding.size > 0) return;
    const r = g.close();
    this.releases.clear();
    this.stageEndsAt = Date.now() + T.result;
    if (r) this.botReacts(r.kind, r.winner);
  }

  private afterResult(): void {
    const g = this.game!;
    g.next();
    if (g.stage === 'over') {
      this.finishAt = Date.now() + T.finish;
      this.stageEndsAt = 0;
      return;
    }
    this.enterReady();
  }

  /**
   * Un geste du joueur : doigt posé ou levé. La durée tenue vient du téléphone, mesurée depuis la fin de son propre compte à rebours.
   * Renvoie ceux dont la vue change : tout le monde pendant la préparation, lui seul ensuite, tant que l'enchère n'est pas close.
   */
  hold(by: string, down: boolean, payload: Record<string, unknown>): { error?: string; scope: string[] | null } {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return { error: "Aucune partie n'est en cours.", scope: [by] };
    if (!g.has(by)) return { error: 'Tu regardes la partie : tu joueras à la prochaine.', scope: [by] };
    if (payload.round !== g.round) return { scope: [by] };
    // Sans temps restant, le doigt est automatique : rien de ce que fait le joueur ne doit le distinguer des autres.
    if (g.spent.has(by)) return { scope: [by] };
    if (g.stage === 'ready') {
      if (down) {
        g.down(by);
        this.maybeCountdown();
      } else g.up(by);
      return { scope: null };
    }
    if (g.stage === 'countdown') {
      if (down) g.down(by);
      else g.up(by);
      return { scope: [by] };
    }
    if (down || g.stage !== 'auction' || !g.holding.has(by)) return { scope: [by] };
    const elapsed = Math.floor((Date.now() - this.startedAt) / 100);
    const held = parseTenths(payload.held);
    this.releases.delete(by);
    if (held === null && elapsed <= 15) g.withdraw(by);
    else {
      // Le téléphone ne peut pas annoncer plus que ce que le serveur a vu passer, ni beaucoup moins.
      const claimed = held ?? elapsed;
      g.release(by, Math.max(Math.max(0, elapsed - MAX_LAG), Math.min(claimed, elapsed + 3)));
    }
    this.maybeClose();
    return { scope: (g.stage as string) === 'auction' ? [by] : null };
  }

  /** De temps en temps, un bot réagit au résultat. */
  private botReacts(kind: string, winner: string | null): void {
    if (FAST) return;
    const g = this.game!;
    const bots = g.order.map((id) => this.get(id)).filter((p): p is Player => !!p?.isBot);
    if (!bots.length) return;
    const w = this.get(winner ?? undefined);
    if (kind === 'won' && w?.isBot && Math.random() < 0.3) setTimeout(() => this.onEmote(w.id, pickOne(['⏱️', '🔥', 'Bien joué'])), 900);
    else if (kind === 'tie' && Math.random() < 0.5) setTimeout(() => this.onEmote(pickOne(bots).id, '😬'), 1100);
    else if (kind === 'won' && !w?.isBot && Math.random() < 0.25) setTimeout(() => this.onEmote(pickOne(bots).id, pickOne(['Trop cher', '🧊', '😈'])), 1300);
  }

  private finishGame(): void {
    const g = this.game;
    if (!g) return;
    const rows = g.standings();
    for (const r of rows) if (r.place === 1) this.wins.set(r.id, (this.wins.get(r.id) ?? 0) + 1);
    this.final = {
      format: this.settings.format,
      rounds: g.rounds,
      bank: g.bankStart,
      history: g.history.map((h) => ({ ...h, bids: h.bids.map((b) => ({ ...b })) })),
      players: rows.map((r) => {
        const p = this.get(r.id);
        return {
          id: r.id,
          name: p?.name ?? '?',
          avatar: p?.avatar ?? AVATARS[0],
          seat: g.order.indexOf(r.id) + 1,
          tokens: r.tokens,
          left: r.left,
          place: r.place,
          wins: this.wins.get(r.id) ?? 0,
          winner: r.place === 1,
        };
      }),
    };
    this.phase = 'finished';
    this.clearTimer();
  }

  // ───────────────────────────── Minuteries ─────────────────────────────

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** À appeler après chaque changement : planifie la prochaine échéance puis diffuse l'état, à tous ou seulement à certains. */
  commit(scope: string[] | null = null): void {
    this.reschedule();
    if (scope) for (const id of scope) this.onPrivate(id);
    else this.onChange();
  }

  /** La prochaine échéance : fin d'étape, lâcher d'un bot, bouton éjecté, absent qui passe en pilote automatique, ou fin de partie. */
  private dueAt(): number {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return Infinity;
    if (g.stage === 'over') return this.finishAt;
    if (g.stage === 'auction') return Math.min(Infinity, ...[...this.releases.values()].map((r) => r.at));
    let due = this.stageEndsAt || Infinity;
    if (g.stage === 'ready') {
      // Un absent qui bascule en pilote automatique ne doit plus faire attendre la table ; un doigt automatique se pose.
      const now = Date.now();
      for (const id of g.order) {
        const p = this.get(id);
        if (p && !p.isBot && !p.left && !p.connected && p.disconnectedAt + GRACE_MS > now) due = Math.min(due, p.disconnectedAt + GRACE_MS);
        const at = this.autoAt.get(id) ?? 0;
        if (at > now && !g.holding.has(id)) due = Math.min(due, at);
      }
    }
    return due;
  }

  private reschedule(): void {
    this.clearTimer();
    const due = this.dueAt();
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      let scope: string[] | null = null;
      try {
        scope = this.tick();
      } catch (e) {
        console.error(`[room ${this.code}]`, e);
      }
      this.commit(scope);
    }, Math.max(0, Math.min(due - Date.now(), 2_147_000_000)));
  }

  /** Fait avancer la table ; renvoie ceux qui doivent recevoir leur vue (null : tout le monde). */
  tick(): string[] | null {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return null;
    const now = Date.now();
    switch (g.stage) {
      case 'ready':
        this.autoHold(now);
        if (now >= this.stageEndsAt) this.startCountdown();
        else this.maybeCountdown();
        return null;
      case 'countdown':
        if (now >= this.stageEndsAt) this.startAuction();
        return null;
      case 'auction': {
        // Un bot qui lâche ne change rien chez les autres ; un humain éjecté l'apprend, lui seul.
        const told: string[] = [];
        for (const [id, r] of [...this.releases]) {
          if (r.at > now) continue;
          this.releases.delete(id);
          if (r.bid !== null) g.release(id, r.bid);
          else {
            g.pushOut(id);
            told.push(id);
          }
        }
        this.maybeClose();
        return (g.stage as string) === 'auction' ? told : null;
      }
      case 'result':
        if (now >= this.stageEndsAt) this.afterResult();
        return null;
      case 'over':
        if (now >= this.finishAt) this.finishGame();
        return null;
    }
  }

  dispose(): void {
    this.clearTimer();
  }

  // ───────────────────────────── Vue personnalisée ─────────────────────────────

  private gameView(g: Game, viewerId: string): GameView {
    const seated = g.has(viewerId);
    return {
      order: [...g.order],
      stage: g.stage,
      round: g.round,
      rounds: g.rounds,
      bank: g.bankStart,
      endsAt: g.stage === 'ready' || g.stage === 'countdown' || g.stage === 'result' ? this.stageEndsAt : 0,
      startedAt: g.stage === 'auction' || g.stage === 'result' ? this.startedAt : 0,
      result: g.result ? { ...g.result } : null,
      me: seated
        ? {
            holding: g.holding.has(viewerId),
            passed: g.passed.has(viewerId),
            bidding: g.bidders.has(viewerId),
            pushed: g.pushed.has(viewerId),
            spent: g.spent.has(viewerId),
          }
        : null,
      // Tiré de ce que tout le monde voit (enchère et étape) : le compteur interne avance à chaque geste privé,
      // et son saut au résultat dirait combien ont passé, ou combien n'ont plus de temps.
      seq: g.round * 8 + STAGE_STEP[g.stage],
    };
  }

  viewFor(viewerId: string): RoomView {
    const g = this.phase === 'playing' ? this.game : null;
    return {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: this.players.map((p) => {
        const seat = g ? g.order.indexOf(p.id) : -1;
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          isBot: p.isBot,
          isHost: p.id === this.hostId,
          connected: p.isBot || p.connected,
          autopilot: !p.isBot && p.status === 'playing' && this.isAuto(p),
          status: p.status,
          wins: this.wins.get(p.id) ?? 0,
          seat: seat >= 0 ? seat + 1 : null,
          tokens: g && seat >= 0 ? g.tokensOf(p.id) : null,
          // Seulement pendant la préparation : ensuite, personne ne doit savoir qui tient encore.
          ready: !!g && g.stage === 'ready' && g.holding.has(p.id),
        };
      }),
      game: g ? this.gameView(g, viewerId) : null,
      final: this.final,
      serverNow: Date.now(),
    };
  }
}

function pickOne<T>(arr: T[]): T {
  return arr[crypto.randomInt(arr.length)];
}
