'use strict';

/** Vérifie que le schéma « paie » (script PaieGestion_schema.sql) existe, et ajoute les compléments de cette application. */
// Réduction d'impôt pour charges de famille : [parts, taux %, minimum, maximum] — À CONFIRMER (voir README).
const REDUCTION_FAMILLE = [
  [1.5, 10, 100000, 300000], [2, 15, 200000, 650000], [2.5, 20, 300000, 1100000], [3, 25, 400000, 1650000],
  [3.5, 30, 500000, 2030000], [4, 35, 600000, 2490000], [4.5, 40, 700000, 2755000], [5, 45, 800000, 3180000],
];
const reductionSql = () => {
  const vals = [];
  for (const [parts, taux, mini, maxi] of REDUCTION_FAMILLE) {
    const lib = String(parts).replace('.', ',');
    vals.push(`(N'RED_FAM_${parts}_TAUX', N'Réduction charges de famille ${lib} part(s) : taux (%)', ${taux})`);
    vals.push(`(N'RED_FAM_${parts}_MIN', N'Réduction charges de famille ${lib} part(s) : minimum annuel (FCFA)', ${mini})`);
    vals.push(`(N'RED_FAM_${parts}_MAX', N'Réduction charges de famille ${lib} part(s) : maximum annuel (FCFA)', ${maxi})`);
  }
  return `INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
SELECT v.Code, v.Libelle, v.Valeur, '2026-01-01', N'Réduction pour charges de famille - à confirmer au CGI', 0
FROM (VALUES ${vals.join(',\n')}) v(Code, Libelle, Valeur)
WHERE NOT EXISTS (SELECT 1 FROM paie.ParametreLegal p WHERE p.Code = v.Code);`;
};

const IPM_SQL = `
IF NOT EXISTS (SELECT 1 FROM paie.Rubrique WHERE Code = N'IPM_SAL')
  INSERT INTO paie.Rubrique (Code, Libelle, Type, Imposable, SoumisCotisation, Ordre) VALUES (N'IPM_SAL', N'IPM (salarié)', N'COTIS_SAL', 0, 0, 215);
IF NOT EXISTS (SELECT 1 FROM paie.Rubrique WHERE Code = N'IPM_PAT')
  INSERT INTO paie.Rubrique (Code, Libelle, Type, Imposable, SoumisCotisation, Ordre) VALUES (N'IPM_PAT', N'IPM (employeur)', N'COTIS_PAT', 0, 0, 515);
INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
SELECT v.Code, v.Libelle, v.Valeur, '2026-01-01', v.Source, v.Verifie
FROM (VALUES
  (N'IPM_SAL', N'IPM : part salariale (%)', 5, N'Communiqué par l''entreprise', 1),
  (N'IPM_PAT', N'IPM : part patronale (%)', 6, N'Communiqué par l''entreprise', 1),
  (N'IPM_PLAFOND_SAL', N'IPM : plafond mensuel de la part salariale (FCFA)', 12500, N'Déduit du bulletin de référence d''octobre 2026', 1),
  (N'IPM_PLAFOND_PAT', N'IPM : plafond mensuel de la part patronale (FCFA)', 15000, N'Communiqué par l''entreprise et bulletin de référence', 1)
) v(Code, Libelle, Valeur, Source, Verifie)
WHERE NOT EXISTS (SELECT 1 FROM paie.ParametreLegal p WHERE p.Code = v.Code);
-- Corrections issues du bulletin de référence : plafond IPM salarié 12 500, IPM non utilisé comme déduction IR,
-- indemnité de transport exonérée (ni imposable, ni soumise à cotisations)
UPDATE paie.ParametreLegal SET Valeur = 12500, Source = N'Déduit du bulletin de référence d''octobre 2026'
  WHERE Code = N'IPM_PLAFOND_SAL' AND Valeur = 15000;
DELETE FROM paie.ParametreLegal WHERE Code = N'IPM_DEDUCTIBLE_IR';
-- Transport : exonéré jusqu'à 26 000 FCFA par mois, l'excédent est imposable (une seule fois : le plafond reste modifiable)
IF NOT EXISTS (SELECT 1 FROM paie.ParametreLegal WHERE Code = N'EXO_PRIME_TRANS')
BEGIN
  INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
  VALUES (N'EXO_PRIME_TRANS', N'Exonération mensuelle maximale : indemnité de transport (FCFA)', 26000, '2026-01-01', N'Communiqué par l''entreprise', 1);
  UPDATE paie.Rubrique SET Imposable = 1, SoumisCotisation = 1 WHERE Code = N'PRIME_TRANS';
END;`;

const fs = require('fs');
const path = require('path');
const MIGRATION02 = path.join(__dirname, '..', '..', 'sql', 'migration_02.sql');
const MIGRATION03 = path.join(__dirname, '..', '..', 'sql', 'migration_03.sql');
const MIGRATION04 = path.join(__dirname, '..', '..', 'sql', 'migration_04.sql');
const MIGRATION05 = path.join(__dirname, '..', '..', 'sql', 'migration_05.sql');
const MIGRATION06 = path.join(__dirname, '..', '..', 'sql', 'migration_06.sql');

/** Crée les tables/colonnes des congés, catégories et comptabilité si elles manquent (nécessite le droit de créer des tables). */
async function ensureMigration02(db) {
  const r = (await db.query(`SELECT
    OBJECT_ID(N'paie.Categorie', N'U') AS a, OBJECT_ID(N'paie.ClasseProfessionnelle', N'U') AS b,
    OBJECT_ID(N'paie.PlanComptable', N'U') AS c, OBJECT_ID(N'paie.CompteRubrique', N'U') AS d, OBJECT_ID(N'paie.ParametreCompta', N'U') AS e,
    COL_LENGTH(N'paie.Employe', N'ConjointTravaille') AS f, COL_LENGTH(N'paie.Employe', N'SoldeCongesInitial') AS g,
    COL_LENGTH(N'paie.Employe', N'DateSoldeConges') AS h`))[0];
  if (Object.values(r).every((v) => v != null)) return;
  try {
    await db.batch(fs.readFileSync(MIGRATION02, 'utf8'));
  } catch (e) {
    throw new Error("Une mise à jour de la base est nécessaire (congés, catégories, comptabilité). Dans SSMS : sélectionnez la base « " + db.cfg.database +
      " », ouvrez le fichier « migration_02.sql » (dossier « sql » de PaieGestion), exécutez-le, puis relancez PaieGestion. (" + e.message + ')');
  }
}

/** Ajoute les colonnes du module autonome Rubriques de paie et enrichit EmployeRubrique si elles manquent. */
async function ensureMigration03(db) {
  const r = (await db.query(`SELECT
    COL_LENGTH(N'paie.Rubrique', N'ModeCalcul') AS a,
    COL_LENGTH(N'paie.Rubrique', N'SoumisCfceTrimf') AS b,
    COL_LENGTH(N'paie.Rubrique', N'PlafondExoneration') AS c,
    COL_LENGTH(N'paie.Rubrique', N'CompteComptable') AS d,
    COL_LENGTH(N'paie.Rubrique', N'EstSysteme') AS e,
    COL_LENGTH(N'paie.EmployeRubrique', N'Actif') AS f,
    COL_LENGTH(N'paie.EmployeRubrique', N'Commentaire') AS g`))[0];
  if (Object.values(r).every((v) => v != null)) return;
  try {
    await db.batch(fs.readFileSync(MIGRATION03, 'utf8'));
  } catch (e) {
    throw new Error("Une mise à jour de la base est nécessaire (module Rubriques de paie). Dans SSMS : sélectionnez la base « " + db.cfg.database +
      " », ouvrez le fichier « migration_03.sql » (dossier « sql » de PaieGestion), exécutez-le, puis relancez PaieGestion. (" + e.message + ')');
  }
}

/** Ajoute les colonnes de cumul annuel (IR/TRIMF) de la table des bulletins et le paramètre IR_SORTIE_MODE. */
async function ensureMigration04(db) {
  const r = (await db.query(`SELECT COL_LENGTH(N'paie.BulletinPaie', N'BrutImposable') AS a, COL_LENGTH(N'paie.BulletinPaie', N'BrutCfceTrimf') AS b,
    (SELECT COUNT(*) FROM paie.ParametreLegal WHERE Code = N'IR_SORTIE_MODE') AS c`))[0];
  if (r.a != null && r.b != null && r.c > 0) return;
  try {
    await db.batch(fs.readFileSync(MIGRATION04, 'utf8'));
  } catch (e) {
    throw new Error("Une mise à jour de la base est nécessaire (cumul annuel de l'IR et de la TRIMF). Dans SSMS : sélectionnez la base « " + db.cfg.database +
      " », ouvrez le fichier « migration_04.sql » (dossier « sql » de PaieGestion), exécutez-le, puis relancez PaieGestion. (" + e.message + ')');
  }
}

/** Ajoute la base de retenue (brut imposable / net après impôt) et le remboursement de prêt échelonné. */
/** Corrige les plafonds de la réduction d'impôt pour charges de famille (barème fourni : 3 / 3,5 / 4 / 4,5 parts). */
async function ensureMigration06(db) {
  const attendu = REDUCTION_FAMILLE.map(([n, , , maxi]) => `(N'RED_FAM_${n}_MAX', ${maxi})`).join(',');
  const r = (await db.query(`SELECT COUNT(*) AS n FROM paie.ParametreLegal p JOIN (VALUES ${attendu}) v(Code, Maxi) ON v.Code = p.Code
    WHERE p.DateFin IS NULL AND p.Valeur <> v.Maxi`))[0];
  if (!r.n) return;
  try {
    await db.batch(fs.readFileSync(MIGRATION06, 'utf8'));
  } catch (e) {
    throw new Error("Une mise à jour de la base est nécessaire (barème des charges de famille). Dans SSMS : sélectionnez la base « " + db.cfg.database +
      " », ouvrez le fichier « migration_06.sql » (dossier « sql » de PaieGestion), exécutez-le, puis relancez PaieGestion. (" + e.message + ')');
  }
}

async function ensureMigration05(db) {
  const r = (await db.query(`SELECT COL_LENGTH(N'paie.Rubrique', N'BaseRetenue') AS a, COL_LENGTH(N'paie.Rubrique', N'Echelonne') AS b,
    COL_LENGTH(N'paie.EmployeRubrique', N'MontantPret') AS c, COL_LENGTH(N'paie.EmployeRubrique', N'DureeMois') AS d`))[0];
  if (r.a != null && r.b != null && r.c != null && r.d != null) return;
  try {
    await db.batch(fs.readFileSync(MIGRATION05, 'utf8'));
  } catch (e) {
    throw new Error("Une mise à jour de la base est nécessaire (prêts et base de retenue). Dans SSMS : sélectionnez la base « " + db.cfg.database +
      " », ouvrez le fichier « migration_05.sql » (dossier « sql » de PaieGestion), exécutez-le, puis relancez PaieGestion. (" + e.message + ')');
  }
}

// Données de départ des modules congés, catégories et comptabilité (modifiables ensuite dans l'application)
const CATEGORIES = [['1', 'Catégorie 1'], ['2', 'Catégorie 2'], ['3', 'Catégorie 3'], ['4', 'Catégorie 4'], ['5', 'Catégorie 5'],
  ['6', 'Catégorie 6'], ['7', 'Catégorie 7'], ['8', 'Catégorie 8'], ['HC', 'Hors catégorie']];
// Plan comptable (propositions SYSCOHADA à faire valider par votre comptable)
const PLAN = [
  ['421', 'Personnel, avances et acomptes'], ['422', 'Personnel, rémunérations dues'],
  ['4311', 'Sécurité sociale (CSS)'], ['4312', 'IPRES — régime général'], ['4321', 'IPRES — régime complémentaire cadres'],
  ['4331', 'IPM — institution de prévoyance maladie'],
  ['4471', "État, impôt sur le revenu retenu à la source (IR)"], ['4472', 'État, taxes sur salaires (CFCE)'], ['4478', 'État, autres impôts retenus (TRIMF)'],
  ['6413', 'Taxes sur appointements et salaires (CFCE)'],
  ['6611', 'Appointements, salaires et commissions'], ['6612', 'Primes et gratifications'], ['6613', 'Congés payés'],
  ['6617', 'Avantages en nature'], ['6631', 'Indemnités de logement'], ['6632', 'Indemnités de représentation'],
  ['6634', 'Indemnités de transport'], ['6638', 'Autres indemnités et avantages divers'],
  ['6641', 'Charges sociales sur rémunérations du personnel national'],
];
// Code de rubrique → [compte débit, compte crédit]
const COMPTES_RUBRIQUES = {
  SALBASE: ['6611', null], ABS_NR: ['6611', null], HEURES_SUP: ['6611', null], PRIME_ANC: ['6612', null], PRIME_EXC: ['6612', null],
  PRIME_TRANS: ['6634', null], PRIME_LOG: ['6631', null], AVANTAGE_NAT: ['6617', null],
  IPRES_RG_SAL: [null, '4312'], IPRES_RCC_SAL: [null, '4321'], IPM_SAL: [null, '4331'], IR: [null, '4471'], TRIMF: [null, '4478'],
  AVANCE: [null, '421'], PRET: [null, '421'], ABSENCE: [null, '6611'],
  IPRES_RG_PAT: ['6641', '4312'], IPRES_RCC_PAT: ['6641', '4321'], IPM_PAT: ['6641', '4331'],
  CSS_PF_PAT: ['6641', '4311'], CSS_ATMP_PAT: ['6641', '4311'], CFCE_PAT: ['6413', '4472'],
};
const PARAMS_COMPTA = [
  ['COMPTE_REMUNERATION_DUE', '422'], ['CODE_JOURNAL', 'OD'], ['COMPTE_GAIN_DEFAUT', '6611'], ['COMPTE_RETENUE_DEFAUT', '421'],
  ['COMPTE_COTIS_SAL_DEFAUT', '4312'], ['COMPTE_IMPOT_DEFAUT', '4471'], ['COMPTE_CHARGE_PAT_DEFAUT', '6641'], ['COMPTE_ORGANISME_PAT_DEFAUT', '4312'],
];
const q = (v) => (v == null ? 'NULL' : `N'${String(v).replace(/'/g, "''")}'`);

function seed02Sql() {
  return `
IF NOT EXISTS (SELECT 1 FROM paie.Rubrique WHERE Code = N'ABS_NR')
  INSERT INTO paie.Rubrique (Code, Libelle, Type, Imposable, SoumisCotisation, Ordre) VALUES (N'ABS_NR', N'Absences non rémunérées', N'GAIN', 1, 1, 15);
INSERT INTO paie.TypeConge (Code, Libelle, Remunere)
SELECT v.Code, v.Libelle, v.Remunere FROM (VALUES
  (N'ABS_INJ', N'Absence injustifiée', 0), (N'ABS_JUST', N'Absence autorisée (payée)', 1), (N'PATERNITE', N'Congé de paternité', 1)
) v(Code, Libelle, Remunere) WHERE NOT EXISTS (SELECT 1 FROM paie.TypeConge t WHERE t.Code = v.Code);
INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
SELECT v.Code, v.Libelle, v.Valeur, '2026-01-01', v.Source, 0 FROM (VALUES
  (N'CONGE_JOURS_PAR_MOIS', N'Congés payés : jours ouvrables acquis par mois de service', 2, N'Code du travail - à confirmer'),
  (N'ABSENCE_DIVISEUR', N'Absences non rémunérées : diviseur du salaire de base (retenue = base / diviseur x jours)', 30, N'Pratique courante - à confirmer')
) v(Code, Libelle, Valeur, Source) WHERE NOT EXISTS (SELECT 1 FROM paie.ParametreLegal p WHERE p.Code = v.Code);
INSERT INTO paie.Categorie (Code, Libelle)
SELECT v.Code, v.Libelle FROM (VALUES ${CATEGORIES.map(([c, l]) => `(${q(c)}, ${q(l)})`).join(', ')}) v(Code, Libelle)
WHERE NOT EXISTS (SELECT 1 FROM paie.Categorie c WHERE c.Code = v.Code);
INSERT INTO paie.PlanComptable (Compte, Libelle)
SELECT v.Compte, v.Libelle FROM (VALUES ${PLAN.map(([c, l]) => `(${q(c)}, ${q(l)})`).join(',\n  ')}) v(Compte, Libelle)
WHERE NOT EXISTS (SELECT 1 FROM paie.PlanComptable x WHERE x.Compte = v.Compte);
INSERT INTO paie.CompteRubrique (RubriqueId, CompteDebit, CompteCredit)
SELECT r.Id, v.D, v.C FROM (VALUES ${Object.entries(COMPTES_RUBRIQUES).map(([code, [d, c]]) => `(${q(code)}, ${q(d)}, ${q(c)})`).join(',\n  ')}) v(Code, D, C)
JOIN paie.Rubrique r ON r.Code = v.Code
WHERE NOT EXISTS (SELECT 1 FROM paie.CompteRubrique x WHERE x.RubriqueId = r.Id);
INSERT INTO paie.ParametreCompta (Cle, Valeur)
SELECT v.Cle, v.Valeur FROM (VALUES ${PARAMS_COMPTA.map(([k, val]) => `(${q(k)}, ${q(val)})`).join(', ')}) v(Cle, Valeur)
WHERE NOT EXISTS (SELECT 1 FROM paie.ParametreCompta x WHERE x.Cle = v.Cle);`;
}

async function ensureSchema(db) {
  const r = await db.query("SELECT OBJECT_ID(N'paie.Employe', N'U') AS id");
  if (!r[0].id) {
    throw new Error(
      `Les tables de la paie sont absentes de la base « ${db.cfg.database} ». ` +
      "Exécutez d'abord le script PaieGestion_schema.sql dans SSMS (base PaieGestion), puis relancez.");
  }
  await ensureMigration02(db);
  await db.batch(IPM_SQL);
  await db.batch(`
IF OBJECT_ID(N'paie.Entreprise', N'U') IS NULL
BEGIN
  CREATE TABLE paie.Entreprise (
    Id INT NOT NULL CONSTRAINT PK_Entreprise PRIMARY KEY CONSTRAINT CK_Entreprise_Id CHECK (Id = 1),
    Nom NVARCHAR(150) NOT NULL, Adresse NVARCHAR(200) NULL, Ville NVARCHAR(100) NULL,
    Telephone NVARCHAR(50) NULL, NINEA NVARCHAR(50) NULL,
    NumeroIPRES NVARCHAR(50) NULL, NumeroCSS NVARCHAR(50) NULL
  );
END;
IF NOT EXISTS (SELECT 1 FROM paie.Entreprise) INSERT INTO paie.Entreprise (Id, Nom) VALUES (1, N'Mon entreprise');

-- Compléments issus du support de cours IR/CFCE/TRIMF (valeurs à vérifier au CGI : Verifie = 0)
IF NOT EXISTS (SELECT 1 FROM paie.ParametreLegal WHERE Code = N'ABATTEMENT_IR_PLAFOND')
  INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
  VALUES (N'ABATTEMENT_IR_PLAFOND', N'IR : plafond annuel de l''abattement de 30 % (FCFA)', 900000, '2026-01-01', N'Support de cours Impôts directs ESP 2023 - à vérifier au CGI', 0);
IF NOT EXISTS (SELECT 1 FROM paie.ParametreLegal WHERE Code = N'TRIMF_REGLE')
  INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
  VALUES (N'TRIMF_REGLE', N'TRIMF et IR : 1 = TRIMF ajoutée à l''IR ; 2 = seule la plus élevée des deux ; 3 = TRIMF non due si IR > 0', 1, '2026-01-01', N'Règle à confirmer avec votre comptable / la DGID', 0);
IF NOT EXISTS (SELECT 1 FROM paie.BaremeTRIMF)
  INSERT INTO paie.BaremeTRIMF (SalaireMin, SalaireMax, Montant, DateDebut, Verifie) VALUES
   (0, 599999, 900, '2026-01-01', 0), (600000, 999999, 3600, '2026-01-01', 0), (1000000, 1999999, 4800, '2026-01-01', 0),
   (2000000, 6999999, 12000, '2026-01-01', 0), (7000000, 11999999, 18000, '2026-01-01', 0), (12000000, NULL, 36000, '2026-01-01', 0);

-- Barème IR à 7 tranches (document fourni : dernière tranche 40 % jusqu'à 50 000 000, puis 43 %)
IF EXISTS (SELECT 1 FROM paie.BaremeIR WHERE TrancheMin = 13500000 AND TrancheMax IS NULL AND Taux = 40 AND DateFin IS NULL)
  UPDATE paie.BaremeIR SET TrancheMax = 50000000 WHERE TrancheMin = 13500000 AND TrancheMax IS NULL AND Taux = 40 AND DateFin IS NULL;
IF EXISTS (SELECT 1 FROM paie.BaremeIR WHERE TrancheMin = 13500000 AND TrancheMax = 50000000 AND DateFin IS NULL)
   AND NOT EXISTS (SELECT 1 FROM paie.BaremeIR WHERE TrancheMin = 50000000 AND DateFin IS NULL)
  INSERT INTO paie.BaremeIR (TrancheMin, TrancheMax, Taux, DateDebut, Verifie) VALUES (50000000, NULL, 43, '2026-01-01', 0);
UPDATE b SET Verifie = 1
FROM paie.BaremeIR b
JOIN (VALUES (0, 630000, 0), (630000, 1500000, 20), (1500000, 4000000, 30), (4000000, 8000000, 35),
             (8000000, 13500000, 37), (13500000, 50000000, 40), (50000000, NULL, 43)) v(mn, mx, tx)
  ON b.TrancheMin = v.mn AND ISNULL(b.TrancheMax, -1) = ISNULL(v.mx, -1) AND b.Taux = v.tx
WHERE b.DateFin IS NULL AND b.Verifie = 0;
`);
  await db.batch(reductionSql());
  await db.batch(seed02Sql());
  await ensureMigration03(db);
  await ensureMigration04(db);
  await ensureMigration05(db);
  await ensureMigration06(db);
}

module.exports = { ensureSchema, ensureMigration03, ensureMigration04, MIGRATION04, ensureMigration05, MIGRATION05, ensureMigration06, MIGRATION06, REDUCTION_FAMILLE, reductionSql, IPM_SQL, seed02Sql, MIGRATION02, MIGRATION03, COMPTES_RUBRIQUES, PARAMS_COMPTA };
