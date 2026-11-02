// Tests de la logique pure : node test.js
// On ne charge que la PARTIE 1 de game.js (avant le code d'affichage).
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(__dirname + '/game.js', 'utf8').split('PARTIE 2 : AFFICHAGE')[0].replace(/\/\*[-\s]*$/, '');
const net = fs.readFileSync(__dirname + '/network.js', 'utf8').split('PARTIE B : RÉSEAU')[0].replace(/\/\*[-\s]*$/, '');
const L = new Function(src + net + `
return { newGame, playCard, passTurn, nextRound, total, MAX_FIELD, applyAction, toView };`)();

let fails = 0;
function test(name, fn) {
  try { fn(); console.log('OK   ' + name); }
  catch (e) { fails++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
// Partie avec mains imposées ; J1 (0) commence
function game(h0, h1, first = 0) {
  const s = L.newGame(Array(10).fill(1), first);
  s.hands = [h0.slice(), h1.slice()];
  return s;
}

test('passage derrière : le passeur perd la manche', () => {
  const s = game([5, 1], [9, 1]);
  L.playCard(s, 0);          // J1 5
  L.passTurn(s);             // J1 passe devant de 0 : J2 à 0 -> ok
  assert.strictEqual(s.active, 1);
  L.playCard(s, 0);          // J2 9
  assert.strictEqual(s.phase, 'play');
  L.passTurn(s);             // J2 passe devant
  assert.strictEqual(s.active, 0);
  L.passTurn(s);             // J1 (5) passe derrière (9)
  assert.strictEqual(s.phase, 'roundEnd');
  assert.strictEqual(s.result.winner, 1);
});

test('passage puis rattrapage', () => {
  const s = game([5, 6, 1], [3, 4, 1]);
  L.playCard(s, 0);          // J1 5
  L.passTurn(s);             // J1 passe devant (5 > 0)
  L.playCard(s, 0);          // J2 3, derrière mais manche continue
  L.playCard(s, 0);          // J2 3+4=7 > 5
  L.passTurn(s);             // J2 passe devant
  assert.strictEqual(s.phase, 'play');
  assert.strictEqual(s.active, 0);
  L.playCard(s, 0);          // J1 rejoue : 5+6=11 > 7
  assert.strictEqual(s.passed[0], false);
  L.passTurn(s);             // J1 passe devant, J2 a passé mais derrière -> reprend la main
  assert.strictEqual(s.phase, 'play');
  assert.strictEqual(s.active, 1);
});

test('manche nulle : double passage à égalité, aucune carte conservée', () => {
  const s = game([5, 1], [5, 1]);
  L.playCard(s, 0);
  L.passTurn(s);             // J1 5 vs 0
  L.playCard(s, 0);          // J2 5 (égalité)
  L.passTurn(s);             // J2 passe à égalité, J1 avait passé
  assert.strictEqual(s.phase, 'roundEnd');
  assert.strictEqual(s.result.winner, null);
  const front = s.front;
  L.nextRound(s);
  assert.strictEqual(s.front, front);
  assert.deepStrictEqual(s.played, [[], []]);
  assert.strictEqual(s.starter, 1);   // l'autre que J1
});

test('nulle 0-0 : les deux passent sans carte', () => {
  const s = game([1], [1]);
  L.passTurn(s); L.passTurn(s);
  assert.strictEqual(s.result.winner, null);
});

test('limite de 4 cartes : 5e pose refusée', () => {
  const s = game([1, 1, 1, 1, 1, 1], [9, 9, 9, 9, 9, 9]);
  for (let i = 0; i < 4; i++) { s.active = 0; assert.ok(L.playCard(s, 0)); }
  assert.strictEqual(s.played[0].length, 4);
  s.active = 0;
  assert.strictEqual(L.playCard(s, 0), false);
  assert.strictEqual(s.played[0].length, 4);
});

test('bloqué à 4 cartes et derrière : perd la manche', () => {
  const s = game([1, 1, 1, 1, 1], [9, 9]);
  s.played[1] = [9];         // J2 est devant (9 > 4)
  L.playCard(s, 0); L.playCard(s, 0); L.playCard(s, 0); L.playCard(s, 0); // J1 = 4
  assert.strictEqual(s.phase, 'roundEnd');
  assert.strictEqual(s.result.winner, 1);
});

test('carte conservée : dernière carte du gagnant, total de départ, perdant à 0', () => {
  const s = game([2, 7, 1], [3, 1, 1]);
  L.playCard(s, 0);          // J1 2
  L.playCard(s, 0);          // J1 2+7 = 9 (la dernière posée est 7)
  L.passTurn(s);             // J1 passe devant
  L.playCard(s, 0);          // J2 3
  L.passTurn(s);             // J2 passe derrière -> J1 gagne
  assert.strictEqual(s.result.winner, 0);
  const front = s.front;
  L.nextRound(s);
  assert.strictEqual(s.front, front - 1);
  assert.deepStrictEqual(s.played[0], [7]);
  assert.strictEqual(L.total(s, 0), 7);
  assert.deepStrictEqual(s.played[1], []);
  assert.strictEqual(L.total(s, 1), 0);
  assert.strictEqual(s.active, 0);    // le gagnant commence
  // il ne peut poser que 3 nouvelles cartes
  s.hands[0] = [1, 1, 1, 1];
  assert.ok(L.playCard(s, 0)); assert.ok(L.playCard(s, 0)); assert.ok(L.playCard(s, 0));
  assert.strictEqual(L.playCard(s, 0), false);
});

test('main vide et strictement derrière : perd automatiquement', () => {
  const s = game([5, 1], [3]);
  L.playCard(s, 0);          // J1 5
  L.passTurn(s);
  L.playCard(s, 0);          // J2 3, main vide, derrière
  assert.strictEqual(s.result.winner, 0);
});

test('main vide mais devant : la manche continue', () => {
  const s = game([1, 1], [9]);
  s.active = 1;
  L.playCard(s, 0);
  assert.strictEqual(s.phase, 'play');
});

test('cartes épuisées : la carte conservée ne compte pas comme main', () => {
  // J2 gagne avec sa dernière carte (main vide) ; J1 a encore des cartes
  const s = game([1, 1, 1], [9]);
  s.active = 1;
  L.playCard(s, 0);          // J2 9, main vide
  L.passTurn(s);             // J2 passe devant
  L.passTurn(s);             // J1 passe derrière -> J2 gagne
  assert.strictEqual(s.result.winner, 1);
  const front = s.front;
  const notice = L.nextRound(s);
  // J2 gagne 1 cran (manche) ; J2 est à court -> J1 joue ses 3 cartes : avance de 3
  assert.strictEqual(s.front, front + 1 - 3);
  assert.ok(notice.length > 0);
  assert.strictEqual(s.hands[0].length, 10);
  assert.strictEqual(s.hands[1].length, 10);
});

test('les deux joueurs à court : personne n\'avance, mains redistribuées', () => {
  const s = game([4], [4]);
  L.playCard(s, 0);          // J1 4, main vide, égalité? J2 à 0 -> J1 devant
  L.active; s.active = 1;
  L.playCard(s, 0);          // J2 4, main vide, égalité
  L.passTurn(s); L.passTurn(s);
  assert.strictEqual(s.result.winner, null);
  const front = s.front;
  L.nextRound(s);
  assert.strictEqual(s.front, front);
  assert.strictEqual(s.hands[0].length, 10);
  assert.strictEqual(s.hands[1].length, 10);
});

test('victoire de partie en atteignant la zone 1 ennemie', () => {
  const s = game([5, 5], [1, 1]);
  s.front = 2;               // J1 à 1 manche de la bande 1
  s.result = { winner: 0, reason: '' };
  s.phase = 'roundEnd';
  L.nextRound(s);
  assert.strictEqual(s.gameWinner, 0);
  assert.strictEqual(s.phase, 'gameOver');
});

test('réseau : la vue de l\'invité ne contient jamais la main de l\'hôte', () => {
  const s = game([7, 8, 9], [1, 2]);
  const v = L.toView(s, 1);
  assert.deepStrictEqual(v.hands[1], [1, 2]);
  assert.deepStrictEqual(v.hands[0], [null, null, null]);
  assert.strictEqual(v.weights, undefined);
  assert.ok(!JSON.stringify(v.hands[0]).match(/[0-9]/));
  const vh = L.toView(s, 0);
  assert.deepStrictEqual(vh.hands[1], [null, null]);
});

test('réseau : actions invalides refusées (tour, carte inexistante, limite, inconnue)', () => {
  const s = game([1, 1, 1, 1, 1, 1], [9, 9, 9, 9, 9, 9]);
  assert.ok(L.applyAction(s, 1, { kind: 'pass' }).error);           // pas son tour
  assert.ok(L.applyAction(s, 0, { kind: 'play', idx: 99 }).error);  // carte inexistante
  assert.ok(L.applyAction(s, 0, { kind: 'play', idx: -1 }).error);
  assert.ok(L.applyAction(s, 0, { kind: 'play', idx: '0' }).error);
  assert.ok(L.applyAction(s, 0, { kind: 'zzz' }).error);
  assert.ok(L.applyAction(s, 0, null).error);
  assert.strictEqual(s.hands[0].length, 6);                          // rien n'a été joué
  s.played[0] = [1, 1, 1, 1]; s.played[1] = [9];
  assert.ok(/Limite/.test(L.applyAction(s, 0, { kind: 'play', idx: 0 }).error));
  assert.strictEqual(s.played[0].length, 4);
});

test('réseau : fin de manche synchronisée via « continue »', () => {
  const s = game([5, 1], [3, 1]);
  assert.deepStrictEqual(L.applyAction(s, 0, { kind: 'play', idx: 0 }), { msg: '' });
  assert.ok(L.applyAction(s, 0, { kind: 'pass' }).msg);             // "J1 a passé."
  assert.strictEqual(s.active, 1);
  L.applyAction(s, 1, { kind: 'play', idx: 0 });                    // J2 3 < 5
  L.applyAction(s, 1, { kind: 'pass' });                            // J2 perd
  assert.strictEqual(s.phase, 'roundEnd');
  assert.ok(L.applyAction(s, 0, { kind: 'play', idx: 0 }).error);   // bloqué pendant le résumé
  assert.ok(!L.applyAction(s, 1, { kind: 'continue' }).error);
  assert.strictEqual(s.phase, 'play');
  assert.deepStrictEqual(s.played[0], [5]);
  assert.ok(L.applyAction(s, 0, { kind: 'continue' }).ignore);      // double clic ignoré
});

console.log(fails ? `\n${fails} test(s) en échec` : '\nTous les tests passent');
process.exit(fails ? 1 : 0);
