'use strict';
// Une rubrique n'est utilisée qu'une fois par mois : la variable du mois remplace le montant affecté.
const test = require('node:test');
const assert = require('node:assert/strict');
const rubriques = require('../src/main/rubriques');
const repo = require('../src/main/repo');

const aff = (RubriqueId, Montant, extra = {}) => ({ RubriqueId, Code: `R${RubriqueId}`, Libelle: `Rub ${RubriqueId}`, Type: 'GAIN', Montant, EstVariable: 0, ...extra });
const vari = (RubriqueId, Montant) => aff(RubriqueId, Montant, { EstVariable: 1 });

test('variable + affectation de la même rubrique : une seule ligne, montant de la variable (10 000 au lieu de 26 000)', () => {
  const r = rubriques.fusionnerVariables([aff(1, 100000), aff(2, 26000), vari(2, 10000)]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((l) => [l.RubriqueId, Number(l.Montant)]), [[1, 100000], [2, 10000]]);
});

test('variable seule (rubrique non affectée) : inchangée', () => {
  const r = rubriques.fusionnerVariables([aff(1, 100000), vari(3, 5000)]);
  assert.deepEqual(r.map((l) => [l.RubriqueId, Number(l.Montant)]), [[1, 100000], [3, 5000]]);
});

test('anciennes saisies : plusieurs variables de la même rubrique sont additionnées en une seule ligne', () => {
  const r = rubriques.fusionnerVariables([vari(4, 3000), vari(4, 2000)]);
  assert.equal(r.length, 1);
  assert.equal(Number(r[0].Montant), 5000);
});

test('la variable remplace aussi une mensualité de prêt du mois', () => {
  const r = rubriques.fusionnerVariables([aff(5, 25000, { MontantPret: 300000, DureeMois: 12 }), vari(5, 40000)]);
  assert.equal(r.length, 1);
  assert.equal(Number(r[0].Montant), 40000);
  assert.ok(!(Number(r[0].MontantPret) > 0), 'plus de mensualité calculée : la variable fait foi pour ce mois');
});

test('sans variable : les lignes sont rendues telles quelles', () => {
  const l = [aff(1, 100), aff(2, 200)];
  assert.equal(rubriques.fusionnerVariables(l), l);
});

function fakeDb({ deja = 0, affectation = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, p) {
      calls.push(sql);
      if (/FROM paie\.PeriodePaie WHERE Id=@id/.test(sql)) return [{ Cloturee: 0 }];
      if (/COUNT\(\*\) AS n FROM paie\.VariablePaie/.test(sql)) return [{ n: deja }];
      if (/SELECT Annee, Mois FROM paie\.PeriodePaie/.test(sql)) return [{ Annee: 2026, Mois: 11 }];
      if (/FROM paie\.EmployeRubrique er/.test(sql)) return affectation ? [affectation] : [];
      return [];
    },
  };
}

test('saveVariable : refuse une deuxième variable de la même rubrique le même mois', async () => {
  await assert.rejects(() => repo.saveVariable(fakeDb({ deja: 1 }), { PeriodeId: 1, EmployeId: 7, RubriqueId: 2, Montant: 10000 }, null), /une fois par mois/);
});

test('saveVariable : signale que la variable remplace le montant affecté', async () => {
  const r = await repo.saveVariable(fakeDb({ affectation: { Montant: 26000, Taux: null, MontantPret: null } }), { PeriodeId: 1, EmployeId: 7, RubriqueId: 2, Montant: 10000 }, null);
  assert.equal(r.remplace.Montant, 26000);
});

test('saveVariable : rubrique non affectée → rien à signaler', async () => {
  const r = await repo.saveVariable(fakeDb(), { PeriodeId: 1, EmployeId: 7, RubriqueId: 2, Montant: 10000 }, null);
  assert.equal(r.remplace, null);
});
