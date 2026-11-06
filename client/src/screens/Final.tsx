// Fin de partie : le classement aux jetons puis au temps restant, enfin dévoilé ; puis le grand tableau de chaque enchère,
// avec le temps tenu par chacun, comme à la fin de l'émission. Victoires de la soirée et revanche.
import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import { LogOut, RotateCcw, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { clock, type FinalPlayer, type RoomView } from '../../../shared/protocol';
import { Avatar, Backdrop, Button, Logo, NixieClock, Tokens, seatColor } from '../components/Ui';
import { sfx } from '../lib/sound';
import { FORMAT_LABEL, listing, placeLabel } from '../lib/text';
import { cls, plural, reducedMotion } from '../lib/util';
import { leaveRoom, send } from '../net';

export function Final({ view }: { view: RoomView }) {
  const final = view.final!;
  const isHost = view.hostId === view.me;
  const mine = final.players.find((p) => p.id === view.me);
  const winners = final.players.filter((p) => p.winner);
  const good = !!mine?.winner;
  const once = useRef(false);
  const byId = new Map(final.players.map((p) => [p.id, p]));
  const last = Math.max(...final.players.map((p) => p.place));

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    sfx.fanfare(good);
    if (reducedMotion() || !good) return;
    const t = window.setTimeout(() => {
      void confetti({ particleCount: 160, spread: 100, origin: { y: 0.3 }, colors: ['#ff8a2b', '#ffd2a0', '#c9a25a', '#f3e7d3', '#e2482f'], shapes: ['circle', 'square'], scalar: 0.9, disableForReducedMotion: true });
    }, 400);
    return () => window.clearTimeout(t);
  }, [good]);

  const who = (p: FinalPlayer | undefined) => (!p ? '?' : p.id === view.me ? 'Toi' : p.name);
  let title: string;
  if (winners.length > 1) title = winners.some((w) => w.id === view.me) ? 'Victoire partagée !' : `Égalité : ${listing(winners.map((w) => w.name))}`;
  else if (good) title = 'Tu gagnes !';
  else title = `${winners[0]?.name ?? '?'} gagne`;
  const top = winners[0];
  let reason = '';
  if (top) {
    const second = final.players.find((p) => !p.winner);
    const byTime = second && second.tokens === top.tokens;
    reason = winners.length > 1 ? `${plural(top.tokens, 'jeton')} chacun, et le même temps restant.` : `${plural(top.tokens, 'jeton')}${byTime ? `, départagé au temps restant (${clock(top.left)})` : ''}.`;
  }

  return (
    <Backdrop quiet>
      <div className="final">
        <header className="final-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <motion.section className={cls('final-hero', good && 'is-good')} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
          <span className="eyebrow">
            Partie terminée · {FORMAT_LABEL[final.format]}, {final.rounds} enchères
          </span>
          <h1>{title}</h1>
          <p className="final-reason">{reason}</p>
        </motion.section>

        <section className="panel final-table">
          <h3>Le classement</h3>
          <p className="muted small">Le plus de jetons gagne ; à égalité, le plus de temps restant. Les temps restants, enfin dévoilés :</p>
          <ol className="final-list">
            {final.players.map((p, i) => (
              <motion.li
                key={p.id}
                className={cls('final-row', p.winner && 'is-winner', p.id === view.me && 'is-me', p.place === last && final.players.length > 2 && 'is-last')}
                style={{ ['--seat' as string]: seatColor(p.seat) }}
                initial={{ x: -14, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.25 + i * 0.07 }}
              >
                <span className="final-place">{placeLabel(p.place)}</span>
                <span className="final-who">
                  <b>
                    <span className="final-name">
                      <Avatar avatar={p.avatar} /> {who(p)}
                    </span>
                    {p.wins > 0 && (
                      <span className="final-wins" title="Parties gagnées à cette table, ce soir">
                        <Trophy size={12} aria-hidden /> {p.wins}
                      </span>
                    )}
                  </b>
                  <small>
                    reste <NixieClock tenths={p.left} size="sm" dim={p.left === 0} label={`Temps restant : ${clock(p.left)}`} />
                  </small>
                </span>
                <Tokens n={p.tokens} className="final-tokens" />
              </motion.li>
            ))}
          </ol>
          <p className="muted small">Le trophée compte les parties gagnées à cette table.</p>
        </section>

        <section className="panel reveal">
          <h3>Le tableau complet</h3>
          <p className="muted small">Qui a tenu combien de temps, enchère par enchère. Les autres avaient passé.</p>
          <ol className="reveal-list">
            {final.history.map((h, i) => {
              const bids = [...h.bids].sort((a, b) => b.time - a.time);
              const passed = final.players.length - bids.length;
              return (
                <motion.li key={h.round} className={cls('reveal-row', `is-${h.kind}`)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + Math.min(i, 12) * 0.04 }}>
                  <span className="reveal-num">{h.round}</span>
                  <span className="reveal-bids">
                    {bids.length === 0 && <span className="reveal-none">Personne n’a enchéri</span>}
                    {bids.map((b) => {
                      const p = byId.get(b.id);
                      const won = h.kind === 'won' && h.winner === b.id;
                      const tied = h.kind === 'tie' && b.time === h.time;
                      return (
                        <span key={b.id} className={cls('reveal-bid', won && 'is-won', tied && 'is-tied', b.pushed && 'is-pushed')} style={{ ['--seat' as string]: seatColor(p?.seat) }}>
                          <Avatar avatar={p?.avatar ?? ''} />
                          <span className="reveal-name">{who(p)}</span>
                          <b>{clock(b.time)}</b>
                          {b.pushed && <i title="Temps épuisé : bouton éjecté">éjecté</i>}
                        </span>
                      );
                    })}
                    {h.kind === 'tie' && <span className="reveal-note">égalité au dixième, jeton perdu</span>}
                    {passed > 0 && bids.length > 0 && <span className="reveal-note">{passed} {passed > 1 ? 'ont passé' : 'a passé'}</span>}
                  </span>
                </motion.li>
              );
            })}
          </ol>
        </section>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={<RotateCcw size={20} />} onClick={() => void send('game:restart')}>
              Rejouer
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> En attente de la revanche…
            </div>
          )}
        </div>
      </div>
    </Backdrop>
  );
}
