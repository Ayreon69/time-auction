// La table : les joueurs et leurs jetons, le tableau en tubes Nixie, et le gros bouton qu'on garde enfoncé.
// Le compte à rebours et le temps tenu se mesurent sur l'horloge du téléphone : la latence du réseau ne compte pas.
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Bot, Flag, LogOut, MoreHorizontal, Smile, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EMOTES, READY_MS, TAUNTS, clock, type GameView, type PlayerView, type RoomView } from '../../../shared/protocol';
import { Avatar, Button, Logo, Modal, NixieClock, NixieDigit, Tokens, seatColor } from '../components/Ui';
import { sfx } from '../lib/sound';
import { listing, nameOf } from '../lib/text';
import { cls, reducedMotion, vibrate } from '../lib/util';
import { leaveRoom, send, socket } from '../net';
import { useStore, type Emote } from '../store';

const CONFETTI = ['#ff8a2b', '#ffd2a0', '#c9a25a', '#f3e7d3', '#e2482f'];

function burst(el: Element | null, count = 90): void {
  if (!el || reducedMotion()) return;
  const r = el.getBoundingClientRect();
  void confetti({
    particleCount: count,
    spread: 80,
    startVelocity: 30,
    origin: { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight },
    colors: CONFETTI,
    shapes: ['circle', 'square'],
    scalar: 0.8,
    disableForReducedMotion: true,
  });
}

// ───────────────────────────── L'horloge du téléphone ─────────────────────────────

type LocalStage = GameView['stage'];

interface Start {
  round: number;
  /** performance.now() du moment où le temps commence à filer, ici. */
  at: number;
}

/** Un rendu régulier pendant le compte à rebours et l'enchère, pour faire défiler les dixièmes. */
function useFrame(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = -1;
    const loop = () => {
      const t = performance.now();
      // Un rendu par dixième suffit : le tableau n'affiche pas plus fin.
      const tenth = Math.floor(t / 50);
      if (tenth !== last) {
        last = tenth;
        setNow(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return active ? now : performance.now();
}

/** Le début de l'enchère sur l'horloge du téléphone : la fin du compte à rebours annoncé, ou le départ déjà pris. */
function useStart(view: RoomView): Start | null {
  const viewAt = useStore((s) => s.viewAt);
  const g = view.game!;
  const ref = useRef<Start | null>(null);
  if (!ref.current || ref.current.round !== g.round) {
    if (g.stage === 'countdown' && g.endsAt) ref.current = { round: g.round, at: viewAt + (g.endsAt - view.serverNow) };
    else if ((g.stage === 'auction' || g.stage === 'result') && g.startedAt) ref.current = { round: g.round, at: viewAt - (view.serverNow - g.startedAt) };
  }
  return ref.current && ref.current.round === g.round ? ref.current : null;
}

function localStage(g: GameView, start: Start | null, now: number): LocalStage {
  if (g.stage === 'countdown' && start && now >= start.at) return 'auction';
  return g.stage;
}

// ───────────────────────────── Morceaux de la table ─────────────────────────────

function ReactionTray({ onClose }: { onClose: () => void }) {
  const emit = (emoji: string) => {
    socket.emit('emote', { emoji });
    onClose();
  };
  return (
    <motion.div className="reactions" role="menu" aria-label="Réactions" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <div className="reaction-emojis">
        {EMOTES.map((e) => (
          <button key={e} type="button" role="menuitem" onClick={() => emit(e)} aria-label={`Réaction ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="reaction-taunts">
        {TAUNTS.map((t) => (
          <button key={t} type="button" role="menuitem" onClick={() => emit(t)}>
            {t}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function Bubbles({ emotes }: { emotes: Emote[] }) {
  return (
    <AnimatePresence>
      {emotes.slice(-1).map((e) => (
        <motion.span key={e.id} className={cls('bubble', e.emoji.length > 3 && 'is-text')} initial={{ scale: 0.4, y: 6, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ opacity: 0, y: -6 }}>
          {e.emoji}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** Un joueur : son avatar sur un verre à sa couleur, son nom, ses jetons ; pendant la préparation, son doigt posé. */
function PlayerChip({ view, p, emotes, bump, finger }: { view: RoomView; p: PlayerView; emotes: Emote[]; bump: boolean; finger: boolean }) {
  const g = view.game!;
  const me = p.id === view.me;
  // Mon propre voyant suit mon doigt tout de suite, sans attendre l'aller-retour du serveur.
  // (Sans temps restant, le doigt est automatique : on montre alors ce que voient les autres.)
  const ready = me && !g.me?.spent ? finger : p.ready;
  return (
    <li className={cls('pchip', me && 'is-me', !p.connected && 'is-off', g.stage === 'ready' && ready && 'is-ready')} style={{ ['--seat' as string]: seatColor(p.seat) }}>
      <span className="pchip-glass">
        <Avatar avatar={p.avatar} className="pchip-avatar" />
        {g.stage === 'ready' && <span className={cls('pchip-led', ready && 'is-on')} aria-label={ready ? 'Doigt posé' : 'En attente'} />}
      </span>
      <span className="pchip-name">
        <b>{me ? 'Toi' : p.name}</b>
        {p.autopilot ? <Bot size={13} className="pchip-state" aria-label="Pilote automatique" /> : !p.connected ? <WifiOff size={13} className="pchip-state" aria-label="Absent" /> : null}
      </span>
      <Tokens n={p.tokens ?? 0} bump={bump} className="pchip-tokens" />
      <Bubbles emotes={emotes} />
    </li>
  );
}

function Players({ view, emotes, finger }: { view: RoomView; emotes: Emote[]; finger: boolean }) {
  const g = view.game!;
  const players = g.order.map((id) => view.players.find((p) => p.id === id)).filter((p): p is PlayerView => !!p);
  const winner = g.stage === 'result' && g.result?.kind === 'won' ? g.result.winner : null;
  return (
    <ol className={cls('players', `has-${players.length}`)} aria-label="Les joueurs et leurs jetons">
      {players.map((p) => (
        <PlayerChip key={p.id} view={view} p={p} emotes={emotes.filter((e) => e.playerId === p.id)} bump={p.id === winner} finger={finger} />
      ))}
    </ol>
  );
}

/** Les enchères de la partie, en voyants : celles jouées, celle en cours, celles à venir. */
function RoundLamps({ g }: { g: GameView }) {
  return (
    <span className="lamps" role="img" aria-label={`Enchère ${g.round} sur ${g.rounds}`}>
      {Array.from({ length: g.rounds }, (_, i) => (
        <i key={i} className={cls(i + 1 < g.round && 'is-done', i + 1 === g.round && 'is-now')} />
      ))}
    </span>
  );
}

function ReadyBar({ endsAt, offset }: { endsAt: number; offset: number }) {
  const left = Math.max(0, endsAt - (Date.now() + offset));
  return (
    <span className="ready-bar" aria-hidden>
      <span key={endsAt} style={{ animationDuration: `${left}ms`, width: `${Math.min(100, (left / READY_MS) * 100)}%` }} />
    </span>
  );
}

/** Le tampon du commissaire-priseur. */
function Stamp({ view }: { view: RoomView }) {
  const r = view.game!.result;
  if (!r) return null;
  const mine = r.winner === view.me;
  const title = r.kind === 'won' ? 'Adjugé' : r.kind === 'tie' ? 'Jeton perdu' : 'Sans preneur';
  const sub = r.kind === 'won' ? (mine ? 'à toi !' : `à ${nameOf(view, r.winner)}`) : r.kind === 'tie' ? 'égalité au dixième' : 'personne n’a tenu';
  return (
    <motion.div
      className={cls('stamp', `is-${r.kind}`, mine && 'is-mine')}
      initial={{ scale: 1.3, rotate: -12, opacity: 0 }}
      animate={{ scale: 1, rotate: -5, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 17 }}
    >
      <b>{title}</b>
      <small>{sub}</small>
    </motion.div>
  );
}

// ───────────────────────────── L'écran ─────────────────────────────

export function Table({ view }: { view: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const emotes = useStore((s) => s.emotes);
  const offset = useStore((s) => s.clockOffset);
  const [menu, setMenu] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [react, setReact] = useState(false);
  const g = view.game!;
  const me = g.me;
  const seated = !!me;
  const isHost = view.hostId === view.me;
  const start = useStart(view);
  const running = g.stage === 'countdown' || g.stage === 'auction';
  const now = useFrame(running);
  const stage = localStage(g, start, now);

  // Le doigt, tel que le téléphone le sent : il précède toujours ce que le serveur sait.
  const [finger, setFinger] = useState(false);
  const fingerRef = useRef(false);
  const pointer = useRef<number | null>(null);
  // Les gestes de cette enchère : passée pendant le compte à rebours, bouton éjecté, doigt arrivé trop tard.
  const passedRef = useRef(0);
  const [passedRound, setPassedRound] = useState(0);
  const [pushedRound, setPushedRound] = useState(0);
  const [mine, setMine] = useState<{ round: number; held: number } | null>(null);
  const [late, setLate] = useState(0);
  const live = useRef({ g, start, seated, spent: !!me?.spent });
  live.current = { g, start, seated, spent: !!me?.spent };

  const emitHold = (down: boolean, held: number | null = null) => {
    socket.emit('hold', { down, round: live.current.g.round, held }, (res?: { ok: boolean; error?: string }) => {
      if (res && !res.ok && res.error) useStore.getState().showToast(res.error);
    });
  };

  const press = () => {
    const { g: cur, start: st, seated: inGame, spent } = live.current;
    if (!inGame || fingerRef.current) return;
    if (spent) {
      useStore.getState().showToast('Ton temps est épuisé : tu ne peux plus enchérir.', 'info');
      return;
    }
    const ls = localStage(cur, st, performance.now());
    if (ls === 'auction') {
      if (!cur.me?.bidding) useStore.getState().showToast('L’enchère a commencé : attends la suivante.', 'info');
      return;
    }
    if (ls === 'countdown' && (cur.me?.passed || passedRef.current === cur.round)) {
      useStore.getState().showToast('Tu as passé cette enchère.', 'info');
      return;
    }
    fingerRef.current = true;
    setFinger(true);
    sfx.press();
    vibrate(12);
    // Pendant le résultat, le doigt attend l'enchère suivante : il sera annoncé dès la préparation.
    if (ls === 'ready' || ls === 'countdown') emitHold(true);
  };

  const release = () => {
    // Toujours oublier le pointeur, même quand l'appui avait été refusé (bouton éjecté, doigt trop tard) : sinon le bouton reste mort.
    pointer.current = null;
    if (!fingerRef.current) return;
    fingerRef.current = false;
    setFinger(false);
    const { g: cur, start: st } = live.current;
    const t = performance.now();
    const ls = localStage(cur, st, t);
    if (ls === 'ready') {
      emitHold(false);
      sfx.lift();
    } else if (ls === 'countdown') {
      emitHold(false);
      passedRef.current = cur.round;
      setPassedRound(cur.round);
      sfx.lift();
      vibrate(8);
    } else if (ls === 'auction' && st) {
      const held = Math.floor((t - st.at) / 100);
      emitHold(false, held);
      setMine({ round: cur.round, held });
      sfx.release();
      vibrate(18);
    }
  };

  // Le doigt posé pendant le résultat s'annonce dès que la préparation commence.
  useEffect(() => {
    if (g.stage === 'ready' && fingerRef.current) emitHold(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.stage, g.round]);

  // Le serveur a éjecté mon bouton (temps épuisé), ou mon doigt est arrivé après le départ.
  useEffect(() => {
    if (!me || g.stage !== 'auction' || !fingerRef.current) return;
    if (me.pushed) {
      fingerRef.current = false;
      setFinger(false);
      setPushedRound(g.round);
      sfx.pushed();
      vibrate([60, 40, 90]);
      return;
    }
    if (!me.bidding && !me.holding) {
      fingerRef.current = false;
      setFinger(false);
      setLate(g.round);
    }
  }, [me?.pushed, me?.spent, me?.bidding, me?.holding, g.stage, g.round]);

  // Le clavier sur ordinateur : la barre Espace tient lieu de bouton ; et un doigt perdu (appli quittée) se lève.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) && e.target.className.indexOf('plunger') < 0;
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e) || document.querySelector('.modal')) return;
      e.preventDefault();
      press();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      release();
    };
    const lost = () => {
      if (document.visibilityState === 'hidden') release();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', lost);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', lost);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sons, vibrations et confettis, tirés de l'étape et du temps ──
  const second = stage === 'countdown' && start ? Math.ceil((start.at - now) / 1000) : stage === 'auction' && start ? Math.floor((now - start.at) / 1000) : -1;
  const began = useRef(false);
  useEffect(() => {
    if (began.current) return;
    began.current = true;
    if (g.round === 1 && g.stage === 'ready') sfx.start();
  }, [g.round, g.stage]);
  useEffect(() => {
    if (stage === 'countdown' && second >= 1 && second <= 5) {
      sfx.beep(false);
      if (fingerRef.current) vibrate(6);
    }
  }, [stage, second]);
  useEffect(() => {
    if (stage !== 'auction') return;
    if (second === 0) {
      sfx.beep(true);
      if (fingerRef.current) vibrate(30);
    } else if (second > 0) sfx.tick(fingerRef.current);
  }, [stage, second]);
  const resultKey = g.result ? `${g.result.round}` : '';
  useEffect(() => {
    const r = g.result;
    if (!r || g.stage !== 'result') return;
    if (r.kind === 'won') {
      sfx.gavel(r.winner === view.me);
      if (r.winner === view.me) {
        vibrate([30, 40, 90]);
        window.setTimeout(() => burst(document.querySelector('.board')), 150);
      }
    } else if (r.kind === 'tie') sfx.tie();
    else sfx.nobody();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey]);

  // ── Ce que montre le tableau ──
  const elapsed = start ? Math.max(0, Math.floor((now - start.at) / 100)) : 0;
  const shown = g.stage === 'result' || g.stage === 'over' ? (g.result?.time ?? 0) : stage === 'auction' ? elapsed : 0;
  const countLeft = stage === 'countdown' && start ? Math.max(1, Math.min(5, Math.ceil((start.at - now) / 1000))) : null;
  const passed = !!me && (me.passed || passedRound === g.round);
  const myRelease = mine && mine.round === g.round ? mine : null;
  // Ceux qu'on attend encore, sans soi-même : mon doigt est posé avant que le serveur ne le sache.
  const waiting = g.order.filter((id) => id !== view.me && !view.players.find((p) => p.id === id)?.ready);

  let kicker: string;
  let message: ReactNode;
  if (g.stage === 'ready') {
    kicker = 'Préparation';
    if (!seated) message = 'Tout le monde pose le doigt…';
    else if (me.spent) message = 'Ton temps est épuisé : tu regardes les autres enchérir.';
    else if (finger) message = waiting.length ? `Doigt posé. On attend ${listing(waiting.map((id) => nameOf(view, id)))}…` : 'Doigt posé. Ça part !';
    else message = 'Pose ton doigt sur le bouton et garde-le appuyé.';
  } else if (stage === 'countdown') {
    kicker = 'Compte à rebours';
    if (!seated || me.spent) message = 'Ceux qui lèvent le doigt maintenant passent leur tour.';
    else if (finger) message = 'Lève le doigt maintenant pour passer.';
    else message = passed ? 'Tu passes cette enchère.' : 'Tu passes cette enchère : ton doigt n’est pas posé.';
  } else if (stage === 'auction') {
    kicker = 'Enchère en cours';
    if (!seated) message = 'Le temps file pour ceux qui tiennent encore.';
    else if (pushedRound === g.round) message = 'Temps épuisé : ton bouton a sauté !';
    else if (me.spent && !myRelease) message = 'Ton temps est épuisé : tu regardes les autres.';
    else if (finger) message = 'Tu tiens. Lâche quand tu veux : le dernier à lâcher gagne.';
    else if (late === g.round) message = 'Ton doigt est arrivé après le départ : tu passes celle-ci.';
    else if (myRelease) message = 'Tu as lâché. Le temps file encore ? Quelqu’un tient toujours.';
    else message = passed ? 'Tu as passé. Quelqu’un tient-il encore ?' : 'Le temps file pour ceux qui tiennent.';
  } else {
    const r = g.result;
    kicker = `Enchère ${r?.round ?? g.round} jouée`;
    if (!r) message = '';
    else if (r.kind === 'won') message = r.winner === view.me ? `Tu remportes le jeton en ${clock(r.time)} !` : `${nameOf(view, r.winner)} remporte le jeton en ${clock(r.time)}.`;
    else if (r.kind === 'tie') message = 'Deux joueurs ont lâché au même dixième : le jeton est perdu.';
    else message = 'Personne n’a enchéri : le jeton est perdu.';
    if (g.stage === 'over') message = <>{message} C’était la dernière enchère…</>;
  }

  let label: string;
  if (!seated) label = '';
  else if (me.spent) label = 'Plus de temps';
  else if (stage === 'ready') label = finger ? 'Garde le doigt posé' : 'Appuie et garde le doigt posé';
  else if (stage === 'countdown') label = finger ? 'Lève le doigt pour passer' : 'Tu passes';
  else if (stage === 'auction') label = finger ? 'Lâche pour arrêter ton temps' : pushedRound === g.round ? 'Bouton éjecté' : myRelease ? 'Mise faite' : 'Hors enchère';
  else label = finger ? 'Doigt posé pour la suivante' : g.stage === 'over' ? 'Fin de partie' : 'Prépare-toi pour la suivante';

  const ghost = myRelease && stage === 'auction' && now - (start?.at ?? 0) - myRelease.held * 100 < 1600;

  return (
    <div className={cls('table-screen', `stage-${stage}`, finger && 'is-holding')}>
      <header className="table-top">
        <span className="table-logo">
          <Logo size="sm" />
        </span>
        <span className="round-chip">
          <small>Enchère</small>
          <b>
            {g.round}
            <i>/{g.rounds}</i>
          </b>
        </span>
        <div className="table-tools">
          <button type="button" className={cls('icon-btn', react && 'is-on')} aria-label="Réagir" aria-expanded={react} onClick={() => setReact((x) => !x)}>
            <Smile size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>
            <MoreHorizontal size={20} />
          </button>
        </div>
        {react && <ReactionTray onClose={() => setReact(false)} />}
      </header>

      <div className="table-body">
        <Players view={view} emotes={emotes} finger={finger} />

        <section className={cls('board', `is-${stage}`)} aria-live="polite">
          <div className="board-head">
            <span className="board-kicker">{kicker}</span>
            <RoundLamps g={g} />
          </div>
          <div className="board-clock">
            <NixieClock tenths={shown} dim={stage === 'ready' || stage === 'countdown'} label={`Tableau : ${clock(shown)}`} />
            <AnimatePresence>
              {countLeft !== null && (
                <motion.span key={countLeft} className="board-count" initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.15 } }}>
                  <NixieDigit ch={String(countLeft)} />
                </motion.span>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {ghost && myRelease && (
                <motion.span key={`ghost${myRelease.round}`} className="board-ghost" initial={{ y: 0, opacity: 1 }} animate={{ y: -18, opacity: 0 }} transition={{ duration: 1.5, ease: 'easeIn' }}>
                  ton doigt : {clock(myRelease.held)}
                </motion.span>
              )}
            </AnimatePresence>
            <AnimatePresence>{(g.stage === 'result' || g.stage === 'over') && g.result && <Stamp key={resultKey} view={view} />}</AnimatePresence>
          </div>
          <p className="board-msg">{message}</p>
          {g.stage === 'ready' && g.endsAt > 0 && <ReadyBar endsAt={g.endsAt} offset={offset} />}
        </section>

        {seated ? (
          <div className="plunger-zone">
            <button
              type="button"
              className={cls('plunger', finger && 'is-down', me.spent && 'is-spent', stage === 'auction' && finger && 'is-live')}
              aria-label="Le bouton : appuie et garde le doigt posé ; lâche pour arrêter ton temps"
              aria-pressed={finger}
              onPointerDown={(e) => {
                if (pointer.current !== null) return;
                pointer.current = e.pointerId;
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* capture impossible : on suit tout de même le doigt */
                }
                press();
              }}
              onPointerUp={(e) => {
                if (pointer.current === null || e.pointerId === pointer.current) release();
              }}
              onPointerCancel={release}
              onLostPointerCapture={(e) => {
                if (e.pointerId === pointer.current) release();
              }}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
            >
              <span className="plunger-cap" />
            </button>
            <p className="plunger-label">{label}</p>
            <p className="plunger-hint">Sur ordinateur : la barre Espace</p>
          </div>
        ) : (
          <p className="watch-note">Tu regardes la partie : tu joueras à la prochaine.</p>
        )}
      </div>

      <Modal
        open={menu}
        onClose={() => {
          setMenu(false);
          setConfirmStop(false);
        }}
        title="Menu"
      >
        <div className="menu-list">
          <Button icon={prefs.sound ? <Volume2 size={18} /> : <VolumeX size={18} />} onClick={() => setPrefs({ sound: !prefs.sound })}>
            Son : {prefs.sound ? 'activé' : 'coupé'}
          </Button>
          <Button
            icon={<BookOpen size={18} />}
            onClick={() => {
              setMenu(false);
              setRulesOpen(true);
            }}
          >
            Les règles
          </Button>
          {isHost && (
            <Button
              variant="danger"
              icon={<Flag size={18} />}
              onClick={() => {
                // Deux appuis : un geste malheureux ne doit pas couper la partie de toute la table.
                if (!confirmStop) {
                  setConfirmStop(true);
                  return;
                }
                setConfirmStop(false);
                setMenu(false);
                void send('game:end');
              }}
            >
              {confirmStop ? 'Confirmer : arrêter pour tout le monde' : 'Arrêter la partie'}
            </Button>
          )}
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter la table
          </Button>
        </div>
      </Modal>
    </div>
  );
}
