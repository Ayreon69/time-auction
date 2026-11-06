# Time Auction

**Quelques minutes chacun pour toute la partie. On mise du temps en gardant le doigt appuyé : le dernier à lâcher gagne le jeton, et tout le monde paie le temps qu'il a tenu.**

👉 **Jouer : https://time-auction-n8jc.onrender.com** (la première ouverture peut prendre jusqu'à une minute, le temps que le serveur gratuit se réveille)

Jeu d'enchères multijoueur en temps réel, à jouer entre amis depuis un navigateur, sur téléphone ou ordinateur, sans compte ni installation.
D'après *Time Auction*, l'épreuve de la prison du 2e jour de *The Devil's Plan : Death Room* (saison 2, Netflix). Création de fans, non officielle, avec ses propres visuels.

## Règles en bref

- De 2 à 8 joueurs. Chacun reçoit **une réserve de temps pour toute la partie**, et il y a autant d'enchères que prévu par le format.
- **Une enchère** :
  1. tout le monde pose le doigt sur son bouton ;
  2. un compte à rebours de **5 secondes** commence : lever le doigt pendant ce temps, c'est **passer**, sans rien payer ;
  3. à zéro, le temps file pour ceux qui tiennent encore, et le tableau l'affiche ;
  4. quand le dernier lâche, le tableau s'arrête : **il gagne un jeton**.
- **Chacun paie le temps qu'il a tenu**, gagnant ou non. Le temps compte au dixième de seconde.
- Si les derniers lâchent **au même dixième**, personne ne gagne : le jeton est perdu.
- On ne peut pas miser plus que ce qu'il reste : quand la réserve est vide, **le bouton saute**, et l'on ne peut plus enchérir.
- **Ce que l'on sait** : les jetons de chacun, et après chaque enchère le gagnant et son temps, rien d'autre. **Son propre temps restant ne s'affiche jamais** : on retient ce qu'on dépense.
- Après la dernière enchère, **le plus de jetons gagne**, puis le plus de temps restant ; à égalité parfaite, la victoire est partagée. Tout est alors dévoilé : les temps restants, et qui a tenu combien à chaque enchère.

Les règles suivent l'épreuve de l'émission : le doigt sur le bouton, le compte à rebours pendant lequel on peut passer, le temps payé par tous les enchérisseurs, le jeton perdu à égalité, le bouton qui saute quand le temps est épuisé, le temps restant caché, le seul gagnant annoncé, et le classement aux jetons puis au temps restant.

Sont des choix de ce jeu :

- **Trois formats**, réglés par l'hôte : **court** (9 enchères, 3 minutes chacun, environ 15 minutes de partie), **moyen** (13 enchères, 5 minutes) et **émission** (19 enchères, 10 minutes chacun, comme dans l'émission : compter 35 à 40 minutes).
- **De 2 à 8 joueurs** ; ils étaient 6 dans l'émission.
- **La préparation** : le compte à rebours part dès que tout le monde a le doigt posé, ou au bout de 15 secondes ; un doigt absent à ce moment-là passe l'enchère.
- **Personne ne voit qui tient encore** une fois le compte à rebours lancé, ni qui a passé, ni qui n'a plus de temps : le bouton d'un joueur à sec se pose tout seul pendant la préparation, au même rythme qu'une main.
- **Chaque téléphone mesure lui-même le temps tenu**, depuis la fin de son propre compte à rebours : la qualité de la connexion ne compte pas. Le serveur vérifie que la durée annoncée colle à ce qu'il a vu passer.
- **Un joueur absent plus de 20 secondes est remplacé par le pilote automatique** jusqu'à son retour ; une connexion perdue en pleine enchère lâche le bouton à cet instant.

## Les bots

Ils ne savent que ce qu'un joueur saurait : les jetons de chacun, les gagnants et leurs temps. Ils en déduisent le plafond de chaque adversaire (la réserve de départ moins le temps de ses victoires), mais pas ce que les autres ont payé en perdant.

- Ils visent un nombre de jetons (leur part de la partie, un de plus que le meneur pour les « retors ») et enchérissent d'autant plus souvent que le temps presse ;
- leur mise suit le prix des dernières enchères gagnées, avec un peu d'oubli, sans dépasser ce que leur budget permet ;
- quand un adversaire ne peut plus suivre, ils tiennent juste au-dessus de son plafond, pour un jeton sûr ;
- à la dernière enchère, celui qui est derrière met tout ce qui lui reste ;
- de temps en temps, ils tentent une enchère de quelques dixièmes, pour un jeton bon marché.

Les « novices » oublient plus et calculent moins, les « retors » visent plus haut. Sur 200 à 400 parties par table (`npx tsx test/sim.ts 300 6 moyen`) :

| Joueurs | Format | Temps d'enchères | Bot « habile » contre le hasard | Hasard | Novice / habile / retors entre bots |
|---|---|---|---|---|---|
| 4 | court | 6,8 min | 71 % | 25 % | 14 / 35 / 49 % |
| 6 | court | 9,5 min | 64 % | 17 % | 22 / 35 / 41 % |
| 8 | court | 10,8 min | 77 % | 13 % | 14 / 28 / 29 % |
| 6 | moyen | 15,9 min | 83 % | 17 % | 10 / 29 / 38 % |
| 6 | émission | 33,5 min | 91 % | 17 % | 7 / 28 / 38 % |

Le temps d'enchères ne compte que le temps qui file ; la préparation, le compte à rebours et le résultat ajoutent une douzaine de secondes par enchère. Comme dans l'émission, la plupart des joueurs finissent à sec.

## Fonctionnalités

- Tables privées avec code à 4 lettres, lien d'invitation, partage natif et QR code
- Partie contre 1 à 7 bots en un clic
- Un seul geste : un gros bouton à tenir, au doigt sur téléphone, à la souris ou à la barre Espace sur ordinateur. Lever le doigt pendant le compte à rebours, c'est passer
- Un tableau à tubes Nixie : compte à rebours en gros chiffre, temps qui file au dixième, voyants des doigts posés pendant la préparation, ton propre temps rappelé un instant quand tu lâches
- Tampons « Adjugé », « Jeton perdu » et « Sans preneur », confettis quand tu remportes un jeton ; le bouton qui saute quand ton temps est épuisé
- Fin de partie : le classement avec les temps restants enfin dévoilés, puis le tableau complet de chaque enchère (qui a tenu combien, qui a sauté), victoires de la soirée, revanche en un clic
- Réactions et phrases toutes faites (« Je tiens ! », « Bluff », « Trop cher »), règles consultables en jeu
- Reprise automatique après une coupure, pilote automatique, spectateurs
- Sons synthétisés et vibrations à chaque seconde, animations réduites si le système le demande

## Développement

```bash
npm install
npm run dev:server   # serveur temps réel sur http://localhost:3240
npm run dev:client   # interface sur http://localhost:5203
npm test             # enchères, passes, égalités, bouton qui saute, classement, bots
npm run build && npm run e2e   # parties complètes avec de vrais clients, et chasse aux fuites d'information
npx tsx test/sim.ts 200 6 court   # force des bots : 200 parties à 6, format court
```

`TA_FAST=1` divise les réserves par 60 et raccourcit la préparation, le compte à rebours et le résultat (tests locaux uniquement).

## Architecture

- `shared/` : contrat client/serveur, formats, horloge au dixième
- `server/` : Express + Socket.IO, moteur de partie (`game.ts`), bots (`bots.ts`), table, horloge des enchères et minuteries (`room.ts`). Le serveur fait autorité : il éjecte les boutons, désigne le gagnant, et chacun ne reçoit que sa vue. Pendant le compte à rebours et l'enchère, un geste n'est renvoyé qu'à son auteur : même l'arrivée d'un message chez les autres trahirait que quelqu'un a lâché
- `client/` : React + Vite + Framer Motion. Les tubes Nixie sont dans `components/Ui.tsx`, la table, le bouton et la mesure du temps tenu dans `screens/Table.tsx`
- Déploiement : un seul service Node (`npm ci && npm run build`, puis `npm start`)
