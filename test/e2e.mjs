// Test de bout en bout sur le serveur compilé, en mode accéléré (TA_FAST=1 : une minute de réserve devient une seconde).
// Partie 1 : 3 humains (socket.io) + 2 bots, format court ; un spectateur arrive en route, un joueur se déconnecte puis revient.
// Partie 2 : revanche à 8, la table pleine, format moyen.
// Les humains tiennent leur bouton au hasard : ils passent, lâchent, arrivent en retard, tiennent jusqu'à l'éjection.
// À chaque état reçu, on vérifie qu'aucune information cachée ne fuit, ni par son contenu ni par son seul envoi ;
// à la fin, que le tableau dévoilé suit les règles. Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['dist/server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), TA_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (4 min)'), 240_000).unref();

await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('prêt') && resolve()));

// Recopié des règles, pour ne pas dépendre du code testé : enchères et réserve (en dixièmes, divisée par 60 en mode accéléré).
const FORMATS = { court: { rounds: 9, bank: 30 }, moyen: { rounds: 13, bank: 50 }, emission: { rounds: 19, bank: 100 } };
const ME_KEYS = 'bidding,holding,passed,pushed,spent';
const stats = { states: 0, held: 0, passes: 0, late: 0, absent: 0, gestures: 0 };
const rand = (a, b) => a + Math.random() * (b - a);

function client(name, { player = true, avatar = 'chrono' } = {}) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket, view: null, avatar, player, session: null, plans: new Map(), results: new Map(), claims: new Map(), lastGesture: 0, timers: new Set() };
  socket.on('state', (v) => {
    const prev = c.view;
    c.view = v;
    audit(c, prev, v);
    if (c.player) play(c);
  });
  // Une socket perdue ne tient plus rien : on oublie l'état d'avant, et les lâchers prévus.
  socket.on('disconnect', () => {
    c.view = null;
    for (const t of c.timers) clearTimeout(t);
    c.timers.clear();
  });
  c.call = (event, payload = {}) => new Promise((res) => socket.emit(event, payload, res));
  c.reset = () => {
    c.plans.clear();
    c.results.clear();
    c.claims.clear();
  };
  return c;
}

/** Ce que tout le monde voit : la vue sans « me » ni l'heure du serveur. */
const publicPart = (v) => JSON.stringify({ ...v, serverNow: 0, game: v.game ? { ...v.game, me: null } : null });

function audit(c, prev, v) {
  stats.states++;
  const json = JSON.stringify(v);
  for (const word of ['"token":', '"skill', '"releases"', '"autoAt"', '"plans"']) if (json.includes(word)) fail(`la vue de ${c.name} contient ${word}`);
  if (!v.final) for (const word of ['"bids"', '"left"', '"history"']) if (json.includes(word)) fail(`la vue de ${c.name} contient ${word} avant la fin`);
  const g = v.game;
  if (v.phase !== 'playing') {
    if (g) fail('une partie visible hors jeu');
    return;
  }
  if (!g) fail('une partie sans état de jeu');
  const seated = g.order.includes(v.me);
  if (!!g.me !== seated) fail(`${c.name} : « me » ne suit pas le siège`);
  if (g.me && Object.keys(g.me).sort().join(',') !== ME_KEYS) fail(`« me » contient ${Object.keys(g.me)}`);
  // Les voyants ne s'allument que pendant la préparation : ensuite, personne ne sait qui tient encore.
  if (g.stage !== 'ready' && v.players.some((p) => p.ready)) fail(`un voyant allumé pendant ${g.stage}`);
  for (const p of v.players) {
    const sits = g.order.includes(p.id);
    if (sits !== Number.isInteger(p.tokens) || (sits && p.tokens < 0)) fail(`jetons illisibles pour ${p.name}`);
  }
  const done = g.stage === 'result' || g.stage === 'over' ? g.round : g.round - 1;
  const tokens = v.players.reduce((a, p) => a + (p.tokens ?? 0), 0);
  if (tokens > done) fail(`${tokens} jetons distribués en ${done} enchères`);
  if (!!g.result !== (g.stage === 'result' || g.stage === 'over')) fail(`résultat visible pendant ${g.stage}`);
  if (g.result && g.result.round !== g.round) fail('le résultat affiché n’est pas celui de l’enchère');
  if ((g.startedAt > 0) !== (g.stage === 'auction' || g.stage === 'result')) fail(`heure de départ visible pendant ${g.stage}`);
  if (g.stage === 'result' && seated) c.results.set(g.round, { ...g.result });
  if (g.me?.spent && g.stage === 'countdown' && !g.me.holding) fail(`${c.name} n'a plus de temps, mais son doigt automatique n'est pas posé`);

  // L'envoi même d'un état trahit un geste caché : pendant le compte à rebours et l'enchère, un état sans rien de neuf
  // pour tout le monde ne doit arriver qu'à celui qui vient d'agir, ou dont le bouton vient d'être éjecté.
  const pg = prev?.game;
  if (pg && prev.phase === 'playing' && pg.round === g.round && pg.stage === g.stage && (g.stage === 'countdown' || g.stage === 'auction')) {
    if (publicPart(prev) === publicPart(v)) {
      const justPushed = g.me?.pushed && !pg.me?.pushed;
      if (Date.now() - c.lastGesture > 500 && !justPushed) fail(`${c.name} a reçu pendant ${g.stage} un état qui ne lui apprend rien : un geste caché a été diffusé`);
    }
  }
}

/** Le plan d'un humain pour une enchère : tenir et lâcher, passer, ne pas poser le doigt, arriver en retard, tenir jusqu'au bout. */
function pickPlan() {
  const r = Math.random();
  if (r < 0.12) return { kind: 'pass' };
  if (r < 0.2) return { kind: 'absent' };
  if (r < 0.27) return { kind: 'late', dur: rand(0, 900) };
  if (r < 0.34) return { kind: 'push' };
  return { kind: 'bid', dur: rand(20, 1300) };
}

/** Un geste pour l'enchère où il a été décidé : un lâcher prévu qui part après la fin de l'enchère ne doit pas toucher la suivante. */
function gesture(c, down, round, extra = {}) {
  if (!c.view?.game || !c.socket.connected) return false;
  c.lastGesture = Date.now();
  stats.gestures++;
  c.socket.emit('hold', { down, round, ...extra }, (res) => {
    if (!res?.ok) fail(`${c.name} : geste refusé (${res?.error})`);
  });
  return true;
}

function later(c, ms, fn) {
  const t = setTimeout(() => {
    c.timers.delete(t);
    fn();
  }, ms);
  c.timers.add(t);
}

function play(c) {
  const v = c.view;
  const g = v?.game;
  if (!v || v.phase !== 'playing' || !g?.me || g.me.spent) return;
  let plan = c.plans.get(g.round);
  if (!plan) {
    plan = pickPlan();
    c.plans.set(g.round, plan);
  }
  if (g.stage === 'ready') {
    if ((plan.kind === 'absent' || plan.kind === 'late') && !plan.counted) {
      plan.counted = true;
      stats[plan.kind]++;
    }
    if (plan.kind !== 'absent' && plan.kind !== 'late' && !g.me.holding && !plan.down) plan.down = gesture(c, true, g.round);
    return;
  }
  if (g.stage === 'countdown') {
    if (plan.kind === 'late' && !plan.down && !g.me.passed) plan.down = gesture(c, true, g.round);
    if (plan.kind === 'pass' && g.me.holding && !plan.up) {
      plan.up = true;
      stats.passes++;
      later(c, rand(0, 120), () => gesture(c, false, g.round));
    }
    return;
  }
  if (g.stage === 'auction' && g.me.bidding && g.me.holding && !plan.timer && (plan.kind === 'bid' || plan.kind === 'late')) {
    // La durée tenue se mesure ici, depuis l'arrivée du départ : comme sur un téléphone.
    plan.timer = true;
    const t0 = performance.now();
    later(c, plan.dur, () => {
      const held = Math.floor((performance.now() - t0) / 100);
      if (gesture(c, false, g.round, { held })) {
        c.claims.set(g.round, held);
        stats.held++;
      }
    });
  }
}

const waitPhase = (c, phase) =>
  new Promise((resolve) => {
    const check = setInterval(() => {
      if (c.view?.phase === phase) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le tableau dévoilé : chaque enchère suit les règles, les jetons et les temps restants en découlent, le classement aussi. */
function checkFinal(final, players, format, humans) {
  const F = FORMATS[format];
  if (!final || final.players.length !== players) fail(`table finale incomplète (${final?.players.length})`);
  if (final.format !== format || final.rounds !== F.rounds || final.bank !== F.bank) fail(`format final faux : ${final.format}, ${final.rounds}, ${final.bank}`);
  if (final.history.length !== F.rounds) fail(`${final.history.length} enchères dévoilées sur ${F.rounds}`);
  const ids = new Set(final.players.map((p) => p.id));
  const bank = new Map([...ids].map((id) => [id, F.bank]));
  const tokens = new Map([...ids].map((id) => [id, 0]));
  const kinds = { won: 0, tie: 0, nobody: 0, pushed: 0 };
  final.history.forEach((h, i) => {
    if (h.round !== i + 1) fail('enchères dévoilées dans le désordre');
    const seen = new Set();
    for (const b of h.bids) {
      if (!ids.has(b.id) || seen.has(b.id)) fail(`enchère ${h.round} : enchérisseur inconnu ou en double`);
      seen.add(b.id);
      if (!Number.isInteger(b.time) || b.time < 1) fail(`enchère ${h.round} : mise de ${b.time}`);
      if (b.time > bank.get(b.id)) fail(`enchère ${h.round} : ${b.time} misés avec ${bank.get(b.id)} en réserve`);
      if (b.pushed !== (b.time === bank.get(b.id))) fail(`enchère ${h.round} : éjection mal marquée`);
    }
    const top = h.bids.length ? Math.max(...h.bids.map((b) => b.time)) : 0;
    const best = h.bids.filter((b) => b.time === top);
    const kind = !h.bids.length ? 'nobody' : best.length === 1 ? 'won' : 'tie';
    if (h.kind !== kind || h.time !== top || h.winner !== (kind === 'won' ? best[0].id : null)) fail(`enchère ${h.round} mal adjugée : ${JSON.stringify(h)}`);
    kinds[kind]++;
    kinds.pushed += h.bids.filter((b) => b.pushed).length;
    for (const b of h.bids) bank.set(b.id, bank.get(b.id) - b.time);
    if (kind === 'won') tokens.set(h.winner, tokens.get(h.winner) + 1);
  });
  for (const p of final.players) {
    if (p.tokens !== tokens.get(p.id)) fail(`${p.name} : ${p.tokens} jetons au lieu de ${tokens.get(p.id)}`);
    if (p.left !== bank.get(p.id)) fail(`${p.name} : ${p.left} restants au lieu de ${bank.get(p.id)}`);
  }
  const rows = final.players;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.tokens < b.tokens || (a.tokens === b.tokens && a.left < b.left)) fail('classement mal rangé');
    const tied = a.tokens === b.tokens && a.left === b.left;
    if (tied ? b.place !== a.place : b.place !== i + 1) fail(`places incohérentes : ${rows.map((x) => x.place)}`);
  }
  if (rows[0].place !== 1 || rows.some((p) => p.winner !== (p.place === 1))) fail('gagnants mal marqués');

  // Ce que chaque humain a vu et fait colle au tableau dévoilé.
  for (const c of humans) {
    const id = c.session?.playerId;
    if (!id || !ids.has(id)) continue;
    for (const h of final.history) {
      const seen = c.results.get(h.round);
      if (seen && (seen.kind !== h.kind || seen.winner !== h.winner || seen.time !== h.time)) fail(`${c.name} a vu un autre résultat à l'enchère ${h.round}`);
      const mine = h.bids.find((b) => b.id === id);
      const plan = c.plans.get(h.round);
      if (plan && (plan.kind === 'pass' || plan.kind === 'absent') && mine) fail(`${c.name} a passé l'enchère ${h.round}, mais a payé ${mine.time}`);
      const claim = c.claims.get(h.round);
      if (claim !== undefined && mine && !mine.pushed && mine.time !== Math.max(1, claim)) fail(`${c.name} a tenu ${claim} à l'enchère ${h.round}, compté ${mine.time}`);
    }
  }
  return { winner: rows[0], kinds };
}

// ── Partie 1 : 3 humains + 2 bots, format court ──
const host = client('Ana');
await new Promise((r) => host.socket.on('connect', r));
if ((await host.call('hold', { down: true, round: 1 })).ok) fail('un geste accepté sans table');
const created = await host.call('room:create', { name: 'Ana', avatar: 'chrono', bots: 2 });
if (!created.ok) fail(`création : ${created.error}`);
host.session = created.data;
const code = created.data.code;
const bob = client('Bob', { avatar: 'pendule' });
const chloe = client('Chloé', { avatar: 'hibou' });
await Promise.all([bob, chloe].map((c) => new Promise((r) => c.socket.on('connect', r))));
for (const c of [bob, chloe]) {
  const res = await c.call('room:join', { code, name: c.name, avatar: c.avatar });
  if (!res.ok) fail(`arrivée de ${c.name} : ${res.error}`);
  c.session = res.data;
}
if ((await host.call('hold', { down: true, round: 1 })).ok) fail('un geste accepté dans le salon');
if (!(await host.call('room:settings', { format: 'emission' })).ok) fail('réglages refusés');
await host.call('room:settings', { format: 'éternité' });
await pause(100);
if (host.view.settings.format !== 'emission') fail('un format inconnu a été accepté');
if ((await bob.call('room:settings', { format: 'court' })).ok) fail('un invité a changé les réglages');
if ((await bob.call('game:start')).ok) fail('un invité a lancé la partie');
await host.call('room:settings', { format: 'court' });
// Une réaction passe d'un joueur à l'autre.
const heard = new Promise((r) => bob.socket.once('emote', r));
host.socket.emit('emote', { emoji: 'Je tiens !' });
if ((await heard).emoji !== 'Je tiens !') fail('réaction perdue');
const start = await host.call('game:start');
if (!start.ok) fail(`lancement : ${start.error}`);

// Un spectateur arrive en cours de partie : il voit le tableau, sans siège ni jetons, et ne peut pas enchérir.
await pause(700);
const watcher = client('Dora', { player: false, avatar: 'cloche' });
await new Promise((r) => watcher.socket.on('connect', r));
const joined = await watcher.call('room:join', { code, name: 'Dora', avatar: 'cloche' });
if (!joined.ok) fail(`spectateur : ${joined.error}`);
watcher.session = joined.data;
await pause(100);
const dora = watcher.view.players.find((p) => p.name === 'Dora');
if (dora?.status !== 'spectator' || dora.seat !== null || dora.tokens !== null) fail('la retardataire devrait regarder');
if (!watcher.view.game || watcher.view.game.me !== null) fail('le spectateur ne voit pas la partie, ou s’y voit assis');
watcher.lastGesture = Date.now();
if ((await watcher.call('hold', { down: true, round: watcher.view.game.round })).ok) fail('le spectateur a enchéri');

// Bob se déconnecte un moment (son doigt est levé à l'instant), puis revient avec sa session.
await pause(1200);
bob.socket.disconnect();
await pause(900);
bob.socket.connect();
await new Promise((r) => bob.socket.on('connect', r));
const back = await bob.call('room:join', { code, playerId: bob.session.playerId, token: bob.session.token, resumeOnly: true });
if (!back.ok) fail(`retour de Bob : ${back.error}`);
const intruder = await chloe.call('room:join', { code, playerId: bob.session.playerId, token: 'faux', resumeOnly: true });
if (intruder.ok) fail('une session volée a été acceptée');

await waitPhase(host, 'finished');
const humans1 = [host, bob, chloe];
const r1 = checkFinal(host.view.final, 5, 'court', humans1);
if (!host.view.players.some((p) => p.wins === 1)) fail('la victoire n’est pas comptée');
for (const c of [bob, chloe, watcher]) if (JSON.stringify(c.view.final) !== JSON.stringify(host.view.final)) fail(`${c.name} ne voit pas le même tableau final`);

// ── Partie 2 : revanche à 8, la table pleine (Dora s'assoit, trois bots de plus), format moyen ──
if ((await bob.call('game:restart')).ok) fail('un invité a relancé la partie');
if (!(await host.call('game:restart')).ok) fail('revanche refusée');
await pause(150);
if (host.view.phase !== 'lobby' || host.view.final) fail('la revanche ne ramène pas au salon');
for (const c of [host, bob, chloe, watcher]) c.reset();
watcher.player = true;
for (let i = 0; i < 2; i++) if (!(await host.call('room:addBot')).ok) fail('ajout de bot refusé');
// L'accusé de réception arrive avant le nouvel état : on laisse le temps à la vue de suivre.
await pause(150);
const seatedNow = host.view.players.filter((p) => p.status !== 'spectator').length;
if (seatedNow !== 8) fail(`8 joueurs attendus au salon, ${seatedNow} trouvés`);
if ((await host.call('room:addBot')).ok) fail('un neuvième joueur a été accepté');
if (!(await host.call('room:settings', { format: 'moyen' })).ok) fail('réglages de la revanche refusés');
if (!(await host.call('game:start')).ok) fail('lancement de la revanche refusé');
await pause(50);
if (host.view.game.rounds !== 13 || host.view.game.bank !== 50 || host.view.game.order.length !== 8) fail('mise en place de la revanche fausse');

await waitPhase(host, 'finished');
const r2 = checkFinal(host.view.final, 8, 'moyen', [host, bob, chloe, watcher]);
if (r1.kinds.pushed + r2.kinds.pushed === 0) fail('aucun bouton éjecté en deux parties : suspect');
if (r1.kinds.won + r2.kinds.won === 0) fail('aucun jeton adjugé : suspect');

const line = (r) => `${r.kinds.won} adjugées, ${r.kinds.tie} à égalité, ${r.kinds.nobody} sans preneur, ${r.kinds.pushed} boutons éjectés ; ${r.winner.name} gagne avec ${r.winner.tokens} jeton(s)`;
console.log(`✓ partie 1 (5 joueurs, court) : ${line(r1)}.`);
console.log(`✓ partie 2 (8 joueurs, moyen) : ${line(r2)}.`);
console.log(
  `  Humains : ${stats.held} lâchers mesurés, ${stats.passes} passes, ${stats.late} doigts en retard, ${stats.absent} absences ; ${stats.gestures} gestes, ${stats.states} états vérifiés.`,
);
for (const c of [host, bob, chloe, watcher]) c.socket.close();
server.kill();
process.exit(0);
