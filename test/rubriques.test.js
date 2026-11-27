'use strict';
// Tests du module autonome « Rubriques de paie » : modes de calcul, 3 assiettes distinctes, migration_03.sql, rôles et préload.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const rubriques = require('../src/main/rubriques');
const calc = require('../src/main/calc');
const repo = require('../src/main/repo');
const { REDUCTION_FAMILLE, MIGRATION03 } = require('../src/main/migrate');
const { createWebHost } = require('../src/web/webhost');

const baseParams = [
  ['IPRES_RG_SAL', 5.6], ['IPRES_RG_PAT', 8.4], ['IPRES_RG_PLAFOND', 432000],
  ['IPRES_RCC_SAL', 2.4], ['IPRES_RCC_PAT', 3.6], ['IPRES_RCC_PLAFOND', 1296000],
  ['CSS_PF_PAT', 7], ['CSS_ATMP_PAT', 1], ['CSS_PLAFOND', 63000], ['CFCE_PAT', 3],
  ['ABATTEMENT_IR', 30], ['ABATTEMENT_IR_PLAFOND', 900000],
  ['IPM_SAL', 5], ['IPM_PAT', 6], ['IPM_PLAFOND_SAL', 12500], ['IPM_PLAFOND_PAT', 15000],
].map(([Code, Valeur]) => ({ Code, Valeur }))
  .concat(REDUCTION_FAMILLE.flatMap(([n, t, mi, ma]) => [
    { Code: `RED_FAM_${n}_TAUX`, Valeur: t }, { Code: `RED_FAM_${n}_MIN`, Valeur: mi }, { Code: `RED_FAM_${n}_MAX`, Valeur: ma },
  ]));
const baremeIR = [[0, 630000, 0], [630000, 1500000, 20], [1500000, 4000000, 30], [4000000, 8000000, 35], [8000000, 13500000, 37], [13500000, 50000000, 40], [50000000, null, 43]]
  .map(([TrancheMin, TrancheMax, Taux]) => ({ TrancheMin, TrancheMax, Taux }));
const baremeTRIMF = [[0, 599999, 900], [600000, 999999, 3600], [1000000, 1999999, 4800], [2000000, 6999999, 12000], [7000000, 11999999, 18000], [12000000, null, 36000]]
  .map(([SalaireMin, SalaireMax, Montant]) => ({ SalaireMin, SalaireMax, Montant }));

// ───────────── 1. Modes de calcul & 3 assiettes indépendantes ─────────────

test('montantLigne : FIXE, POURCENTAGE du salaire de base, et surcharge VARIABLE', () => {
  assert.equal(rubriques.montantLigne({ ModeCalcul: 'FIXE', Montant: 50000 }, 300000), 50000);
  assert.equal(rubriques.montantLigne({ ModeCalcul: 'POURCENTAGE', Montant: null, Taux: 5 }, 300000), 15000);
  assert.equal(rubriques.montantLigne({ ModeCalcul: 'POURCENTAGE', Montant: null, Taux: 2.5 }, 128500), 3213);
  assert.equal(rubriques.montantLigne({ ModeCalcul: 'VARIABLE', Montant: 25000 }, 300000), 25000);
});

test('calculerAssiettes : sépare IR, cotisations sociales et CFCE/TRIMF selon les indicateurs de chaque rubrique', () => {
  const lignes = [
    { Code: 'SALBASE', Type: 'GAIN', ModeCalcul: 'AUTO', Imposable: 1, SoumisCotisation: 1, SoumisCfceTrimf: 1, PlafondExoneration: 0, Montant: 300000 },
    { Code: 'PRIME_ANC', Type: 'GAIN', ModeCalcul: 'POURCENTAGE', Imposable: 1, SoumisCotisation: 1, SoumisCfceTrimf: 1, PlafondExoneration: 0, Montant: null, Taux: 10 }, // +30 000 partout
    { Code: 'PRIME_TRANS', Type: 'GAIN', ModeCalcul: 'FIXE', Imposable: 1, SoumisCotisation: 1, SoumisCfceTrimf: 1, PlafondExoneration: 26000, Montant: 40000 },         // +14 000 soumis, 26 000 exonéré
    { Code: 'IND_IR_SEUL', Type: 'GAIN', ModeCalcul: 'FIXE', Imposable: 1, SoumisCotisation: 0, SoumisCfceTrimf: 0, PlafondExoneration: null, Montant: 50000 },          // +50 000 IR seul
    { Code: 'IND_COT_SEUL', Type: 'GAIN', ModeCalcul: 'FIXE', Imposable: 0, SoumisCotisation: 1, SoumisCfceTrimf: 0, PlafondExoneration: null, Montant: 20000 },         // +20 000 cotisations seules
    { Code: 'IND_CFCE_SEUL', Type: 'GAIN', ModeCalcul: 'FIXE', Imposable: 0, SoumisCotisation: 0, SoumisCfceTrimf: 1, PlafondExoneration: null, Montant: 10000 },        // +10 000 CFCE/TRIMF seul
    { Code: 'IND_EXO', Type: 'GAIN', ModeCalcul: 'FIXE', Imposable: 0, SoumisCotisation: 0, SoumisCfceTrimf: 0, PlafondExoneration: null, Montant: 15000 },              // 0 partout
    { Code: 'PRET', Type: 'RETENUE', ModeCalcul: 'VARIABLE', Imposable: 0, SoumisCotisation: 0, SoumisCfceTrimf: 0, Montant: 12000 },
  ];
  const ass = rubriques.calculerAssiettes(lignes, 300000);
  assert.equal(ass.brut, 465000);
  assert.equal(ass.brutImposable, 300000 + 30000 + 14000 + 50000);   // 394 000
  assert.equal(ass.brutCotisable, 300000 + 30000 + 14000 + 20000);   // 364 000
  assert.equal(ass.brutCfceTrimf, 300000 + 30000 + 14000 + 10000);   // 354 000
  assert.equal(ass.autresRetenues, 12000);

  // Vérification dans calc.calculer : chaque impôt/cotisation utilise bien sa propre assiette
  const p = calc.makeParams(baseParams, baremeIR, baremeTRIMF);
  const res = calc.calculer({
    brut: ass.brut, brutCotisable: ass.brutCotisable, brutImposable: ass.brutImposable, brutCfceTrimf: ass.brutCfceTrimf,
    estCadre: false, parts: 1, partsTrimf: 1, autresRetenues: ass.autresRetenues,
  }, p);
  assert.equal(res.rgSal, Math.round(364000 * 5.6 / 100));           // base cotisable
  assert.equal(res.cfce, Math.round(354000 * 3 / 100));              // base CFCE/TRIMF
  assert.equal(res.baseCfceTrimf, 354000);
});

test('calculerPeriode avec prime en POURCENTAGE et PlafondExoneration sur la rubrique', async () => {
  const inserted = { bulletins: [], lignes: [] };
  const RUB = ['SALBASE', 'IPRES_RG_SAL', 'IPRES_RCC_SAL', 'IPM_SAL', 'IR', 'TRIMF', 'IPRES_RG_PAT', 'IPRES_RCC_PAT', 'IPM_PAT', 'CSS_PF_PAT', 'CSS_ATMP_PAT', 'CFCE_PAT', 'PRIME_ANC', 'PRIME_TRANS'];
  const run = async (sql, p) => {
    if (/FROM paie\.Conge c/.test(sql)) return [];
    if (/FROM paie\.BulletinPaie b JOIN paie\.PeriodePaie/.test(sql)) return [];
    if (/FROM paie\.PresencePeriode/.test(sql)) return [];
    if (/FROM paie\.PeriodePaie WHERE Id/.test(sql)) return [{ Id: 1, Annee: 2026, Mois: 11, Cloturee: false }];
    if (/FROM paie\.ParametreLegal/.test(sql)) return baseParams;
    if (/FROM paie\.BaremeIR/.test(sql)) return baremeIR;
    if (/FROM paie\.BaremeTRIMF/.test(sql)) return baremeTRIMF;
    if (/FROM paie\.Rubrique$/.test(sql.trim())) return RUB.map((Code, i) => ({ Id: i + 1, Code, Libelle: Code, Ordre: i * 10 }));
    if (/FROM paie\.Employe e/.test(sql)) return [{ Id: 1, EstCadre: 0, NombreParts: 1, SituationFamiliale: 'C', ConjointTravaille: false, SalaireBase: 200000 }];
    if (/UNION ALL/.test(sql)) return [
      { RubriqueId: 13, Code: 'PRIME_ANC', Libelle: "Prime d'ancienneté", Type: 'GAIN', ModeCalcul: 'POURCENTAGE', Imposable: 1, SoumisCotisation: 1, SoumisCfceTrimf: 1, PlafondExoneration: null, Ordre: 20, Montant: null, Taux: 5 },
      { RubriqueId: 14, Code: 'PRIME_TRANS', Libelle: 'Transport', Type: 'GAIN', ModeCalcul: 'FIXE', Imposable: 1, SoumisCotisation: 1, SoumisCfceTrimf: 1, PlafondExoneration: 26000, Ordre: 30, Montant: 26000, Taux: null },
    ];
    if (/DELETE FROM paie\.BulletinPaie/.test(sql)) return [];
    if (/INSERT INTO paie\.BulletinPaie/.test(sql)) { inserted.bulletins.push(p); return [{ Id: 1 }]; }
    if (/INSERT INTO paie\.LigneBulletin/.test(sql)) { inserted.lignes.push(p); return []; }
    throw new Error('Requête inattendue : ' + sql.slice(0, 80));
  };
  await repo.calculerPeriode({ query: async () => [{ n: 0 }], tx: async (fn) => fn(run) }, 1, null);

  assert.equal(inserted.bulletins[0].brut, 236000);                  // 200 000 + 10 000 (5%) + 26 000
  const ancLine = inserted.lignes.find((l) => l.l === "Prime d'ancienneté");
  assert.equal(ancLine.base, 200000);
  assert.equal(ancLine.taux, 5);
  assert.equal(ancLine.g, 10000);
  const cfceLine = inserted.lignes.find((l) => l.l === 'CFCE_PAT');
  assert.equal(cfceLine.pat, Math.round(210000 * 3 / 100));          // 200 000 + 10 000 (transport 26 000 exonéré)
});

// ───────────── 2. Script sql/migration_03.sql (idempotent, non destructif) ─────────────

test('sql/migration_03.sql est idempotent, ajoute toutes les colonnes et ne supprime aucune prime existante', () => {
  const sql = fs.readFileSync(MIGRATION03, 'utf8');
  for (const col of ['ModeCalcul', 'SoumisCfceTrimf', 'PlafondExoneration', 'CompteComptable', 'EstSysteme', 'Actif', 'Commentaire']) {
    assert.ok(sql.includes(`N'${col}'`), `Colonne absente de migration_03.sql : ${col}`);
  }
  assert.match(sql, /IF COL_LENGTH\(N'paie\.Rubrique', N'ModeCalcul'\) IS NULL/);
  assert.match(sql, /CK_Rubrique_ModeCalcul/);
  assert.match(sql, /CK_EmpRub_Dates/);
  assert.match(sql, /IX_EmpRub_Periode/);
  assert.match(sql, /EXO_/);                                         // migration des plafonds EXO_<CODE>
  assert.match(sql, /paie\.CompteRubrique/);                         // reprise des comptes comptables
  assert.doesNotMatch(sql, /\b(DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\b/i);
});

// ───────────── 3. Préload et contrôle des rôles sur rub:* et emprub:* ─────────────

test('preload.js expose les canaux rub:* et emprub:*', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const ch of ['rub:list', 'rub:all', 'rub:save', 'emprub:list', 'emprub:save', 'emprub:close', 'emprub:delete']) {
    assert.ok(preload.includes(`'${ch}'`), `Canal absent de preload.js : ${ch}`);
  }
});

test('rôles respectés sur le module Rubriques de paie (LECTEUR, COMPTABLE, GESTIONNAIRE, ADMIN)', async () => {
  const fakeDb = {
    cfg: { server: 'x', port: 1433, database: 'PaieGestion' },
    query: async (sql) => {
      if (/FROM paie\.Rubrique r ORDER BY/.test(sql)) return [{ Id: 1, Code: 'SALBASE', Libelle: 'Salaire de base', Type: 'GAIN', ModeCalcul: 'AUTO', EstSysteme: 1, Actif: 1 }];
      if (/FROM paie\.EmployeRubrique er/.test(sql)) return [];
      if (/FROM paie\.PlanComptable/.test(sql)) return [];
      return [];
    },
    close: async () => {},
  };
  const fakeConfig = { loadConfig: () => ({ cfg: { server: 'x', database: 'PaieGestion' } }), saveConfig: () => ({ encrypted: true }), publicView: (c) => c };
  const host = createWebHost({ config: fakeConfig, Database: { test: async () => ({ ok: true }) }, openDatabase: async () => fakeDb, cleanCfg: (i) => i });
  await host.init();
  const port = await host.listen();

  const call = (channel, args = []) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ channel, args });
    const r = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/call',
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json', Cookie: `paie=${host.token}` },
    }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    r.on('error', reject); r.write(body); r.end();
  });

  try {
    // LECTEUR : lecture seule
    host.setUserForTests({ id: 1, login: 'l', nom: 'Lecteur', role: 'LECTEUR' });
    assert.equal((await call('rub:all')).ok, true);
    assert.equal((await call('emprub:list')).ok, true);
    assert.match((await call('emprub:save', [{}])).error, /Droits insuffisants/);
    assert.match((await call('rub:save', [{}])).error, /Droits insuffisants/);

    // COMPTABLE : lecture seule sur rubriques et affectations
    host.setUserForTests({ id: 2, login: 'c', nom: 'Comptable', role: 'COMPTABLE' });
    assert.equal((await call('emprub:list')).ok, true);
    assert.match((await call('emprub:save', [{}])).error, /Droits insuffisants/);
    assert.match((await call('emprub:close', [1, '2026-12-31'])).error, /Droits insuffisants/);

    // GESTIONNAIRE : peut gérer les affectations (validation déclenchée), mais pas modifier le catalogue (admin)
    host.setUserForTests({ id: 3, login: 'g', nom: 'Gestionnaire', role: 'GESTIONNAIRE' });
    assert.match((await call('emprub:save', [{}])).error, /obligatoires/);
    assert.match((await call('rub:save', [{}])).error, /Droits insuffisants/);

    // ADMIN : accès complet au catalogue (validation métier déclenchée)
    host.setUserForTests({ id: 4, login: 'a', nom: 'Admin', role: 'ADMIN' });
    assert.match((await call('rub:save', [{ Libelle: 'Test', CompteComptable: '9999' }])).error, /Compte comptable inconnu/);
  } finally {
    await host.close();
  }
});
