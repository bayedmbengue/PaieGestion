'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { joursOuvrables, joursDansPeriode, moisComplets, calcSolde } = require('../src/main/conges');

test('jours ouvrables : du lundi au samedi, dimanche exclu', () => {
  assert.equal(joursOuvrables('2026-11-23', '2026-11-28'), 6);   // lundi → samedi
  assert.equal(joursOuvrables('2026-11-23', '2026-11-29'), 6);   // + dimanche : ignoré
  assert.equal(joursOuvrables('2026-11-23', '2026-12-06'), 12);  // 2 semaines
  assert.equal(joursOuvrables('2026-11-29', '2026-11-29'), 0);   // un dimanche seul
  assert.equal(joursOuvrables('2026-11-25', '2026-11-25'), 1);
});

test('congé à cheval sur deux mois : répartition par mois', () => {
  const c = { debut: '2026-11-25', fin: '2026-12-05', nombreJours: 10 };
  assert.equal(joursDansPeriode(c, '2026-11-01', '2026-11-30'), 5);   // 25, 26, 27, 28, 30 novembre
  assert.equal(joursDansPeriode(c, '2026-12-01', '2026-12-31'), 5);   // 1er au 5 décembre
  assert.equal(joursDansPeriode(c, '2026-10-01', '2026-10-31'), 0);   // hors période
});

test('nombre de jours saisi différent du calcul (jour férié) : réparti au prorata', () => {
  const c = { debut: '2026-11-25', fin: '2026-12-05', nombreJours: 8 };   // 2 jours fériés retirés
  assert.equal(joursDansPeriode(c, '2026-11-01', '2026-11-30'), 4);
  assert.equal(joursDansPeriode(c, '2026-12-01', '2026-12-31'), 4);
});

test('mois complets de service', () => {
  assert.equal(moisComplets('2026-01-15', '2026-11-23'), 10);
  assert.equal(moisComplets('2026-01-15', '2026-11-14'), 9);
  assert.equal(moisComplets('2026-11-01', '2026-11-30'), 0);
  assert.equal(moisComplets('2026-12-01', '2026-11-30'), 0);     // jamais négatif
});

test('solde de congés : reprise + acquis − pris', () => {
  const s = calcSolde({ initial: 5, depuis: '2026-01-15', jusqu: '2026-11-23', pris: 6, joursParMois: 2 });
  assert.deepEqual(s, { acquis: 25, pris: 6, solde: 19 });        // 5 + 10 × 2 = 25 ; 25 − 6 = 19
  assert.equal(calcSolde({ initial: 0, depuis: '2026-01-01', jusqu: '2026-03-31', pris: 10, joursParMois: 2 }).solde, -6);   // solde négatif possible
  assert.equal(calcSolde({ initial: 0, depuis: '2026-01-01', jusqu: '2026-07-01', pris: 0, joursParMois: 2.5 }).acquis, 15);
});
