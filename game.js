/* =====================================================================
   DUEL DE BANDES - prototype
   Partie 1 : LOGIQUE (règles + état), aucune manipulation du DOM.
   Partie 2 : AFFICHAGE (DOM, événements).
   Joueurs : 0 = J1 (camp du bas), 1 = J2 (camp du haut).
   ===================================================================== */

/* ---------------------------------------------------------------------
   PARTIE 1 : LOGIQUE
   --------------------------------------------------------------------- */
const HAND_SIZE = 10;
const START_FRONT = 4; // "frontière" = bande sur laquelle joue J1 ; J2 joue sur frontière-1
const MAX_FIELD = 4;   // cartes max sur le terrain par joueur (carte conservée comprise)
const J1_WINS_AT = 1;  // J1 atteint la bande 1
const J2_WINS_AT = 7;  // J2 atteint la bande 6 (donc J1 recule à la bande 7)

/** Tire une valeur 1..10 selon les poids (tableau de 10 nombres). */
function drawValue(weights) {
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) { weights = weights.map(() => 1); total = weights.length; }
  let r = Math.random() * total;
  for (let i = 0; i < 10; i++) {
    r -= weights[i];
    if (r < 0) return i + 1;
  }
  return 10;
}

function dealHand(weights) {
  const hand = [];
  for (let i = 0; i < HAND_SIZE; i++) hand.push(drawValue(weights));
  return hand.sort((a, b) => a - b);
}

/** Crée l'état d'une nouvelle partie. */
function newGame(weights, firstPlayer) {
  return {
    weights,
    front: START_FRONT,
    hands: [dealHand(weights), dealHand(weights)],
    played: [[], []],      // cartes posées pendant la manche
    passed: [false, false],// a passé (et n'a pas rejoué depuis)
    keptStart: [false, false], // true si la carte du terrain est une carte conservée
    round: 1,
    starter: firstPlayer,  // qui commence la manche en cours
    active: firstPlayer,
    phase: 'play',         // 'play' | 'roundEnd' | 'gameOver'
    result: null,          // {winner: 0|1|null, reason}
    gameWinner: null,
  };
}

const total = (s, p) => s.played[p].reduce((a, b) => a + b, 0);
const other = p => 1 - p;

/** Bande occupée par un joueur (1..6, hors plateau possible aux extrêmes). */
const bandOf = (s, p) => (p === 0 ? s.front : s.front - 1);

/** Termine la manche : winner = 0|1 ou null (nulle). */
function endRound(s, winner, reason) {
  s.phase = 'roundEnd';
  s.result = { winner, reason };
}

/** Un joueur ne peut plus poser s'il n'a plus de cartes en main ou si son terrain est plein. */
const isBlocked = (s, p) => s.hands[p].length === 0 || s.played[p].length >= MAX_FIELD;

/** Un joueur bloqué et strictement derrière perd automatiquement (il devrait passer). */
function checkAutoLoss(s) {
  for (const p of [0, 1]) {
    if (isBlocked(s, p) && total(s, p) < total(s, other(p))) {
      const why = s.hands[p].length === 0 ? "n'a plus de cartes" : `a atteint la limite de ${MAX_FIELD} cartes`;
      endRound(s, other(p), `J${p + 1} ${why} et est derrière.`);
      return;
    }
  }
}

/** Le joueur actif pose la carte d'indice idx. Retourne false si la pose est refusée. */
function playCard(s, idx) {
  if (s.phase !== 'play') return false;
  const p = s.active;
  if (s.played[p].length >= MAX_FIELD) return false; // terrain plein (carte conservée comprise)
  const [value] = s.hands[p].splice(idx, 1);
  s.played[p].push(value);
  s.passed[p] = false; // il a rejoué : son passage n'est plus valable
  checkAutoLoss(s);
  return true;
}

/** Le joueur actif passe. */
function passTurn(s) {
  if (s.phase !== 'play') return;
  const p = s.active, o = other(p);
  const mine = total(s, p), theirs = total(s, o);
  if (mine < theirs) {
    endRound(s, o, `J${p + 1} passe en étant derrière.`);
  } else if (mine === theirs && s.passed[o]) {
    endRound(s, null, 'Les deux joueurs passent à égalité.');
  } else {
    s.passed[p] = true;
    s.active = o; // devant ou à égalité : l'adversaire continue
    checkAutoLoss(s);
  }
}

/** Avance la frontière de n crans en faveur de p, puis teste la victoire. */
function advance(s, p, n) {
  s.front += (p === 0 ? -n : n);
  if (s.front <= J1_WINS_AT) s.gameWinner = 0;
  else if (s.front >= J2_WINS_AT) s.gameWinner = 1;
}

/**
 * Applique le résultat de la manche, gère les cartes épuisées et prépare la suivante.
 * Retourne un texte d'information (ou '') sur les cartes épuisées.
 */
function nextRound(s) {
  const { winner } = s.result;
  const prevPlayed = s.played;
  let notice = '';

  if (winner !== null) advance(s, winner, 1);

  if (s.gameWinner === null) {
    const e0 = s.hands[0].length === 0, e1 = s.hands[1].length === 0;
    if (e0 && e1) {
      notice = 'Les deux joueurs sont à court de cartes : nouvelles mains de 10 cartes.';
    } else if (e0 || e1) {
      const winnerP = e0 ? 1 : 0;
      const n = s.hands[winnerP].length;
      s.hands[winnerP] = []; // cartes consommées
      advance(s, winnerP, n);
      notice = `J${(e0 ? 0 : 1) + 1} n'a plus de cartes : J${winnerP + 1} joue ses ${n} cartes restantes et avance de ${n} cran(s).`;
    }
    if (s.gameWinner === null && (e0 || e1)) {
      s.hands = [dealHand(s.weights), dealHand(s.weights)];
      notice += ' Nouvelles mains de 10 cartes.';
    }
  }

  // Le gagnant commence ; après une nulle, l'autre joueur que le précédent starter.
  s.starter = winner !== null ? winner : other(s.starter);
  s.active = s.starter;
  // Seule la dernière carte posée par le gagnant reste (nulle : rien ne reste).
  // Les cartes sont rangées par joueur, donc elle suit le gagnant dans sa nouvelle bande.
  s.played = [[], []];
  if (winner !== null && prevPlayed[winner].length > 0) {
    s.played[winner] = [prevPlayed[winner][prevPlayed[winner].length - 1]];
  }
  s.passed = [false, false];
  s.keptStart = [winner === 0 && s.played[0].length === 1, winner === 1 && s.played[1].length === 1];
  s.round++;
  s.result = null;
  s.phase = s.gameWinner === null ? 'play' : 'gameOver';
  return notice;
}

/* ---------------------------------------------------------------------
   PARTIE 2 : AFFICHAGE
   --------------------------------------------------------------------- */
const $ = id => document.getElementById(id);
let state = null;       // état de la partie en cours
let weights = Array(10).fill(5);
let handHidden = true;  // main cachée tant que l'appareil n'a pas été passé
let message = '';
let online = null;      // null = mode local ; sinon {role, me, ...} (voir network.js)
let overlayKind = '';   // type de l'overlay affiché (pour les synchros réseau)
let overlaySeq = 0;     // change à chaque overlay : invalide les timers périmés

/* ----- Menu ----- */
function buildSliders() {
  const box = $('sliders');
  box.innerHTML = '';
  weights.forEach((w, i) => {
    const line = document.createElement('div');
    line.className = 'slider-line';
    line.innerHTML = `<span class="lbl">${i + 1}</span>
      <input type="range" min="0" max="10" value="${w}">
      <span class="pct"></span>`;
    line.querySelector('input').addEventListener('input', e => {
      weights[i] = +e.target.value;
      updatePercents();
    });
    box.appendChild(line);
  });
  updatePercents();
}

function updatePercents() {
  const sum = weights.reduce((a, b) => a + b, 0);
  document.querySelectorAll('.slider-line').forEach((line, i) => {
    line.querySelector('input').value = weights[i];
    line.querySelector('.pct').textContent = (sum ? Math.round(100 * weights[i] / sum) : 10) + ' %';
  });
}

function showScreen(name) {
  ['menu', 'game', 'online'].forEach(id => $(id).classList.toggle('hidden', id !== name));
}

/* ----- Overlay ----- */
function showOverlay(html, buttons, kind = '') {
  const box = $('overlay-box');
  box.innerHTML = html;
  buttons.forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'primary';
    b.onclick = () => { hideOverlay(); fn(); };
    box.appendChild(b);
  });
  overlayKind = kind;
  overlaySeq++;
  $('overlay').classList.remove('hidden');
}
function hideOverlay() {
  overlayKind = '';
  overlaySeq++;
  $('overlay').classList.add('hidden');
}

/* ----- Démarrage ----- */
/** Lancer de pièce animé. onDone : appelé au clic sur « Continuer » (ou fermeture auto si auto). */
function showCoin(first, onDone, auto, label) {
  showOverlay(`<p>Tirage au sort du premier joueur…</p><div class="coin">?</div><p id="coin-res">&nbsp;</p>`, [], 'coin');
  const id = overlaySeq;
  setTimeout(() => {
    if (overlaySeq !== id) return; // l'overlay a changé entre-temps
    $('coin-res').textContent = label;
    document.querySelector('.coin').textContent = first === 0 ? 'J1' : 'J2';
    if (auto) { setTimeout(() => { if (overlaySeq === id) hideOverlay(); }, 1500); return; }
    const b = document.createElement('button');
    b.textContent = 'Continuer';
    b.className = 'primary';
    b.onclick = () => { hideOverlay(); onDone(); };
    $('overlay-box').appendChild(b);
  }, 1500);
}

function startGame() {
  online = null;
  const first = Math.random() < 0.5 ? 0 : 1;
  state = newGame(weights.slice(), first);
  message = '';
  showScreen('game');
  handHidden = true;
  render();
  showCoin(first, askHandoff, false, `J${first + 1} commence !`);
}

/** Écran « passe l'appareil » : cache la main jusqu'à confirmation. */
function askHandoff() {
  handHidden = true;
  render();
  showOverlay(`<p>Passe l'appareil au joueur <b>J${state.active + 1}</b></p>`,
    [['Je suis prêt', () => { handHidden = false; render(); }]]);
}

/* ----- Actions du joueur ----- */
function onCardClick(idx) {
  if (online) return onlineCardClick(idx);
  if (state.phase !== 'play' || handHidden) return;
  if (!playCard(state, idx)) {
    message = `Limite de ${MAX_FIELD} cartes atteinte : tu ne peux plus poser, seulement passer.`;
    render();
    return;
  }
  message = '';
  afterAction();
}

function onPass() {
  if (online) return onlinePass();
  if (state.phase !== 'play' || handHidden) return;
  const before = state.active;
  passTurn(state);
  if (state.phase === 'play') message = `J${before + 1} a passé.`;
  afterAction(before);
}

/** Après chaque action : fin de manche ? changement de joueur ? */
function afterAction(previousActive) {
  if (state.phase === 'roundEnd') {
    handHidden = false; // on montre le résultat, les cartes posées restent visibles
    render();
    const r = state.result;
    const txt = r.winner === null
      ? `<h2>Manche nulle</h2><p>${r.reason}</p>`
      : `<h2>J${r.winner + 1} gagne la manche !</h2><p>${r.reason}</p>`;
    showOverlay(txt, [['Continuer', endOfRound]]);
    return;
  }
  if (previousActive !== undefined && state.active !== previousActive) {
    askHandoff(); // le tour change : on cache la main
  } else {
    render();
  }
}

function endOfRound() {
  const notice = nextRound(state);
  message = '';
  handHidden = true;
  render();
  if (state.phase === 'gameOver') return showGameOver(notice);
  if (notice) showOverlay(`<p>${notice}</p>`, [['Continuer', askHandoff]]);
  else askHandoff();
}

function showGameOver(notice) {
  const w = state.gameWinner;
  showOverlay(`<h2>J${w + 1} remporte la partie !</h2><p>${notice}</p>`, [
    ['Recommencer', startGame],
    ['Menu', () => showScreen('menu')],
  ]);
}

/* ----- Rendu du plateau ----- */
function makeCard(value, cls = '') {
  const c = document.createElement('div');
  c.className = 'card ' + cls;
  if (value !== null) c.textContent = value;
  return c;
}

function render() {
  const s = state;
  // En ligne : on se place toujours du point de vue de son propre joueur
  const me = online ? online.me : s.active, opp = other(me);
  const flip = online && online.me === 1; // l'invité voit son camp en bas
  const myTurn = !online || s.active === me;

  // Bandeau d'infos
  $('infos').innerHTML = `
    <span>Manche ${s.round}</span>
    <span class="active">Tour : J${s.active + 1}${online && myTurn ? ' (toi)' : ''}</span>
    <span>Cartes en main — J1 : ${s.hands[0].length} | J2 : ${s.hands[1].length}</span>
    <span>Totaux — J1 : ${total(s, 0)} | J2 : ${total(s, 1)}</span>
    <span>Terrain — J1 : ${s.played[0].length}/${MAX_FIELD} | J2 : ${s.played[1].length}/${MAX_FIELD}</span>`;

  // Six bandes affichées de haut (1) en bas (6)
  const board = $('board');
  board.innerHTML = '';
  for (let row = 1; row <= 6; row++) {
    const band = flip ? 7 - row : row; // bande réelle affichée sur cette ligne
    const zone = row <= 3 ? row : 7 - row;
    const owner = band <= 3 ? 1 : 0; // J2 a les bandes 1-3, J1 les bandes 4-6
    const occupant = [0, 1].find(p => bandOf(s, p) === band);
    const strip = document.createElement('div');
    strip.className = `strip z${zone}` + (occupant !== undefined ? ' current' : '');
    strip.innerHTML = `<div class="name">Bande ${row}<br>Zone ${zone} — camp J${owner + 1}</div>
      <div class="row-cards"></div><div class="total"></div>`;
    if (occupant !== undefined) {
      const row = strip.querySelector('.row-cards');
      s.played[occupant].forEach((v, i) => {
        // Au début de manche, l'unique carte présente est la carte conservée
        row.appendChild(makeCard(v, s.played[occupant].length === 1 && s.keptStart[occupant] ? 'kept' : ''));
      });
      strip.querySelector('.name').innerHTML += `<br>${s.played[occupant].length}/${MAX_FIELD} cartes`;
      strip.querySelector('.total').textContent = total(s, occupant);
      strip.querySelector('.name').innerHTML += `<br><span class="owner">▶ J${occupant + 1} joue ici</span>`;
    }
    board.appendChild(strip);
  }

  // Main de l'adversaire (cachée) en haut, main du joueur actif en bas
  const oh = $('opp-hand');
  oh.innerHTML = `<span style="margin-right:8px">Main de J${opp + 1} :</span>`;
  s.hands[opp].forEach(() => oh.appendChild(makeCard(null, 'back')));

  const mh = $('my-hand');
  mh.innerHTML = '';
  s.hands[me].forEach((v, i) => {
    if (handHidden) { mh.appendChild(makeCard(null, 'back')); return; }
    const c = makeCard(v, 'v' + v);
    c.onclick = () => onCardClick(i);
    mh.appendChild(c);
  });

  $('message').textContent = [message, online && !myTurn && s.phase === 'play' ? "Tour de l'adversaire" : '']
    .filter(Boolean).join(' — ');
  mh.classList.toggle('wait', !!online && !myTurn);
  $('btn-pass').disabled = handHidden || s.phase !== 'play' || !myTurn;
  // Passer en étant strictement derrière fait perdre la manche : on l'écrit clairement
  $('btn-pass').textContent = total(s, me) < total(s, opp) ? 'Perdre' : 'Passer';
}

/* ----- Branchements ----- */
$('btn-start').onclick = startGame;
$('btn-pass').onclick = onPass;
$('btn-balanced').onclick = () => { weights = Array(10).fill(5); updatePercents(); };
buildSliders();
showScreen('menu');
