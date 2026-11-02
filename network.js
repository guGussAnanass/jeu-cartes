/* =====================================================================
   MULTIJOUEUR EN LIGNE (PeerJS / WebRTC)
   Chargé après game.js : réutilise ses règles (playCard, passTurn, nextRound…).
   - L'hôte (J1) est l'autorité : il détient l'état complet et valide les actions.
   - L'invité (J2) envoie ses actions et reçoit une « vue » de l'état.
   Partie A : logique réseau pure (sans DOM, testée par test.js).
   Partie B : connexion PeerJS + interface.
   ===================================================================== */

/* ---------------------------------------------------------------------
   PARTIE A : LOGIQUE PURE (aucun DOM)
   --------------------------------------------------------------------- */

/**
 * Vue de l'état pour un joueur : sa main est complète, celle de l'adversaire
 * est remplacée par des null (seul le NOMBRE de cartes est transmis).
 * Les poids de tirage ne sont pas envoyés.
 */
function toView(s, player) {
  const v = JSON.parse(JSON.stringify(s));
  delete v.weights;
  v.hands = v.hands.map((h, p) => (p === player ? h : h.map(() => null)));
  return v;
}

/**
 * Valide puis applique une action d'un joueur sur l'état de l'hôte.
 * Retourne {error} si refusée, {ignore} si sans effet, sinon {msg} (message à afficher).
 */
function applyAction(s, player, act) {
  if (!act || typeof act !== 'object') return { error: 'Action invalide.' };

  if (act.kind === 'continue') { // passer à la manche suivante (après le résumé)
    if (s.phase !== 'roundEnd') return { ignore: true };
    return { msg: nextRound(s) };
  }
  if (s.phase !== 'play') return { error: 'Action impossible pour le moment.' };
  if (s.active !== player) return { error: "Ce n'est pas ton tour." };

  if (act.kind === 'play') {
    if (!Number.isInteger(act.idx) || act.idx < 0 || act.idx >= s.hands[player].length) {
      return { error: 'Cette carte n\'existe pas.' };
    }
    if (s.played[player].length >= MAX_FIELD) {
      return { error: `Limite de ${MAX_FIELD} cartes atteinte : tu ne peux plus poser, seulement passer.` };
    }
    playCard(s, act.idx);
    return { msg: '' };
  }
  if (act.kind === 'pass') {
    passTurn(s);
    return { msg: s.phase === 'play' ? `J${player + 1} a passé.` : '' };
  }
  return { error: 'Action inconnue.' };
}

/* ---------------------------------------------------------------------
   PARTIE B : RÉSEAU + INTERFACE
   --------------------------------------------------------------------- */
const ROOM_PREFIX = 'duelbandes-';                    // évite les collisions sur le serveur public
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
let peer = null, conn = null, joinTimer = null;
let rematchAsked = false;                              // (hôte) l'invité veut rejouer

function makeRoomCode(len = 5) {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, n => CODE_CHARS[n % CODE_CHARS.length]).join('');
}

function setOnlineStatus(text, isError) {
  const el = $('online-status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

/** Ferme proprement connexion et peer, et repasse en mode local. */
function cleanupNet() {
  clearTimeout(joinTimer);
  clearInterval(heartbeat);
  const c = conn, p = peer;
  conn = peer = null;
  online = null;
  if (c) try { c.close(); } catch (e) { /* déjà fermée */ }
  if (p) try { p.destroy(); } catch (e) { /* déjà détruit */ }
}

/** Échec avant le début de partie : retour à l'écran « en ligne » avec un message. */
function failOnline(text) {
  cleanupNet();
  hideOverlay();
  $('room-box').classList.add('hidden');
  showScreen('online');
  setOnlineStatus(text, true);
}

function leaveOnline() {
  cleanupNet();
  hideOverlay();
  handHidden = true;
  showScreen('menu');
}

function sendNet(obj) {
  if (conn && conn.open && online && !online.ended) conn.send(obj);
}

/* ----- Créer une salle (hôte) ----- */
function createRoom(tries = 0) {
  if (typeof Peer === 'undefined') return failOnline('PeerJS n\'a pas pu être chargé (connexion internet requise).');
  cleanupNet();
  const code = makeRoomCode();
  online = { role: 'host', me: 0, code, started: false, ended: false, waiting: false };
  setOnlineStatus('Création de la salle…');
  const p = peer = new Peer(ROOM_PREFIX + code);

  p.on('open', () => {
    if (p !== peer) return;
    $('room-code').textContent = code;
    $('room-box').classList.remove('hidden');
    setOnlineStatus('En attente de l\'adversaire...');
  });
  p.on('connection', c => {
    if (p !== peer) return;
    if (conn) { // une seule place d'invité
      c.on('open', () => { c.send({ type: 'busy' }); setTimeout(() => c.close(), 300); });
      return;
    }
    conn = c;
    c.on('open', () => { if (c === conn) startOnlineMatch(); });
    c.on('data', d => { if (c === conn) onHostData(d); });
    c.on('close', () => onOpponentLeft(c));
    c.on('error', () => onOpponentLeft(c));
  });
  p.on('error', e => {
    if (p !== peer) return;
    if (e.type === 'unavailable-id' && tries < 5) return createRoom(tries + 1); // code déjà pris
    if (online && online.started) return; // partie en cours : la déconnexion est gérée par conn
    failOnline(`Impossible de créer la salle (${e.type}).`);
  });
}

/* ----- Rejoindre une salle (invité) ----- */
function joinRoom() {
  const code = $('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4 || code.length > 6) return setOnlineStatus('Code invalide : entre 4 et 6 caractères.', true);
  if (typeof Peer === 'undefined') return failOnline('PeerJS n\'a pas pu être chargé (connexion internet requise).');
  cleanupNet();
  online = { role: 'guest', me: 1, code, started: false, ended: false, waiting: false };
  $('room-box').classList.add('hidden');
  setOnlineStatus('Connexion en cours…');
  const p = peer = new Peer();

  p.on('open', () => {
    if (p !== peer) return;
    const c = conn = p.connect(ROOM_PREFIX + code, { reliable: true });
    joinTimer = setTimeout(() => failOnline('Connexion impossible (délai dépassé). Vérifie le code.'), 12000);
    c.on('open', () => { clearTimeout(joinTimer); setOnlineStatus('Connecté. En attente du lancement…'); });
    c.on('data', d => { if (c === conn) onGuestData(d); });
    c.on('close', () => onOpponentLeft(c));
    c.on('error', () => onOpponentLeft(c));
  });
  p.on('error', e => {
    if (p !== peer) return;
    if (online && online.started) return;
    failOnline(e.type === 'peer-unavailable'
      ? 'Code invalide : aucune salle trouvée.'
      : `Connexion impossible (${e.type}).`);
  });
}

/* ----- Déconnexion de l'adversaire ----- */
/* Battement de cœur : si plus aucun message pendant 12 s, on considère l'adversaire parti. */
let heartbeat = null, lastSeen = 0;
function startHeartbeat() {
  clearInterval(heartbeat);
  lastSeen = Date.now();
  heartbeat = setInterval(() => {
    if (!online || !conn) return clearInterval(heartbeat);
    sendNet({ type: 'ping' });
    if (Date.now() - lastSeen > 12000) { clearInterval(heartbeat); onOpponentLeft(conn); }
  }, 3000);
}
window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); }); // prévient l'adversaire

function onOpponentLeft(c) {
  if (c !== conn || !online || online.ended) return;
  clearInterval(heartbeat);
  if (!online.started) {
    if (online.role === 'host') { conn = null; setOnlineStatus('L\'adversaire est parti. En attente…'); }
    else failOnline('Connexion fermée par la salle.');
    return;
  }
  online.ended = true;
  showOverlay('<h2>Adversaire déconnecté</h2><p>La partie est terminée.</p>', [['Menu', leaveOnline]], 'disc');
}

/* ----- Début de partie (hôte) ----- */
function startOnlineMatch() {
  online.started = true;
  startHeartbeat();
  rematchAsked = false;
  const first = Math.random() < 0.5 ? 0 : 1; // pièce lancée UNE seule fois, par l'hôte
  state = newGame(weights.slice(), first);
  message = '';
  sendNet({ type: 'start', first, view: toView(state, 1) });
  enterOnlineGame(first);
}

function enterOnlineGame(first) {
  handHidden = false; // pas d'écran « passe l'appareil » en ligne
  online.waiting = false;
  showScreen('game');
  render();
  showCoin(first, null, true, first === online.me ? 'Tu commences !' : 'L\'adversaire commence !');
}

/* ----- Réception côté hôte ----- */
function onHostData(d) {
  if (!d || typeof d !== 'object') return;
  lastSeen = Date.now();
  if (d.type === 'action') hostHandle(1, d.act);
  else if (d.type === 'rematch' && state && state.phase === 'gameOver') {
    rematchAsked = true;
    if (overlayKind === 'gameOver') showOnlineGameOver();
  }
}

/** Valide + applique une action (de l'hôte, player 0, ou de l'invité, player 1), puis synchronise. */
function hostHandle(player, act) {
  const r = applyAction(state, player, act);
  if (r.ignore) { // ex. « Continuer » déjà traité : on resynchronise l'invité
    if (player === 1) sendNet({ type: 'state', view: toView(state, 1), msg: message });
    return;
  }
  if (r.error) {
    if (player === 0) { message = r.error; render(); }
    else sendNet({ type: 'error', text: r.error });
    return;
  }
  message = r.msg;
  sendNet({ type: 'state', view: toView(state, 1), msg: message });
  render();
  syncOnlineOverlay();
}

/* ----- Réception côté invité ----- */
function onGuestData(d) {
  if (!d || typeof d !== 'object') return;
  lastSeen = Date.now();
  const okView = d.view && Array.isArray(d.view.hands) && Array.isArray(d.view.played);
  if (d.type === 'busy') return failOnline('Cette salle est déjà complète.');
  if (d.type === 'start' && okView) {
    online.started = true;
    startHeartbeat();
    state = d.view;
    message = '';
    enterOnlineGame(d.first);
  } else if (d.type === 'state' && okView) {
    online.waiting = false;
    state = d.view;
    message = d.msg || '';
    render();
    syncOnlineOverlay();
  } else if (d.type === 'error') {
    online.waiting = false;
    message = String(d.text || 'Action refusée.');
    render();
  }
}

/* ----- Actions du joueur local ----- */
function netAction(act) {
  if (online.role === 'host') return hostHandle(0, act);
  online.waiting = true; // évite un double clic avant la réponse de l'hôte
  sendNet({ type: 'action', act });
}

function onlineCardClick(idx) {
  if (online.ended || online.waiting || state.phase !== 'play') return;
  if (state.active !== online.me) return; // le message « Tour de l'adversaire » est déjà affiché
  if (state.played[online.me].length >= MAX_FIELD) {
    message = `Limite de ${MAX_FIELD} cartes atteinte : tu ne peux plus poser, seulement passer.`;
    render();
    return;
  }
  netAction({ kind: 'play', idx });
}

function onlinePass() {
  if (online.ended || online.waiting || state.phase !== 'play' || state.active !== online.me) return;
  netAction({ kind: 'pass' });
}

/* ----- Overlays synchronisés (fin de manche / fin de partie) ----- */
function syncOnlineOverlay() {
  if (state.phase === 'roundEnd') { if (overlayKind !== 'roundEnd') showOnlineRoundEnd(); }
  else if (state.phase === 'gameOver') { if (overlayKind !== 'gameOver') showOnlineGameOver(); }
  else if (overlayKind === 'roundEnd' || overlayKind === 'gameOver') hideOverlay();
}

function showOnlineRoundEnd() {
  const r = state.result;
  const title = r.winner === null ? 'Manche nulle'
    : r.winner === online.me ? 'Tu gagnes la manche !' : 'L\'adversaire gagne la manche';
  // L'un ou l'autre joueur peut cliquer : l'hôte passe à la manche suivante pour les deux.
  showOverlay(`<h2>${title}</h2><p>${r.reason}</p>`, [['Continuer', () => netAction({ kind: 'continue' })]], 'roundEnd');
}

function showOnlineGameOver() {
  const title = state.gameWinner === online.me ? 'Tu remportes la partie !' : 'L\'adversaire remporte la partie !';
  const html = `<h2>${title}</h2><p>${message}</p>`;
  if (online.role === 'host') {
    showOverlay(html + (rematchAsked ? '<p>L\'adversaire veut rejouer.</p>' : ''),
      [['Recommencer', startOnlineMatch], ['Menu', leaveOnline]], 'gameOver');
  } else {
    showOverlay(html, [
      ['Recommencer', () => {
        sendNet({ type: 'rematch' });
        showOverlay('<p>Demande envoyée. En attente de l\'hôte…</p>', [['Menu', leaveOnline]], 'gameOver');
      }],
      ['Menu', leaveOnline],
    ], 'gameOver');
  }
}

/* ----- Branchements de l'interface ----- */
$('btn-online').onclick = () => { cleanupNet(); setOnlineStatus(''); $('room-box').classList.add('hidden'); showScreen('online'); };
$('btn-create').onclick = () => createRoom();
$('btn-join').onclick = joinRoom;
$('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('btn-online-back').onclick = leaveOnline;
$('btn-copy').onclick = () => {
  const code = $('room-code').textContent;
  const done = () => setOnlineStatus('Code copié !');
  if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => setOnlineStatus('Copie impossible : note le code à la main.', true));
  else setOnlineStatus('Copie impossible : note le code à la main.', true);
};
