// Les règles, lisibles en deux minutes et consultables à tout moment.
import { Brain, Hand, Hourglass, Timer, Trophy } from 'lucide-react';
import { FORMATS, FORMAT_KEYS } from '../../../shared/protocol';
import { FORMAT_LABEL } from '../lib/text';
import { useStore } from '../store';
import { Modal, NixieClock } from './Ui';

export function RulesModal() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Les règles" wide>
      <div className="rules">
        <section className="rule-hero">
          <p>
            Chacun reçoit une <b>réserve de temps</b> pour toute la partie : 10 minutes pour 19 enchères dans l'émission. À chaque enchère, on mise <b>du temps</b> en gardant le doigt sur son bouton. <b>Le dernier à lâcher gagne un jeton</b>. Le plus de jetons gagne la partie.
          </p>
        </section>

        <section>
          <h3>
            <Hand size={18} aria-hidden /> Une enchère
          </h3>
          <ol className="rule-steps">
            <li>
              Tout le monde <b>pose le doigt</b> sur son bouton.
            </li>
            <li>
              Un <b>compte à rebours de 5 secondes</b> commence. Pour <b>passer</b> cette enchère, lève le doigt avant la fin : ça ne coûte rien.
            </li>
            <li>
              À zéro, <b>le temps file</b> pour ceux qui tiennent encore, et le tableau l'affiche. Lâche quand tu veux.
            </li>
            <li>
              Quand le dernier lâche, le tableau s'arrête : <b>il gagne le jeton</b>.
            </li>
          </ol>
          <div className="rule-example" aria-label="Exemple">
            <NixieClock tenths={834} size="sm" />
            <p>
              Léa lâche à 00:52.0, Sam tient jusqu'à 01:23.4 : Sam gagne le jeton. <b>Chacun paie le temps qu'il a tenu</b> : 1 min 23,4 s pour Sam, 52 s pour Léa, même si elle a perdu.
            </p>
          </div>
        </section>

        <section className="rule-split">
          <div className="rule-case">
            <h3>
              <Timer size={18} aria-hidden /> Au dixième près
            </h3>
            <p>
              Le temps compte au dixième de seconde. Si les deux derniers lâchent <b>au même dixième</b>, personne ne gagne : le jeton est perdu.
            </p>
          </div>
          <div className="rule-case">
            <h3>
              <Hourglass size={18} aria-hidden /> Temps épuisé
            </h3>
            <p>
              On ne peut pas miser plus que ce qu'il reste : quand ta réserve est vide, <b>ton bouton saute</b>, et tu ne peux plus enchérir.
            </p>
          </div>
        </section>

        <section className="rule-warn">
          <h3>
            <Brain size={18} aria-hidden /> Ce que l'on sait
          </h3>
          <ul>
            <li>Les jetons de chacun, visibles de tous.</li>
            <li>À la fin de chaque enchère, le gagnant et son temps, et rien d'autre : ni qui a enchéri, ni combien de temps les autres ont tenu.</li>
            <li>
              <b>Ton temps restant ne s'affiche jamais</b>, pas même pour toi : retiens ce que tu dépenses.
            </li>
          </ul>
        </section>

        <section>
          <h3>
            <Trophy size={18} aria-hidden /> La fin
          </h3>
          <p>
            Après la dernière enchère, <b>le plus de jetons gagne</b>. À égalité, celui à qui il reste <b>le plus de temps</b> ; à égalité parfaite, la victoire est partagée. Tout est alors dévoilé : les temps restants, et qui a tenu combien à chaque enchère.
          </p>
        </section>

        <section className="rule-memory">
          <h3>Dans cette version</h3>
          <ul>
            <li>
              De 2 à 8 joueurs. Trois formats :{' '}
              {FORMAT_KEYS.map((f, i) => (
                <span key={f}>
                  {i > 0 && (i === FORMAT_KEYS.length - 1 ? ' et ' : ', ')}
                  <b>{FORMAT_LABEL[f]}</b> ({FORMATS[f].rounds} enchères, {Math.round(FORMATS[f].bank / 600)} min)
                </span>
              ))}
              .
            </li>
            <li>Ton téléphone mesure lui-même le temps que tu tiens : la qualité de ta connexion ne compte pas.</li>
            <li>Sur ordinateur, la barre Espace sert de bouton.</li>
            <li>Un joueur absent plus de 20 secondes est remplacé par le pilote automatique jusqu'à son retour.</li>
          </ul>
        </section>

        <p className="rule-foot">
          D'après <i>Time Auction</i>, épreuve de la prison du 2e jour de <i>The Devil's Plan : Death Room</i> (Netflix). Création de fans, non officielle, avec ses propres visuels.
        </p>
      </div>
    </Modal>
  );
}
