// Accueil : une enchère de démonstration sur les tubes ; pseudo + avatar, créer / rejoindre une table, jouer contre des bots, règles.
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Bot, House, LogIn, MessageSquare, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AVATARS, MAX_PLAYERS, MIN_PLAYERS } from '../../../shared/protocol';
import { AVATAR_EMOJI, AVATAR_LABELS, Backdrop, Button, Logo, NixieClock, NixieDigit } from '../components/Ui';
import { cls, reducedMotion } from '../lib/util';
import { codeFromUrl, createRoom, joinRoom } from '../net';
import { useStore } from '../store';

const BOTS_KEY = 'ta.bots';
const MAX_BOTS = MAX_PLAYERS - 1;
const MIN_BOTS = MIN_PLAYERS - 1;

function savedBots(): number {
  try {
    const n = Number(localStorage.getItem(BOTS_KEY));
    return n >= MIN_BOTS && n <= MAX_BOTS ? n : 4;
  } catch {
    return 4;
  }
}

const DEMO_WINNERS = ['Minuit', 'Sablier', 'Pendule', 'Coucou'];

/** Une enchère en boucle : trois, deux, un, le temps file, puis s'arrête net sur le temps du gagnant. */
function HeroAuction() {
  const still = reducedMotion();
  const [scene, setScene] = useState(() => ({ n: 0, stop: 63 + Math.floor(Math.random() * 40) }));
  const [t, setT] = useState(still ? 834 : 0);
  const [phase, setPhase] = useState<'count' | 'run' | 'sold'>(still ? 'sold' : 'count');
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (still) return;
    let raf = 0;
    const timers: number[] = [];
    setPhase('count');
    setT(0);
    setCount(3);
    timers.push(window.setTimeout(() => setCount(2), 700), window.setTimeout(() => setCount(1), 1400));
    timers.push(
      window.setTimeout(() => {
        setPhase('run');
        const t0 = performance.now();
        const loop = () => {
          const e = Math.floor((performance.now() - t0) / 100);
          if (e >= scene.stop) {
            setT(scene.stop);
            setPhase('sold');
            timers.push(window.setTimeout(() => setScene((s) => ({ n: s.n + 1, stop: 41 + Math.floor(Math.random() * 70) })), 2600));
            return;
          }
          setT(e);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }, 2100),
    );
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((x) => window.clearTimeout(x));
    };
  }, [scene, still]);

  return (
    <div className={cls('hero-auction', `is-${phase}`)} aria-hidden>
      <div className="hero-board">
        <NixieClock tenths={t} size="md" dim={phase === 'count'} />
        <AnimatePresence>
          {phase === 'count' && (
            <motion.span key={count} className="hero-count" initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
              <NixieDigit ch={String(count)} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="hero-caption">
        <AnimatePresence mode="wait">
          {phase === 'sold' ? (
            <motion.span key={`sold${scene.n}`} className="stamp is-small" initial={{ scale: 1.8, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: -4, opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 18 }}>
              <b>Adjugé</b>
              <small>à {DEMO_WINNERS[scene.n % DEMO_WINNERS.length]}</small>
            </motion.span>
          ) : (
            <motion.span key={`run${scene.n}${phase}`} className="hero-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {phase === 'count' ? 'Lève le doigt pour passer…' : 'Le temps file : qui lâchera en dernier ?'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Home() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const conn = useStore((s) => s.conn);
  const [invited, setInvited] = useState(codeFromUrl);
  const [code, setCode] = useState('');
  const [bots, setBots] = useState(savedBots);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setInvited(codeFromUrl());
    window.addEventListener('ta:url', sync);
    return () => window.removeEventListener('ta:url', sync);
  }, []);
  const nameOk = profile.name.trim().length > 0;

  const run = async (key: string, fn: () => Promise<boolean>) => {
    if (busy) return;
    if (!nameOk) {
      useStore.getState().showToast('Choisis d’abord un pseudo.', 'info');
      document.getElementById('pseudo')?.focus();
      return;
    }
    setBusy(key);
    await fn();
    setBusy(null);
  };

  const changeBots = (d: number) => {
    const n = Math.max(MIN_BOTS, Math.min(MAX_BOTS, bots + d));
    setBots(n);
    try {
      localStorage.setItem(BOTS_KEY, String(n));
    } catch {
      /* stockage indisponible */
    }
  };

  const cleanCode = code.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);

  return (
    <Backdrop className="home">
      <div className="home-links">
        <a className="all-games" href="https://akhis-games.onrender.com">
          <House size={16} aria-hidden /> Tous les jeux
        </a>
        <a className="all-games" href="https://akhis-games.onrender.com/feedback.html?jeu=time-auction">
          <MessageSquare size={16} aria-hidden /> Feedback
        </a>
      </div>
      <header className="home-hero">
        <motion.div initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
          <Logo size="lg" />
        </motion.div>
        <p className="tagline">
          Chacun a quelques minutes pour toutes les enchères. On mise en <b>gardant le doigt appuyé</b> : le dernier à lâcher gagne le jeton, et <b>tout le monde paie le temps tenu</b>.
        </p>
        <HeroAuction />
      </header>

      <motion.section className="panel home-panel" initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.45 }}>
        {invited && (
          <div className="invite-banner">
            Invitation à la table <b>{invited}</b> : choisis ton pseudo et entre !
          </div>
        )}
        <label className="field-label" htmlFor="pseudo">
          Ton pseudo
        </label>
        <input
          id="pseudo"
          className="input input-lg"
          placeholder="Ex. Seconde"
          value={profile.name}
          maxLength={16}
          autoComplete="nickname"
          onChange={(e) => setProfile({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && invited) void run('join', () => joinRoom(invited));
          }}
        />
        <span className="field-label" id="avatar-label">
          Ton avatar
        </span>
        <div className="avatar-picker" role="radiogroup" aria-labelledby="avatar-label">
          {AVATARS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={profile.avatar === a} aria-label={AVATAR_LABELS[a]} className={cls('avatar-opt', profile.avatar === a && 'is-on')} onClick={() => setProfile({ avatar: a })}>
              {AVATAR_EMOJI[a]}
            </button>
          ))}
        </div>

        {invited ? (
          <div className="home-actions">
            <Button variant="primary" className="btn-lg" icon={<LogIn size={20} />} disabled={!!busy} onClick={() => run('join', () => joinRoom(invited))}>
              {busy === 'join' ? 'Connexion…' : `Rejoindre la table ${invited}`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                window.history.replaceState(null, '', '/');
                setInvited(null);
              }}
            >
              Créer ma propre table à la place
            </Button>
          </div>
        ) : (
          <div className="home-actions">
            <Button variant="primary" className="btn-lg" icon={<Plus size={20} />} disabled={!!busy} onClick={() => run('create', () => createRoom())}>
              {busy === 'create' ? 'Création…' : 'Créer une table'}
            </Button>
            <div className="join-row">
              <input
                className="input code-input"
                placeholder="CODE"
                value={cleanCode}
                maxLength={4}
                aria-label="Code de la table"
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cleanCode.length === 4) void run('join', () => joinRoom(cleanCode));
                }}
              />
              <Button icon={<LogIn size={18} />} disabled={cleanCode.length !== 4 || !!busy} onClick={() => run('join', () => joinRoom(cleanCode))}>
                Rejoindre
              </Button>
            </div>
            <div className="bots-row">
              <Button className="bots-go" icon={<Bot size={18} />} disabled={!!busy} onClick={() => run('bots', () => createRoom({ bots, autostart: true }))}>
                {busy === 'bots' ? 'Préparation…' : `Jouer contre ${bots} bot${bots > 1 ? 's' : ''}`}
              </Button>
              <div className="stepper" role="group" aria-label="Nombre de bots">
                <button type="button" className="icon-btn" aria-label="Un bot de moins" disabled={bots <= MIN_BOTS} onClick={() => changeBots(-1)}>
                  <Minus size={16} />
                </button>
                <button type="button" className="icon-btn" aria-label="Un bot de plus" disabled={bots >= MAX_BOTS} onClick={() => changeBots(1)}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
        <Button variant="ghost" className="rules-link" icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
          Les règles en 2 minutes
        </Button>
        {conn !== 'online' && (
          <p className="wake-note" role="status">
            <span className="spinner" /> Réveil du serveur… (jusqu'à une minute la première fois)
          </p>
        )}
      </motion.section>

      <footer className="home-foot">
        D'après l'épreuve <i>Time Auction</i> de <i>The Devil's Plan : Death Room</i> (Netflix). Création de fans, non officielle.
      </footer>
    </Backdrop>
  );
}
