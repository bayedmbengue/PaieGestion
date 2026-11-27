'use strict';
// Absence non rémunérée : retenue sur la paie du mois, qui réduit le brut (donc cotisations et impôt).
const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../src/main/repo');
const { REDUCTION_FAMILLE } = require('../src/main/migrate');
const { bulletinsDocument } = require('../src/main/bulletin');

const params = [['IPRES_RG_SAL', 5.6], ['IPRES_RG_PAT', 8.4], ['IPRES_RG_PLAFOND', 432000], ['IPRES_RCC_SAL', 2.4], ['IPRES_RCC_PAT', 3.6], ['IPRES_RCC_PLAFOND', 1296000],
  ['CSS_PF_PAT', 7], ['CSS_ATMP_PAT', 1], ['CSS_PLAFOND', 63000], ['CFCE_PAT', 3], ['ABATTEMENT_IR', 30], ['ABATTEMENT_IR_PLAFOND', 900000],
  ['IPM_SAL', 5], ['IPM_PAT', 6], ['IPM_PLAFOND_SAL', 12500], ['IPM_PLAFOND_PAT', 15000], ['ABSENCE_DIVISEUR', 30]].map(([Code, Valeur]) => ({ Code, Valeur }))
  .concat(REDUCTION_FAMILLE.flatMap(([n, t, mi, ma]) => [{ Code: `RED_FAM_${n}_TAUX`, Valeur: t }, { Code: `RED_FAM_${n}_MIN`, Valeur: mi }, { Code: `RED_FAM_${n}_MAX`, Valeur: ma }]));
const RUB = ['SALBASE', 'ABS_NR', 'IPRES_RG_SAL', 'IPRES_RCC_SAL', 'IPM_SAL', 'IR', 'TRIMF', 'IPRES_RG_PAT', 'IPRES_RCC_PAT', 'IPM_PAT', 'CSS_PF_PAT', 'CSS_ATMP_PAT', 'CFCE_PAT'];

function fake(absences) {
  const inserted = { bulletins: [], lignes: [] };
  const run = async (sql, p) => {
    if (/FROM paie\.Conge c/.test(sql)) return absences;
    if (/FROM paie\.BulletinPaie b JOIN paie\.PeriodePaie/.test(sql)) return [];
    if (/FROM paie\.PresencePeriode/.test(sql)) return [];
    if (/FROM paie\.PeriodePaie WHERE Id/.test(sql)) return [{ Id: 1, Annee: 2026, Mois: 11, Cloturee: false }];
    if (/FROM paie\.ParametreLegal/.test(sql)) return params;
    if (/FROM paie\.BaremeIR/.test(sql)) return [{ TrancheMin: 0, TrancheMax: 630000, Taux: 0 }, { TrancheMin: 630000, TrancheMax: 1500000, Taux: 20 }, { TrancheMin: 1500000, TrancheMax: 4000000, Taux: 30 }];
    if (/FROM paie\.BaremeTRIMF/.test(sql)) return [];
    if (/FROM paie\.Rubrique$/.test(sql.trim())) return RUB.map((Code, i) => ({ Id: i + 1, Code, Libelle: Code === 'ABS_NR' ? 'Absences non rémunérées' : Code, Ordre: i * 10 }));
    if (/FROM paie\.Employe e/.test(sql)) return [{ Id: 7, EstCadre: 0, NombreParts: 1, SituationFamiliale: 'C', ConjointTravaille: false, SalaireBase: 300000 }];
    if (/UNION ALL/.test(sql)) return [];
    if (/DELETE FROM paie\.BulletinPaie/.test(sql)) return [];
    if (/INSERT INTO paie\.BulletinPaie/.test(sql)) { inserted.bulletins.push(p); return [{ Id: 99 }]; }
    if (/INSERT INTO paie\.LigneBulletin/.test(sql)) { inserted.lignes.push(p); return []; }
    throw new Error('Requête inattendue : ' + sql.slice(0, 80));
  };
  return { inserted, query: async () => [{ n: 0 }], tx: async (fn) => fn(run) };
}

test('3 jours d\'absence non payée sur 300 000 FCFA : retenue de 30 000 (base / 30 × 3), brut réduit', async () => {
  const db = fake([{ DateDebut: '2026-11-10', DateFin: '2026-11-12', NombreJours: 3 }]);
  await repo.calculerPeriode(db, 1, null);
  const b = db.inserted.bulletins[0];
  assert.equal(b.brut, 270000);
  assert.equal(b.ts, 15120 + 12500);              // IPRES 5,6 % de 270 000 + IPM plafonné (13 500 → 12 500)
  const l = db.inserted.lignes.find((x) => x.l.startsWith('Absences'));
  assert.equal(l.l, 'Absences non rémunérées (3 j)');
  assert.equal(l.g, -30000);                      // gain négatif
});

test("absence à cheval sur deux mois : seule la part de novembre est retenue", async () => {
  const db = fake([{ DateDebut: '2026-11-25', DateFin: '2026-12-05', NombreJours: 10 }]);
  await repo.calculerPeriode(db, 1, null);
  assert.equal(db.inserted.bulletins[0].brut, 300000 - 5 * 10000);   // 5 jours en novembre
});

test('sans absence : aucune ligne de retenue', async () => {
  const db = fake([]);
  await repo.calculerPeriode(db, 1, null);
  assert.equal(db.inserted.bulletins[0].brut, 300000);
  assert.ok(!db.inserted.lignes.some((x) => x.l.startsWith('Absences')));
});

test("la retenue d'absence ne dépasse jamais le salaire de base", async () => {
  const db = fake([{ DateDebut: '2026-11-02', DateFin: '2026-11-30', NombreJours: 99 }]);
  await repo.calculerPeriode(db, 1, null);
  assert.equal(db.inserted.bulletins[0].brut, 0);
});

test('le bulletin affiche la retenue d\'absence, la catégorie, la classe et le solde de congés', () => {
  const html = bulletinsDocument({
    periode: { Annee: 2026, Mois: 11 }, entreprise: { Nom: 'ACME' },
    bulletins: [{ Nom: 'DIOP', Prenom: 'Awa', Matricule: 'M1', DateEmbauche: '2024-03-01', SituationFamiliale: 'C', NombreEnfants: 0, NombreParts: 1, EstCadre: 0, ModePaiement: 'VIREMENT',
      Categorie: '2', CategorieLibelle: 'Catégorie 2', Echelon: 'B', ClasseLibelle: 'Classe B', conge: { acquis: 46, pris: 10, solde: 36 },
      Brut: 270000, TotalCotisSalariales: 27620, ImpotRevenu: 0, TRIMF: 0, AutresRetenues: 0, Net: 242380, TotalCotisPatronales: 0, CoutEmployeur: 270000,
      lignes: [{ Libelle: 'Salaire de base', MontantGain: 300000, MontantRetenue: 0, MontantPatronal: 0 }, { Libelle: 'Absences non rémunérées (3 j)', MontantGain: -30000, MontantRetenue: 0, MontantPatronal: 0 }] }],
  });
  assert.match(html, /Absences non rémunérées \(3 j\)/);
  assert.match(html, /-30 000/);
  assert.match(html, /Catégorie 2/);
  assert.match(html, /Classe B/);
  assert.match(html, /Solde : 36 j/);
});
