'use strict';
// Remboursement de prêt échelonné (montant + durée) et base de la retenue (brut imposable / net après impôt).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mensualitePret, calculerAssiettes } = require('../src/main/rubriques');

test('mensualité de prêt : part entière chaque mois, reliquat sur la dernière échéance, rien hors durée', () => {
  const m = Array.from({ length: 12 }, (_, i) => mensualitePret(1000000, 12, i));
  assert.deepEqual(m.slice(0, 11), Array(11).fill(83333));
  assert.equal(m[11], 83337);
  assert.equal(m.reduce((a, b) => a + b, 0), 1000000);          // le prêt est remboursé exactement
  assert.equal(mensualitePret(1000000, 12, -1), 0);              // avant le début
  assert.equal(mensualitePret(1000000, 12, 12), 0);              // après la durée
  assert.equal(mensualitePret(600000, 6, 0), 100000);
});

const gain = { Type: 'GAIN', ModeCalcul: 'FIXE', Imposable: true, SoumisCotisation: true, SoumisCfceTrimf: true, Montant: 500000, Taux: null, Code: 'SALBASE' };

test('retenue sur le net après impôt : réduit le net, pas la base de l\'IR', () => {
  const a = calculerAssiettes([gain, { Type: 'RETENUE', ModeCalcul: 'FIXE', Montant: 100000, BaseRetenue: 'NET_APRES_IMPOT' }], 500000);
  assert.equal(a.brutImposable, 500000);
  assert.equal(a.autresRetenues, 100000);
});

test('retenue sur le brut imposable : réduit la base de l\'IR et le net', () => {
  const a = calculerAssiettes([gain, { Type: 'RETENUE', ModeCalcul: 'FIXE', Montant: 100000, BaseRetenue: 'BRUT_IMPOSABLE' }], 500000);
  assert.equal(a.brutImposable, 400000);
  assert.equal(a.autresRetenues, 100000);
  assert.equal(a.brutCotisable, 500000);                         // les cotisations ne sont pas touchées
});

test('retenue sans base précisée : net après impôt (comportement historique)', () => {
  const a = calculerAssiettes([gain, { Type: 'RETENUE', ModeCalcul: 'FIXE', Montant: 50000 }], 500000);
  assert.equal(a.brutImposable, 500000);
});
