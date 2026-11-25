'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcParts, calcPartsTrimf } = require('../src/main/parts');
const { reductionSql, REDUCTION_FAMILLE, IPM_SQL } = require('../src/main/migrate');

// Tableau récapitulatif fourni : enfants → [PAR IR conjoint travaille, PAR IR conjoint ne travaille pas]
const MARIE = [[1.5, 2], [2, 2.5], [2.5, 3], [3, 3.5], [3.5, 4], [4, 4.5], [4.5, 5], [5, 5]];

test('marié : parts IR selon que le conjoint travaille ou non (0 à 7 enfants)', () => {
  MARIE.forEach(([travaille, ne], n) => {
    assert.equal(calcParts({ situation: 'M', enfants: n, conjointTravaille: true }), travaille, `${n} enfants, conjoint travaille`);
    assert.equal(calcParts({ situation: 'M', enfants: n, conjointTravaille: false }), ne, `${n} enfants, conjoint ne travaille pas`);
  });
});

test('célibataire sans enfant : 1 part ; avec enfants : +0,5 par enfant', () => {
  assert.equal(calcParts({ situation: 'C', enfants: 0 }), 1);
  [1, 1.5, 2, 2.5, 3].forEach((attendu, n) => {
    assert.equal(calcParts({ situation: 'C', enfants: n }), attendu);
    assert.equal(calcParts({ situation: 'D', enfants: n }), attendu);
  });
});

test('veuf : 1 sans enfant, puis 1,5 + 0,5 par enfant', () => {
  assert.equal(calcParts({ situation: 'V', enfants: 0 }), 1);
  assert.equal(calcParts({ situation: 'V', enfants: 1 }), 2);
  assert.equal(calcParts({ situation: 'V', enfants: 2 }), 2.5);
});

test('plafond de 5 parts', () => {
  assert.equal(calcParts({ situation: 'M', enfants: 12, conjointTravaille: false }), 5);
});

test('parts TRIMF : 2 si marié et conjoint ne travaille pas, sinon 1', () => {
  assert.equal(calcPartsTrimf({ situation: 'C', conjointTravaille: false }), 1);
  assert.equal(calcPartsTrimf({ situation: 'M', conjointTravaille: true }), 1);
  assert.equal(calcPartsTrimf({ situation: 'M', conjointTravaille: false }), 2);
  assert.equal(calcPartsTrimf({ situation: 'V', conjointTravaille: false }), 1);
});

test('la migration crée les paramètres de réduction (24) et ceux de l\'IPM', () => {
  assert.equal(REDUCTION_FAMILLE.length, 8);
  assert.equal((reductionSql().match(/N'RED_FAM_/g) || []).length, 24);
  for (const c of ['IPM_SAL', 'IPM_PAT', 'IPM_PLAFOND_SAL', 'IPM_PLAFOND_PAT']) assert.ok(IPM_SQL.includes(`N'${c}'`), c);
});
