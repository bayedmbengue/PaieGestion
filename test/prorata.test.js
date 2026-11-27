'use strict';
// Rubriques proratisées selon les jours travaillés (montant x jours / 26).
const test = require('node:test');
const assert = require('node:assert/strict');
const rubriques = require('../src/main/rubriques');
const { makeParams } = require('../src/main/calc');

const P = (extra = []) => makeParams([{ Code: 'JOURS_REFERENCE_MOIS', Valeur: 26 }, ...extra], [], []);
const g = (Code, Libelle, Montant, ProrataJours, extra = {}) => ({ Code, Libelle, Type: 'GAIN', ModeCalcul: 'FIXE', Montant, Imposable: true, ProrataJours, ...extra });

test('18 jours sur 26 : bulletin de référence (122 959 → 85 125 ; 74 000 → 51 231 ; 26 000 → 18 000)', () => {
  const lignes = [g('SALBASE', 'Salaire de base', 122959, true), g('SURSAL', 'SURSALAIRE', 74000, true), g('TRANSPORT', 'Transport', 26000, true),
    g('DEPL', 'Indemnité de déplacement', 40000, true), g('DEPAYS', 'Indemnité de dépaysement', 30000, true), g('REPR', 'Prime de représentation', 40000, true),
    g('CAISSE', 'Prime de caisse', 30000, true)];
  const r = rubriques.calculerAssiettes(lignes, 122959, P(), { jours: 18 });
  assert.deepEqual(r.gains.map((x) => x.Montant), [85125, 51231, 18000, 27692, 20769, 27692, 20769]);
  assert.equal(r.gains[0].BaseCalculee, 122959);      // bulletin : base = montant plein
  assert.equal(r.gains[0].TauxCalcule, 18);           // bulletin : « taux » = jours travaillés
});

test('logement, congé, retraite, prime incitative et de performance ne sont pas proratisés', () => {
  const lignes = [g('LOG', 'Indemnité de logement', 60000, false), g('CONGE', 'Indemnité de congé', 36154, false),
    g('RET', 'Indemnité de retraite', 500000, false), g('INC', 'Prime incitative', 100000, false), g('PERF', 'Prime de performance', 80000, false)];
  const r = rubriques.calculerAssiettes(lignes, 0, P(), { jours: 18 });
  assert.deepEqual(r.gains.map((x) => x.Montant), [60000, 36154, 500000, 100000, 80000]);
});

test('prime d\'ancienneté en pourcentage du salaire de base : proratisée comme le reste (40 577 → 28 091)', () => {
  const anc = g('ANC', "Prime d'ancienneté", null, true, { ModeCalcul: 'POURCENTAGE', Taux: 33 });
  const r = rubriques.calculerAssiettes([anc], 122959, P(), { jours: 18 });
  assert.equal(r.gains[0].Montant, 28091);
});

test('mois complet (26 j) ou aucune saisie : aucune proratisation', () => {
  const l = [g('X', 'Prime', 100000, true)];
  assert.equal(rubriques.calculerAssiettes(l, 0, P(), { jours: 26 }).gains[0].Montant, 100000);
  assert.equal(rubriques.calculerAssiettes(l, 0, P(), { jours: null }).gains[0].Montant, 100000);
  assert.equal(rubriques.calculerAssiettes(l, 0, P()).gains[0].Montant, 100000);
  assert.equal(rubriques.calculerAssiettes(l, 0, P(), { jours: 0 }).gains[0].Montant, 0);
});

test('les assiettes (brut, imposable, cotisable) utilisent les montants proratisés', () => {
  const r = rubriques.calculerAssiettes([g('SALBASE', 'Salaire de base', 260000, true)], 260000, P(), { jours: 13 });
  assert.equal(r.brut, 130000);
  assert.equal(r.brutImposable, 130000);
});
