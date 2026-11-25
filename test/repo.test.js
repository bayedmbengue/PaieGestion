'use strict';
// Test du déroulement de calculerPeriode avec une base simulée (aucune requête SQL réelle n'est exécutée ici).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const repo = require('../src/main/repo');

const schema = fs.readFileSync(path.join(__dirname, '..', 'PaieGestion_schema.sql'), 'utf8');
const RUB = ['SALBASE', 'IPRES_RG_SAL', 'IPRES_RCC_SAL', 'IR', 'TRIMF', 'IPRES_RG_PAT', 'IPRES_RCC_PAT', 'CSS_PF_PAT', 'CSS_ATMP_PAT', 'CFCE_PAT', 'IPM_SAL', 'IPM_PAT', 'PRIME_TRANS', 'ABSENCE'];

test('le script SQL fournit toutes les rubriques utilisées par le calcul', () => {
  for (const c of RUB) assert.ok(schema.includes(`N'${c}'`), `rubrique absente du script : ${c}`);
});

function fakeDb(cumulsPrec = [], employe = {}) {
  const inserted = { bulletins: [], lignes: [] };
  const params = [['IPRES_RG_SAL', 5.6], ['IPRES_RG_PAT', 8.4], ['IPRES_RG_PLAFOND', 432000], ['IPRES_RCC_SAL', 2.4], ['IPRES_RCC_PAT', 3.6],
    ['IPRES_RCC_PLAFOND', 1296000], ['CSS_PF_PAT', 7], ['CSS_ATMP_PAT', 1], ['CSS_PLAFOND', 63000], ['CFCE_PAT', 3], ['ABATTEMENT_IR', 30], ['ABATTEMENT_IR_PLAFOND', 900000],
    ['IPM_SAL', 5], ['IPM_PAT', 6], ['IPM_PLAFOND_SAL', 12500], ['IPM_PLAFOND_PAT', 15000], ['EXO_PRIME_TRANS', 26000]]
    .map(([Code, Valeur]) => ({ Code, Valeur }));
  const rub = RUB.map((Code, i) => ({ Id: i + 1, Code, Libelle: Code, Ordre: i * 10 }));
  const run = async (sql, p) => {
    if (/FROM paie\.Conge c/.test(sql)) return [];
    if (/FROM paie\.BulletinPaie b JOIN paie\.PeriodePaie/.test(sql)) return cumulsPrec;
    if (/FROM paie\.PeriodePaie WHERE Id/.test(sql)) return [{ Id: 1, Annee: 2026, Mois: 11, Cloturee: false }];
    if (/FROM paie\.ParametreLegal/.test(sql)) return params;
    if (/FROM paie\.BaremeIR/.test(sql)) return [{ TrancheMin: 0, TrancheMax: 630000, Taux: 0 }, { TrancheMin: 630000, TrancheMax: 1500000, Taux: 20 }, { TrancheMin: 1500000, TrancheMax: null, Taux: 30 }];
    if (/FROM paie\.BaremeTRIMF/.test(sql)) return [];
    if (/FROM paie\.Rubrique$/.test(sql.trim())) return rub;
    if (/FROM paie\.Employe e/.test(sql)) return [{ Id: 7, EstCadre: 0, NombreParts: 1, SituationFamiliale: 'C', ConjointTravaille: false, SalaireBase: 300000, ...employe }];
    if (/UNION ALL/.test(sql)) return [
      { RubriqueId: 11, Code: 'PRIME_TRANS', Libelle: 'Transport', Type: 'GAIN', Imposable: 1, SoumisCotisation: 1, Ordre: 30, Montant: 40000 },
      { RubriqueId: 12, Code: 'ABSENCE', Libelle: 'Absence', Type: 'RETENUE', Imposable: 0, SoumisCotisation: 0, Ordre: 420, Montant: 5000 },
    ];
    if (/DELETE FROM paie\.BulletinPaie/.test(sql)) return [];
    if (/INSERT INTO paie\.BulletinPaie/.test(sql)) { inserted.bulletins.push(p); return [{ Id: 99 }]; }
    if (/INSERT INTO paie\.LigneBulletin/.test(sql)) { inserted.lignes.push(p); return []; }
    throw new Error('Requête inattendue : ' + sql.slice(0, 80));
  };
  return {
    inserted,
    query: async (sql) => { if (/Verifie=0/.test(sql)) return [{ n: 3 }]; return []; },
    tx: async (fn) => fn(run),
  };
}

test('calculerPeriode : brut, retenues, lignes et avertissement « non vérifié »', async () => {
  const db = fakeDb();
  const r = await repo.calculerPeriode(db, 1, { id: 1 });
  assert.equal(r.count, 1);
  assert.equal(r.nonVerifies, 3);
  const b = db.inserted.bulletins[0];
  assert.equal(b.brut, 340000);                 // 300 000 + 40 000 de transport
  // transport exonéré jusqu'à 26 000 : brut imposable = 340 000 − 26 000 = 314 000 (base de toutes les retenues)
  assert.equal(b.ar, 5000);                     // retenue pour absence
  assert.equal(b.ts, 30084);                    // IPRES 5,6 % de 314 000 (17 584) + IPM plafonné (12 500)
  assert.equal(db.inserted.lignes.find((l) => l.l === 'CFCE_PAT').pat, 9420);   // CFCE 3 % de 314 000
  assert.equal(b.net, b.brut - b.ts - b.ir - b.trimf - 5000);
  const libs = db.inserted.lignes.map((l) => l.l);
  for (const attendu of ['SALBASE', 'Transport', 'IPRES_RG_SAL', 'IPM_SAL', 'Absence', 'IPRES_RG_PAT', 'IPM_PAT', 'CSS_PF_PAT', 'CFCE_PAT']) assert.ok(libs.includes(attendu), 'ligne manquante : ' + attendu);
  assert.ok(!libs.includes('IPRES_RCC_SAL'), 'pas de régime cadre pour un non-cadre');
});

test('calculerPeriode refuse une période clôturée', async () => {
  const db = fakeDb();
  const tx = db.tx;
  db.tx = (fn) => tx((run) => fn((sql, p) => (/FROM paie\.PeriodePaie WHERE Id/.test(sql) ? Promise.resolve([{ Id: 1, Annee: 2026, Mois: 11, Cloturee: true }]) : run(sql, p))));
  await assert.rejects(() => repo.calculerPeriode(db, 1, null), /clôturée/);
});

test('monthBounds gère les fins de mois', () => {
  assert.deepEqual(repo.monthBounds(2026, 2), { debut: '2026-02-01', fin: '2026-02-28' });
  assert.deepEqual(repo.monthBounds(2028, 2), { debut: '2028-02-01', fin: '2028-02-29' });
  assert.deepEqual(repo.monthBounds(2026, 12), { debut: '2026-12-01', fin: '2026-12-31' });
});

test('calculerPeriode : tient compte des bulletins déjà établis (cumul annuel) et marque la régularisation de départ', async () => {
  // 10 mois déjà payés à 300 000 : IR et TRIMF déjà retenus, départ de l'employé le 30/11
  const prec = [{ EmployeId: 7, Nb: 10, BrutImposable: 3000000, BrutCfceTrimf: 3000000, Ir: 500000, Trimf: 0 }];
  const db = fakeDb(prec, { DateSortie: '2026-11-30' });
  await repo.calculerPeriode(db, 1, { id: 1 });
  const b = db.inserted.bulletins[0];
  assert.ok(b.ir < 0, `remboursement attendu (trop retenu), obtenu ${b.ir}`);
  assert.equal(b.net, b.brut - b.ts - b.ir - b.trimf - 5000);
  assert.ok(db.inserted.lignes.some((l) => /régularisation de fin de contrat/.test(l.l)), 'ligne de régularisation absente du bulletin');
  assert.ok(b.bimp > 0 && b.bcf > 0, 'bruts imposables à conserver pour les cumuls des mois suivants');
});
