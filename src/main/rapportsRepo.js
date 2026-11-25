'use strict';
/**
 * Requêtes SQL en LECTURE SEULE et strictement paramétrées pour le module « Rapports ».
 * Aucune instruction d'écriture (INSERT / UPDATE / DELETE / DDL) dans ce fichier.
 */
const conges = require('./conges');
const { REPORT_TYPES, buildReport } = require('./rapports');

const intIn = (v, min, max, def) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
};
const optId = (v) => {
  if (v === '' || v == null) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const optCode = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, 20) : null;
};
const optDate = (v, def) => {
  const s = String(v == null ? '' : v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : def;
};

function normalizeFilters(type, raw = {}) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const annee = intIn(raw.annee, 2000, 2100, curYear);
  const mois = intIn(raw.mois, 1, 12, curMonth);
  let moisDebut = intIn(raw.moisDebut, 1, 12, type === 'annuel' || type === 'historique' || type === 'decl_1024' ? 1 : mois);
  let moisFin = intIn(raw.moisFin, 1, 12, type === 'annuel' || type === 'historique' || type === 'decl_1024' ? 12 : mois);
  if (moisFin < moisDebut) [moisDebut, moisFin] = [moisFin, moisDebut];
  let dateDebut = optDate(raw.dateDebut, `${annee}-01-01`);
  let dateFin = optDate(raw.dateFin, `${annee}-12-31`);
  if (dateFin < dateDebut) [dateDebut, dateFin] = [dateFin, dateDebut];
  const statut = ['DEMANDE', 'APPROUVE', 'REFUSE', 'PRIS'].includes(raw.statut) ? raw.statut : null;
  const actif = ['0', '1', 'ALL'].includes(String(raw.actif)) ? String(raw.actif) : '1';
  const organisme = ['TOUS', 'IPRES', 'CSS', 'IPM'].includes(raw.organisme) ? raw.organisme : 'TOUS';
  const vue = String(raw.vue || '');
  return {
    annee, mois, moisDebut, moisFin, dateDebut, dateFin,
    employeId: optId(raw.employeId),
    categorie: optCode(raw.categorie),
    statut, actif, organisme, vue,
  };
}

/** Options de filtres : tous les employés (actifs + inactifs pour l'historique), catégories et années disponibles. */
async function getFilterOptions(db) {
  const employes = await db.query(`
    SELECT e.Id, e.Matricule, e.Nom, e.Prenom, e.Actif, k.Categorie
    FROM paie.Employe e
    OUTER APPLY (SELECT TOP 1 c.Categorie FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
    ORDER BY e.Nom, e.Prenom`);
  const categories = await db.query('SELECT Code, Libelle, Actif FROM paie.Categorie ORDER BY Code');
  const anneesRows = await db.query(`
    SELECT DISTINCT Annee FROM paie.PeriodePaie
    UNION
    SELECT DISTINCT YEAR(DateDebut) AS Annee FROM paie.Conge
    ORDER BY Annee DESC`);
  const curYear = new Date().getFullYear();
  const anneesSet = new Set([curYear, ...anneesRows.map((r) => Number(r.Annee)).filter(Number.isFinite)]);
  const annees = [...anneesSet].sort((a, b) => b - a);
  return { employes, categories, annees };
}

async function resolveMeta(db, f) {
  const meta = {};
  if (f.employeId) {
    const e = (await db.query('SELECT Matricule, Nom, Prenom FROM paie.Employe WHERE Id = @id', { id: f.employeId }))[0];
    if (e) meta.employeLabel = `${e.Nom} ${e.Prenom} (${e.Matricule})`;
  }
  if (f.categorie) {
    const c = (await db.query('SELECT Code, Libelle FROM paie.Categorie WHERE Code = @c', { c: f.categorie }))[0];
    meta.categorieLabel = c ? `${c.Code} — ${c.Libelle}` : f.categorie;
  }
  return meta;
}

const queryBulletinsPeriode = (db, { annee, moisDebut, moisFin, employeId, categorie }) => db.query(`
  SELECT p.Annee, p.Mois, b.Id, b.EmployeId, e.Matricule, e.Nom, e.Prenom,
         k.Categorie, b.SalaireBase, b.Brut, b.BaseImposable, b.BaseIPRES,
         b.TotalCotisSalariales, b.ImpotRevenu, b.TRIMF, b.AutresRetenues,
         b.Net, b.TotalCotisPatronales, b.CoutEmployeur, b.NombreParts
  FROM paie.BulletinPaie b
  JOIN paie.PeriodePaie p ON p.Id = b.PeriodeId
  JOIN paie.Employe e ON e.Id = b.EmployeId
  OUTER APPLY (SELECT TOP 1 c.Categorie FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
  WHERE p.Annee = @annee AND p.Mois BETWEEN @moisDebut AND @moisFin
    AND (@emp IS NULL OR e.Id = @emp)
    AND (@cat IS NULL OR k.Categorie = @cat)
  ORDER BY p.Annee, p.Mois, e.Nom, e.Prenom`,
{ annee, moisDebut, moisFin, emp: employeId, cat: categorie });

const queryCotisations = (db, { annee, moisDebut, moisFin, employeId, categorie }) => db.query(`
  SELECT e.Id AS EmployeId, e.Matricule, e.Nom, e.Prenom, e.EstCadre,
         e.NumeroIPRES, e.NumeroCSS, k.Categorie,
         SUM(b.Brut) AS Brut,
         SUM(b.BaseImposable) AS BaseImposable,
         SUM(b.BaseIPRES) AS BaseIPRES,
         SUM(ISNULL(lb.IpresRgSal, 0)) AS IpresRgSal,
         SUM(ISNULL(lb.IpresRgPat, 0)) AS IpresRgPat,
         SUM(ISNULL(lb.IpresRccSal, 0)) AS IpresRccSal,
         SUM(ISNULL(lb.IpresRccPat, 0)) AS IpresRccPat,
         SUM(ISNULL(lb.CssPfPat, 0)) AS CssPfPat,
         SUM(ISNULL(lb.CssAtmpPat, 0)) AS CssAtmpPat,
         SUM(ISNULL(lb.IpmSal, 0)) AS IpmSal,
         SUM(ISNULL(lb.IpmPat, 0)) AS IpmPat
  FROM paie.BulletinPaie b
  JOIN paie.PeriodePaie p ON p.Id = b.PeriodeId
  JOIN paie.Employe e ON e.Id = b.EmployeId
  OUTER APPLY (SELECT TOP 1 c.Categorie FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
  OUTER APPLY (
    SELECT
      SUM(CASE WHEN r.Code = N'IPRES_RG_SAL'  THEN l.MontantRetenue  ELSE 0 END) AS IpresRgSal,
      SUM(CASE WHEN r.Code = N'IPRES_RG_PAT'  THEN l.MontantPatronal ELSE 0 END) AS IpresRgPat,
      SUM(CASE WHEN r.Code = N'IPRES_RCC_SAL' THEN l.MontantRetenue  ELSE 0 END) AS IpresRccSal,
      SUM(CASE WHEN r.Code = N'IPRES_RCC_PAT' THEN l.MontantPatronal ELSE 0 END) AS IpresRccPat,
      SUM(CASE WHEN r.Code = N'CSS_PF_PAT'    THEN l.MontantPatronal ELSE 0 END) AS CssPfPat,
      SUM(CASE WHEN r.Code = N'CSS_ATMP_PAT'  THEN l.MontantPatronal ELSE 0 END) AS CssAtmpPat,
      SUM(CASE WHEN r.Code = N'IPM_SAL'       THEN l.MontantRetenue  ELSE 0 END) AS IpmSal,
      SUM(CASE WHEN r.Code = N'IPM_PAT'       THEN l.MontantPatronal ELSE 0 END) AS IpmPat
    FROM paie.LigneBulletin l
    JOIN paie.Rubrique r ON r.Id = l.RubriqueId
    WHERE l.BulletinId = b.Id
  ) lb
  WHERE p.Annee = @annee AND p.Mois BETWEEN @moisDebut AND @moisFin
    AND (@emp IS NULL OR e.Id = @emp)
    AND (@cat IS NULL OR k.Categorie = @cat)
  GROUP BY e.Id, e.Matricule, e.Nom, e.Prenom, e.EstCadre, e.NumeroIPRES, e.NumeroCSS, k.Categorie
  ORDER BY e.Nom, e.Prenom`,
{ annee, moisDebut, moisFin, emp: employeId, cat: categorie });

const queryImpots = (db, { annee, moisDebut, moisFin, employeId, categorie }) => db.query(`
  SELECT e.Id AS EmployeId, e.Matricule, e.Nom, e.Prenom, e.SituationFamiliale,
         MAX(b.NombreParts) AS NombreParts, k.Categorie,
         COUNT(b.Id) AS NbMois,
         SUM(b.Brut) AS Brut,
         SUM(b.BaseImposable) AS BaseImposable,
         SUM(b.ImpotRevenu) AS ImpotRevenu,
         SUM(b.TRIMF) AS TRIMF,
         SUM(ISNULL(lb.CfcePat, 0)) AS CfcePat
  FROM paie.BulletinPaie b
  JOIN paie.PeriodePaie p ON p.Id = b.PeriodeId
  JOIN paie.Employe e ON e.Id = b.EmployeId
  OUTER APPLY (SELECT TOP 1 c.Categorie FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
  OUTER APPLY (
    SELECT SUM(CASE WHEN r.Code = N'CFCE_PAT' THEN l.MontantPatronal ELSE 0 END) AS CfcePat
    FROM paie.LigneBulletin l
    JOIN paie.Rubrique r ON r.Id = l.RubriqueId
    WHERE l.BulletinId = b.Id
  ) lb
  WHERE p.Annee = @annee AND p.Mois BETWEEN @moisDebut AND @moisFin
    AND (@emp IS NULL OR e.Id = @emp)
    AND (@cat IS NULL OR k.Categorie = @cat)
  GROUP BY e.Id, e.Matricule, e.Nom, e.Prenom, e.SituationFamiliale, k.Categorie
  ORDER BY e.Nom, e.Prenom`,
{ annee, moisDebut, moisFin, emp: employeId, cat: categorie });

/** Base de toutes les déclarations : une ligne par employé, cumul des bulletins de la période. */
const queryDeclaration = (db, { annee, moisDebut, moisFin, employeId, categorie }) => db.query(`
  SELECT e.Id AS EmployeId, e.Matricule, e.Nom, e.Prenom, e.SituationFamiliale, e.NumeroIPRES, e.NumeroCSS, e.DateEmbauche, e.DateSortie,
         MAX(b.NombreParts) AS NombreParts, COUNT(b.Id) AS NbMois,
         SUM(b.Brut) AS Brut,
         SUM(ISNULL(b.BrutImposable, b.Brut)) AS BrutImposable,
         SUM(ISNULL(b.BrutCfceTrimf, ISNULL(b.BrutImposable, b.Brut))) AS BrutCfceTrimf,
         SUM(b.BaseIPRES) AS BaseIPRES, SUM(b.TotalCotisSalariales) AS TotalCotisSalariales,
         SUM(b.ImpotRevenu) AS ImpotRevenu, SUM(b.TRIMF) AS TRIMF, SUM(b.Net) AS Net,
         SUM(ISNULL(lb.IpresRgSal, 0)) AS IpresRgSal, SUM(ISNULL(lb.IpresRgPat, 0)) AS IpresRgPat,
         SUM(ISNULL(lb.IpresRccSal, 0)) AS IpresRccSal, SUM(ISNULL(lb.IpresRccPat, 0)) AS IpresRccPat,
         SUM(ISNULL(lb.CssPfPat, 0)) AS CssPfPat, SUM(ISNULL(lb.CssAtmpPat, 0)) AS CssAtmpPat,
         SUM(ISNULL(lb.IpmSal, 0)) AS IpmSal, SUM(ISNULL(lb.IpmPat, 0)) AS IpmPat, SUM(ISNULL(lb.CfcePat, 0)) AS CfcePat
  FROM paie.BulletinPaie b
  JOIN paie.PeriodePaie p ON p.Id = b.PeriodeId
  JOIN paie.Employe e ON e.Id = b.EmployeId
  OUTER APPLY (SELECT TOP 1 c.Categorie FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
  OUTER APPLY (
    SELECT
      SUM(CASE WHEN r.Code = N'IPRES_RG_SAL'  THEN l.MontantRetenue  ELSE 0 END) AS IpresRgSal,
      SUM(CASE WHEN r.Code = N'IPRES_RG_PAT'  THEN l.MontantPatronal ELSE 0 END) AS IpresRgPat,
      SUM(CASE WHEN r.Code = N'IPRES_RCC_SAL' THEN l.MontantRetenue  ELSE 0 END) AS IpresRccSal,
      SUM(CASE WHEN r.Code = N'IPRES_RCC_PAT' THEN l.MontantPatronal ELSE 0 END) AS IpresRccPat,
      SUM(CASE WHEN r.Code = N'CSS_PF_PAT'    THEN l.MontantPatronal ELSE 0 END) AS CssPfPat,
      SUM(CASE WHEN r.Code = N'CSS_ATMP_PAT'  THEN l.MontantPatronal ELSE 0 END) AS CssAtmpPat,
      SUM(CASE WHEN r.Code = N'IPM_SAL'       THEN l.MontantRetenue  ELSE 0 END) AS IpmSal,
      SUM(CASE WHEN r.Code = N'IPM_PAT'       THEN l.MontantPatronal ELSE 0 END) AS IpmPat,
      SUM(CASE WHEN r.Code = N'CFCE_PAT'      THEN l.MontantPatronal ELSE 0 END) AS CfcePat
    FROM paie.LigneBulletin l JOIN paie.Rubrique r ON r.Id = l.RubriqueId
    WHERE l.BulletinId = b.Id
  ) lb
  WHERE p.Annee = @annee AND p.Mois BETWEEN @moisDebut AND @moisFin
    AND (@emp IS NULL OR e.Id = @emp)
    AND (@cat IS NULL OR k.Categorie = @cat)
  GROUP BY e.Id, e.Matricule, e.Nom, e.Prenom, e.SituationFamiliale, e.NumeroIPRES, e.NumeroCSS, e.DateEmbauche, e.DateSortie
  ORDER BY e.Nom, e.Prenom`,
{ annee, moisDebut, moisFin, emp: employeId, cat: categorie });

const queryEmployes = (db, { employeId, categorie, actif }) => db.query(`
  SELECT e.Id, e.Matricule, e.Nom, e.Prenom, e.Sexe, e.SituationFamiliale, e.NombreEnfants, e.NombreParts,
         e.EstCadre, e.NumeroIPRES, e.NumeroCSS, e.ModePaiement, e.DateEmbauche, e.DateSortie, e.Actif,
         d.Libelle AS Departement, p.Libelle AS Poste,
         k.TypeContrat, k.SalaireBase, k.Categorie, k.Echelon
  FROM paie.Employe e
  LEFT JOIN paie.Departement d ON d.Id = e.DepartementId
  LEFT JOIN paie.Poste p ON p.Id = e.PosteId
  OUTER APPLY (SELECT TOP 1 c.TypeContrat, c.SalaireBase, c.Categorie, c.Echelon
               FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
  WHERE (@actif IS NULL OR e.Actif = @actif)
    AND (@emp IS NULL OR e.Id = @emp)
    AND (@cat IS NULL OR k.Categorie = @cat)
  ORDER BY e.Nom, e.Prenom`,
{ actif: actif === 'ALL' ? null : Number(actif), emp: employeId, cat: categorie });

async function queryConges(db, f) {
  if (f.vue === 'soldes') {
    const rateRow = (await db.query(`SELECT TOP 1 Valeur FROM paie.ParametreLegal WHERE Code = N'CONGE_JOURS_PAR_MOIS'
      AND DateDebut <= @d AND (DateFin IS NULL OR DateFin >= @d) ORDER BY DateDebut DESC`, { d: f.dateFin }))[0];
    if (!rateRow) throw new Error('Paramètre manquant : CONGE_JOURS_PAR_MOIS (Paramètres > Paramètres légaux).');
    const rate = Number(rateRow.Valeur);
    const rows = await db.query(`
      SELECT e.Id AS EmployeId, e.Matricule, e.Nom, e.Prenom, e.DateEmbauche, e.SoldeCongesInitial, e.DateSoldeConges,
             k.Categorie,
             ISNULL((SELECT SUM(c.NombreJours) FROM paie.Conge c JOIN paie.TypeConge t ON t.Id = c.TypeCongeId
                     WHERE c.EmployeId = e.Id AND t.Code = N'ANNUEL' AND c.Statut IN (N'APPROUVE', N'PRIS')
                       AND c.DateDebut >= ISNULL(e.DateSoldeConges, e.DateEmbauche) AND c.DateDebut <= @d), 0) AS Pris
      FROM paie.Employe e
      OUTER APPLY (SELECT TOP 1 c.Categorie FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
      WHERE e.Actif = 1 AND e.DateEmbauche <= @d
        AND (@emp IS NULL OR e.Id = @emp)
        AND (@cat IS NULL OR k.Categorie = @cat)
      ORDER BY e.Nom, e.Prenom`,
    { d: f.dateFin, emp: f.employeId, cat: f.categorie });
    const soldes = rows.map((e) => {
      const depuis = e.DateSoldeConges || e.DateEmbauche;
      return {
        EmployeId: e.EmployeId, Matricule: e.Matricule, Nom: e.Nom, Prenom: e.Prenom, Categorie: e.Categorie || '',
        Depuis: depuis, Initial: Number(e.SoldeCongesInitial),
        ...conges.calcSolde({ initial: e.SoldeCongesInitial, depuis, jusqu: f.dateFin, pris: e.Pris, joursParMois: rate }),
      };
    });
    return { soldes };
  }
  const demandes = await db.query(`
    SELECT c.Id, c.EmployeId, e.Matricule, e.Nom, e.Prenom, k.Categorie,
           t.Code AS TypeCode, t.Libelle AS Type, t.Remunere,
           c.DateDebut, c.DateFin, c.NombreJours, c.Statut
    FROM paie.Conge c
    JOIN paie.Employe e ON e.Id = c.EmployeId
    JOIN paie.TypeConge t ON t.Id = c.TypeCongeId
    OUTER APPLY (SELECT TOP 1 ct.Categorie FROM paie.Contrat ct WHERE ct.EmployeId = e.Id AND ct.EstActif = 1 ORDER BY ct.DateDebut DESC) k
    WHERE c.DateDebut <= @fin AND c.DateFin >= @debut
      AND (@statut IS NULL OR c.Statut = @statut)
      AND (@emp IS NULL OR e.Id = @emp)
      AND (@cat IS NULL OR k.Categorie = @cat)
    ORDER BY c.DateDebut DESC, e.Nom, e.Prenom`,
  { debut: f.dateDebut, fin: f.dateFin, statut: f.statut, emp: f.employeId, cat: f.categorie });
  return { demandes };
}

/** Exécute un rapport en lecture seule et renvoie sa structure complète (aperçu, CSV, HTML PDF). */
async function runReport(db, type, rawFilters = {}) {
  if (!REPORT_TYPES.includes(type)) throw new Error(`Type de rapport inconnu : ${type}`);
  const f = normalizeFilters(type, rawFilters);
  const meta = await resolveMeta(db, f);
  let raw;
  if (type === 'journal') raw = await queryBulletinsPeriode(db, { annee: f.annee, moisDebut: f.mois, moisFin: f.mois, employeId: f.employeId, categorie: f.categorie });
  else if (type === 'annuel' || type === 'historique') raw = await queryBulletinsPeriode(db, f);
  else if (type === 'cotisations') raw = await queryCotisations(db, f);
  else if (type === 'impots') raw = await queryImpots(db, f);
  else if (type.startsWith('decl_')) raw = await queryDeclaration(db, f);
  else if (type === 'employes') raw = await queryEmployes(db, f);
  else if (type === 'conges') raw = await queryConges(db, f);
  return { report: buildReport(type, raw, f, meta), filters: f };
}

const getEntreprise = async (db) => (await db.query('SELECT * FROM paie.Entreprise WHERE Id = 1'))[0] || { Nom: 'PaieGestion' };

module.exports = {
  normalizeFilters, getFilterOptions, runReport, getEntreprise,
  queryBulletinsPeriode, queryCotisations, queryImpots, queryDeclaration, queryEmployes, queryConges,
};
