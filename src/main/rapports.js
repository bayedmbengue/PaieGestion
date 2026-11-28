'use strict';
/**
 * Module « Rapports » — fonctions pures d'agrégation, de mise en forme, d'export CSV et HTML imprimable (PDF).
 * Aucun accès SQL direct ici : les données viennent de src/main/rapportsRepo.js.
 */

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const SITFAM = { C: 'Célibataire', M: 'Marié(e)', D: 'Divorcé(e)', V: 'Veuf/Veuve' };
const STATUT_CONGE = { DEMANDE: 'En attente', APPROUVE: 'Approuvé', REFUSE: 'Refusé', PRIS: 'Pris' };
const REPORT_TYPES = ['journal', 'annuel', 'cotisations', 'impots', 'historique', 'employes', 'conges', 'prets',
  'decl_ir', 'decl_trimf', 'decl_cfce', 'decl_ipres_css', 'decl_ipm', 'decl_1024'];

const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n) => (n == null || n === '' ? '' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(n))).replace(/[\u202f\u00a0]/g, ' '));
const fmtNum = (n) => (n == null || n === '' ? '' : String(Number(n)).replace('.', ','));
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

function fmtCellText(col, val) {
  if (val == null || val === '') return '';
  if (col.format === 'money') return fmtMoney(val);
  if (col.format === 'num') return fmtNum(val);
  if (col.format === 'date') return fmtDate(val);
  if (col.format === 'bool') return val ? 'Oui' : 'Non';
  return String(val);
}

function fmtCsvVal(col, val) {
  if (val == null || val === '') return '';
  if (col.format === 'money') return String(Math.round(Number(val)));
  if (col.format === 'num') return String(Number(val)).replace('.', ',');
  if (col.format === 'date') return fmtDate(val);
  if (col.format === 'bool') return val ? 'Oui' : 'Non';
  return String(val);
}

function sumCols(rows, keys) {
  const out = {};
  for (const k of keys) out[k] = r2(rows.reduce((s, r) => s + Number(r[k] || 0), 0));
  return out;
}

function periodLabel(annee, moisDebut, moisFin) {
  const m1 = Math.max(1, Math.min(12, Number(moisDebut) || 1));
  const m2 = Math.max(m1, Math.min(12, Number(moisFin) || m1));
  if (m1 === m2) return `${MOIS[m1 - 1]} ${annee}`;
  if (m1 === 1 && m2 === 12) return `Année ${annee}`;
  return `${MOIS[m1 - 1]} à ${MOIS[m2 - 1]} ${annee}`;
}

function periodSlug(annee, moisDebut, moisFin) {
  const m1 = Math.max(1, Math.min(12, Number(moisDebut) || 1));
  const m2 = Math.max(m1, Math.min(12, Number(moisFin) || m1));
  const p = (m) => String(m).padStart(2, '0');
  if (m1 === m2) return `${annee}-${p(m1)}`;
  if (m1 === 1 && m2 === 12) return `${annee}`;
  return `${annee}-${p(m1)}_${p(m2)}`;
}

function filterSubtitle(base, meta = {}) {
  const parts = [base];
  if (meta.employeLabel) parts.push(`Employé : ${meta.employeLabel}`);
  if (meta.categorieLabel) parts.push(`Catégorie : ${meta.categorieLabel}`);
  if (meta.extraLabel) parts.push(meta.extraLabel);
  return parts.filter(Boolean).join(' · ');
}

const PAIE_MONEY_KEYS = ['SalaireBase', 'Brut', 'BaseImposable', 'TotalCotisSalariales', 'ImpotRevenu', 'TRIMF', 'AutresRetenues', 'Net', 'TotalCotisPatronales', 'CoutEmployeur'];

const PAIE_MONEY_COLS = [
  { key: 'SalaireBase', label: 'Salaire base', align: 'n', format: 'money' },
  { key: 'Brut', label: 'Brut', align: 'n', format: 'money' },
  { key: 'BaseImposable', label: 'Brut imp.', align: 'n', format: 'money' },
  { key: 'TotalCotisSalariales', label: 'Cotis. sal.', align: 'n', format: 'money' },
  { key: 'ImpotRevenu', label: 'IR', align: 'n', format: 'money' },
  { key: 'TRIMF', label: 'TRIMF', align: 'n', format: 'money' },
  { key: 'AutresRetenues', label: 'Autres ret.', align: 'n', format: 'money' },
  { key: 'Net', label: 'Net à payer', align: 'n', format: 'money', bold: true },
  { key: 'TotalCotisPatronales', label: 'Charges pat.', align: 'n', format: 'money' },
  { key: 'CoutEmployeur', label: 'Coût emp.', align: 'n', format: 'money' },
];

// ───────────────────────── Constructeurs des 7 rapports ─────────────────────────

function buildJournal(rows, filters, meta) {
  const columns = [
    { key: 'Matricule', label: 'Matricule' },
    { key: 'Nom', label: 'Nom', bold: true },
    { key: 'Prenom', label: 'Prénom' },
    { key: 'Categorie', label: 'Cat.' },
    ...PAIE_MONEY_COLS,
  ];
  const sums = sumCols(rows, PAIE_MONEY_KEYS);
  return {
    type: 'journal',
    title: 'Journal de paie mensuel',
    subtitle: filterSubtitle(periodLabel(filters.annee, filters.mois, filters.mois), meta),
    filenameBase: `Journal_paie_${periodSlug(filters.annee, filters.mois, filters.mois)}`,
    landscape: true,
    kpis: [
      { label: 'Bulletins', value: String(rows.length) },
      { label: 'Brut total', value: `${fmtMoney(sums.Brut)} FCFA` },
      { label: 'Net à payer', value: `${fmtMoney(sums.Net)} FCFA`, tone: 'ok' },
      { label: 'Coût employeur', value: `${fmtMoney(sums.CoutEmployeur)} FCFA` },
    ],
    columns,
    rows,
    totals: rows.length ? { Matricule: `Total (${rows.length})`, ...sums } : null,
    emptyMessage: `Aucun bulletin trouvé pour ${periodLabel(filters.annee, filters.mois, filters.mois)}.`,
  };
}

function buildAnnuel(rawRows, filters, meta) {
  const vue = filters.vue === 'employe' ? 'employe' : 'mois';
  // Agrégation par mois
  const byMois = new Map();
  for (const r of rawRows) {
    const k = Number(r.Mois);
    const cur = byMois.get(k) || {
      Mois: k, Periode: `${MOIS[k - 1]} ${r.Annee}`, Effectif: 0,
      SalaireBase: 0, Brut: 0, BaseImposable: 0, TotalCotisSalariales: 0, ImpotRevenu: 0, TRIMF: 0, AutresRetenues: 0, Net: 0, TotalCotisPatronales: 0, CoutEmployeur: 0,
    };
    cur.Effectif += 1;
    for (const f of PAIE_MONEY_KEYS) cur[f] = r2(cur[f] + Number(r[f] || 0));
    byMois.set(k, cur);
  }
  const moisRows = [...byMois.values()].sort((a, b) => a.Mois - b.Mois);

  // Agrégation par employé
  const byEmp = new Map();
  for (const r of rawRows) {
    const k = r.EmployeId;
    const cur = byEmp.get(k) || {
      EmployeId: k, Matricule: r.Matricule, Nom: r.Nom, Prenom: r.Prenom, Categorie: r.Categorie || '', NbMois: 0,
      SalaireBase: 0, Brut: 0, BaseImposable: 0, TotalCotisSalariales: 0, ImpotRevenu: 0, TRIMF: 0, AutresRetenues: 0, Net: 0, TotalCotisPatronales: 0, CoutEmployeur: 0,
    };
    cur.NbMois += 1;
    for (const f of PAIE_MONEY_KEYS) cur[f] = r2(cur[f] + Number(r[f] || 0));
    byEmp.set(k, cur);
  }
  const empRows = [...byEmp.values()].sort((a, b) => a.Nom.localeCompare(b.Nom) || a.Prenom.localeCompare(b.Prenom));

  const sums = sumCols(rawRows, PAIE_MONEY_KEYS);
  const moisCols = [
    { key: 'Periode', label: 'Période', bold: true },
    { key: 'Effectif', label: 'Effectif', align: 'n', format: 'num' },
    ...PAIE_MONEY_COLS,
  ];
  const empCols = [
    { key: 'Matricule', label: 'Matricule' },
    { key: 'Nom', label: 'Nom', bold: true },
    { key: 'Prenom', label: 'Prénom' },
    { key: 'Categorie', label: 'Cat.' },
    { key: 'NbMois', label: 'Mois', align: 'n', format: 'num' },
    ...PAIE_MONEY_COLS,
  ];

  const mainMois = vue === 'mois';
  return {
    type: 'annuel',
    title: 'Récapitulatif annuel de la paie',
    subtitle: filterSubtitle(periodLabel(filters.annee, filters.moisDebut, filters.moisFin), {
      ...meta,
      extraLabel: mainMois ? 'Synthèse par mois' : 'Cumul par employé',
    }),
    filenameBase: `Recapitulatif_annuel_${periodSlug(filters.annee, filters.moisDebut, filters.moisFin)}_${vue}`,
    landscape: true,
    kpis: [
      { label: 'Mois couverts', value: String(moisRows.length) },
      { label: 'Bulletins', value: String(rawRows.length) },
      { label: 'Brut cumulé', value: `${fmtMoney(sums.Brut)} FCFA` },
      { label: 'Net cumulé', value: `${fmtMoney(sums.Net)} FCFA`, tone: 'ok' },
      { label: 'Coût employeur', value: `${fmtMoney(sums.CoutEmployeur)} FCFA` },
    ],
    columns: mainMois ? moisCols : empCols,
    rows: mainMois ? moisRows : empRows,
    totals: rawRows.length
      ? (mainMois ? { Periode: `Total (${moisRows.length} mois)`, Effectif: rawRows.length, ...sums } : { Matricule: `Total (${empRows.length})`, NbMois: rawRows.length, ...sums })
      : null,
    secondaryTable: rawRows.length && mainMois ? {
      title: 'Détail cumulé par employé',
      columns: empCols,
      rows: empRows,
      totals: { Matricule: `Total (${empRows.length})`, NbMois: rawRows.length, ...sums },
    } : null,
    emptyMessage: `Aucun bulletin trouvé pour ${periodLabel(filters.annee, filters.moisDebut, filters.moisFin)}.`,
  };
}

function buildCotisations(rawRows, filters, meta) {
  const org = ['IPRES', 'CSS', 'IPM'].includes(filters.organisme) ? filters.organisme : 'TOUS';
  const rows = rawRows.map((r) => {
    const IpresRgSal = r2(r.IpresRgSal); const IpresRgPat = r2(r.IpresRgPat);
    const IpresRccSal = r2(r.IpresRccSal); const IpresRccPat = r2(r.IpresRccPat);
    const CssPfPat = r2(r.CssPfPat); const CssAtmpPat = r2(r.CssAtmpPat);
    const IpmSal = r2(r.IpmSal); const IpmPat = r2(r.IpmPat);
    const IpresSal = r2(IpresRgSal + IpresRccSal);
    const IpresPat = r2(IpresRgPat + IpresRccPat);
    const TotalIpres = r2(IpresSal + IpresPat);
    const TotalCss = r2(CssPfPat + CssAtmpPat);
    const TotalIpm = r2(IpmSal + IpmPat);
    const TotalSal = r2(IpresSal + IpmSal);
    const TotalPat = r2(IpresPat + TotalCss + IpmPat);
    const TotalGeneral = r2(TotalSal + TotalPat);
    return {
      ...r,
      Cadre: r.EstCadre ? 'Oui' : 'Non',
      IpresRgSal, IpresRgPat, IpresRccSal, IpresRccPat, IpresSal, IpresPat, TotalIpres,
      CssPfPat, CssAtmpPat, TotalCss,
      IpmSal, IpmPat, TotalIpm,
      TotalSal, TotalPat, TotalGeneral,
    };
  });

  const numKeysAll = ['Brut', 'BaseImposable', 'BaseIPRES', 'IpresRgSal', 'IpresRgPat', 'IpresRccSal', 'IpresRccPat', 'IpresSal', 'IpresPat', 'TotalIpres',
    'CssPfPat', 'CssAtmpPat', 'TotalCss', 'IpmSal', 'IpmPat', 'TotalIpm', 'TotalSal', 'TotalPat', 'TotalGeneral'];
  const sums = sumCols(rows, numKeysAll);

  const byOrg = {
    TOUS: {
      title: 'États des cotisations sociales (IPRES / CSS / IPM)',
      cols: [
        { key: 'Matricule', label: 'Matricule' }, { key: 'Nom', label: 'Nom', bold: true }, { key: 'Prenom', label: 'Prénom' },
        { key: 'Categorie', label: 'Cat.' }, { key: 'Cadre', label: 'Cadre' }, { key: 'NumeroIPRES', label: 'N° IPRES' }, { key: 'NumeroCSS', label: 'N° CSS' },
        { key: 'BaseImposable', label: 'Brut imp.', align: 'n', format: 'money' },
        { key: 'IpresRgSal', label: 'IPRES RG sal.', align: 'n', format: 'money' }, { key: 'IpresRgPat', label: 'IPRES RG pat.', align: 'n', format: 'money' },
        { key: 'IpresRccSal', label: 'IPRES RCC sal.', align: 'n', format: 'money' }, { key: 'IpresRccPat', label: 'IPRES RCC pat.', align: 'n', format: 'money' },
        { key: 'CssPfPat', label: 'CSS PF', align: 'n', format: 'money' }, { key: 'CssAtmpPat', label: 'CSS AT/MP', align: 'n', format: 'money' },
        { key: 'IpmSal', label: 'IPM sal.', align: 'n', format: 'money' }, { key: 'IpmPat', label: 'IPM pat.', align: 'n', format: 'money' },
        { key: 'TotalGeneral', label: 'Total', align: 'n', format: 'money', bold: true },
      ],
    },
    IPRES: {
      title: 'État nominatif IPRES (Régime général et Cadres)',
      cols: [
        { key: 'Matricule', label: 'Matricule' }, { key: 'Nom', label: 'Nom', bold: true }, { key: 'Prenom', label: 'Prénom' },
        { key: 'Categorie', label: 'Cat.' }, { key: 'Cadre', label: 'Cadre' }, { key: 'NumeroIPRES', label: 'N° IPRES' },
        { key: 'BaseImposable', label: 'Brut imp.', align: 'n', format: 'money' }, { key: 'BaseIPRES', label: 'Base RG', align: 'n', format: 'money' },
        { key: 'IpresRgSal', label: 'RG sal.', align: 'n', format: 'money' }, { key: 'IpresRgPat', label: 'RG pat.', align: 'n', format: 'money' },
        { key: 'IpresRccSal', label: 'RCC sal.', align: 'n', format: 'money' }, { key: 'IpresRccPat', label: 'RCC pat.', align: 'n', format: 'money' },
        { key: 'IpresSal', label: 'Total sal.', align: 'n', format: 'money' }, { key: 'IpresPat', label: 'Total pat.', align: 'n', format: 'money' },
        { key: 'TotalIpres', label: 'Total IPRES', align: 'n', format: 'money', bold: true },
      ],
    },
    CSS: {
      title: 'État nominatif CSS (Caisse de Sécurité Sociale)',
      cols: [
        { key: 'Matricule', label: 'Matricule' }, { key: 'Nom', label: 'Nom', bold: true }, { key: 'Prenom', label: 'Prénom' },
        { key: 'Categorie', label: 'Cat.' }, { key: 'NumeroCSS', label: 'N° CSS' },
        { key: 'BaseImposable', label: 'Brut imp.', align: 'n', format: 'money' },
        { key: 'CssPfPat', label: 'Prestations familiales (pat.)', align: 'n', format: 'money' },
        { key: 'CssAtmpPat', label: 'Accidents du travail (pat.)', align: 'n', format: 'money' },
        { key: 'TotalCss', label: 'Total CSS', align: 'n', format: 'money', bold: true },
      ],
    },
    IPM: {
      title: 'État nominatif IPM (Institution de Prévoyance Maladie)',
      cols: [
        { key: 'Matricule', label: 'Matricule' }, { key: 'Nom', label: 'Nom', bold: true }, { key: 'Prenom', label: 'Prénom' },
        { key: 'Categorie', label: 'Cat.' }, { key: 'BaseImposable', label: 'Brut imp.', align: 'n', format: 'money' },
        { key: 'IpmSal', label: 'Part salariale', align: 'n', format: 'money' },
        { key: 'IpmPat', label: 'Part patronale', align: 'n', format: 'money' },
        { key: 'TotalIpm', label: 'Total IPM', align: 'n', format: 'money', bold: true },
      ],
    },
  };

  const syntheseAll = [
    { Organisme: 'IPRES — Régime général', Salarial: sums.IpresRgSal, Patronal: sums.IpresRgPat, Total: r2(sums.IpresRgSal + sums.IpresRgPat), tag: 'IPRES' },
    { Organisme: 'IPRES — Régime complémentaire cadres', Salarial: sums.IpresRccSal, Patronal: sums.IpresRccPat, Total: r2(sums.IpresRccSal + sums.IpresRccPat), tag: 'IPRES' },
    { Organisme: 'CSS — Prestations familiales', Salarial: 0, Patronal: sums.CssPfPat, Total: sums.CssPfPat, tag: 'CSS' },
    { Organisme: 'CSS — Accidents du travail (AT/MP)', Salarial: 0, Patronal: sums.CssAtmpPat, Total: sums.CssAtmpPat, tag: 'CSS' },
    { Organisme: 'IPM — Prévoyance maladie', Salarial: sums.IpmSal, Patronal: sums.IpmPat, Total: sums.TotalIpm, tag: 'IPM' },
  ];
  const synthese = org === 'TOUS' ? syntheseAll : syntheseAll.filter((x) => x.tag === org);
  const synTot = sumCols(synthese, ['Salarial', 'Patronal', 'Total']);

  return {
    type: 'cotisations',
    title: byOrg[org].title,
    subtitle: filterSubtitle(periodLabel(filters.annee, filters.moisDebut, filters.moisFin), {
      ...meta,
      extraLabel: org === 'TOUS' ? 'Tous organismes' : `Organisme : ${org}`,
    }),
    filenameBase: `Etat_${org === 'TOUS' ? 'IPRES_CSS_IPM' : org}_${periodSlug(filters.annee, filters.moisDebut, filters.moisFin)}`,
    landscape: true,
    kpis: [
      { label: 'IPRES', value: `${fmtMoney(sums.TotalIpres)} FCFA` },
      { label: 'CSS', value: `${fmtMoney(sums.TotalCss)} FCFA` },
      { label: 'IPM', value: `${fmtMoney(sums.TotalIpm)} FCFA` },
      { label: 'Total à reverser', value: `${fmtMoney(synTot.Total)} FCFA`, tone: 'ok' },
    ],
    columns: byOrg[org].cols,
    rows,
    totals: rows.length ? { Matricule: `Total (${rows.length})`, ...sums } : null,
    secondaryTable: rows.length ? {
      title: 'Synthèse par organisme',
      columns: [
        { key: 'Organisme', label: 'Organisme', bold: true },
        { key: 'Salarial', label: 'Retenue salariale', align: 'n', format: 'money' },
        { key: 'Patronal', label: 'Part patronale', align: 'n', format: 'money' },
        { key: 'Total', label: 'Total à reverser', align: 'n', format: 'money', bold: true },
      ],
      rows: synthese,
      totals: { Organisme: 'Total', ...synTot },
    } : null,
    emptyMessage: `Aucune cotisation calculée pour ${periodLabel(filters.annee, filters.moisDebut, filters.moisFin)}.`,
  };
}

function buildImpots(rawRows, filters, meta) {
  const rows = rawRows.map((r) => {
    const ImpotRevenu = r2(r.ImpotRevenu);
    const TRIMF = r2(r.TRIMF);
    const CfcePat = r2(r.CfcePat);
    return {
      ...r,
      Situation: SITFAM[r.SituationFamiliale] || r.SituationFamiliale || '',
      ImpotRevenu, TRIMF, CfcePat,
      TotalImpots: r2(ImpotRevenu + TRIMF + CfcePat),
    };
  });
  const sums = sumCols(rows, ['Brut', 'BaseImposable', 'ImpotRevenu', 'TRIMF', 'CfcePat', 'TotalImpots']);
  return {
    type: 'impots',
    title: 'État fiscal — IR, TRIMF et CFCE (DGID)',
    subtitle: filterSubtitle(periodLabel(filters.annee, filters.moisDebut, filters.moisFin), meta),
    filenameBase: `Etat_IR_TRIMF_CFCE_${periodSlug(filters.annee, filters.moisDebut, filters.moisFin)}`,
    landscape: true,
    kpis: [
      { label: 'IR', value: `${fmtMoney(sums.ImpotRevenu)} FCFA` },
      { label: 'TRIMF', value: `${fmtMoney(sums.TRIMF)} FCFA` },
      { label: 'CFCE (pat.)', value: `${fmtMoney(sums.CfcePat)} FCFA` },
      { label: 'Total impôts', value: `${fmtMoney(sums.TotalImpots)} FCFA`, tone: 'ok' },
    ],
    columns: [
      { key: 'Matricule', label: 'Matricule' },
      { key: 'Nom', label: 'Nom', bold: true },
      { key: 'Prenom', label: 'Prénom' },
      { key: 'Categorie', label: 'Cat.' },
      { key: 'Situation', label: 'Situation' },
      { key: 'NombreParts', label: 'Parts', align: 'n', format: 'num' },
      { key: 'NbMois', label: 'Mois', align: 'n', format: 'num' },
      { key: 'Brut', label: 'Brut', align: 'n', format: 'money' },
      { key: 'BaseImposable', label: 'Brut imp.', align: 'n', format: 'money' },
      { key: 'ImpotRevenu', label: 'IR', align: 'n', format: 'money' },
      { key: 'TRIMF', label: 'TRIMF', align: 'n', format: 'money' },
      { key: 'CfcePat', label: 'CFCE (pat.)', align: 'n', format: 'money' },
      { key: 'TotalImpots', label: 'Total impôts', align: 'n', format: 'money', bold: true },
    ],
    rows,
    totals: rows.length ? { Matricule: `Total (${rows.length})`, ...sums } : null,
    emptyMessage: `Aucun bulletin trouvé pour ${periodLabel(filters.annee, filters.moisDebut, filters.moisFin)}.`,
  };
}

function buildHistorique(rawRows, filters, meta) {
  const rows = rawRows.map((r) => ({
    ...r,
    Periode: `${MOIS[Number(r.Mois) - 1]} ${r.Annee}`,
  }));
  const sums = sumCols(rows, PAIE_MONEY_KEYS);
  return {
    type: 'historique',
    title: 'Historique de paie par employé',
    subtitle: filterSubtitle(periodLabel(filters.annee, filters.moisDebut, filters.moisFin), meta),
    filenameBase: `Historique_paie_${periodSlug(filters.annee, filters.moisDebut, filters.moisFin)}`,
    landscape: true,
    kpis: [
      { label: 'Bulletins', value: String(rows.length) },
      { label: 'Brut cumulé', value: `${fmtMoney(sums.Brut)} FCFA` },
      { label: 'Net cumulé', value: `${fmtMoney(sums.Net)} FCFA`, tone: 'ok' },
      { label: 'Coût employeur', value: `${fmtMoney(sums.CoutEmployeur)} FCFA` },
    ],
    columns: [
      { key: 'Periode', label: 'Période', bold: true },
      { key: 'Matricule', label: 'Matricule' },
      { key: 'Nom', label: 'Nom' },
      { key: 'Prenom', label: 'Prénom' },
      { key: 'Categorie', label: 'Cat.' },
      ...PAIE_MONEY_COLS,
    ],
    rows,
    totals: rows.length ? { Periode: `Cumul (${rows.length})`, ...sums } : null,
    emptyMessage: `Aucun historique trouvé pour ces critères.`,
  };
}

function buildEmployes(rawRows, filters, meta) {
  const rows = rawRows.map((r) => ({
    ...r,
    Situation: SITFAM[r.SituationFamiliale] || r.SituationFamiliale || '',
    Cadre: r.EstCadre ? 'Cadre' : 'Non-cadre',
    StatutActif: r.Actif ? 'Actif' : 'Inactif',
  }));
  const cadres = rows.filter((r) => r.EstCadre).length;
  const sums = sumCols(rows, ['SalaireBase']);
  const actifLabel = filters.actif === '0' ? 'Inactifs uniquement' : filters.actif === 'ALL' ? 'Actifs et inactifs' : 'Actifs uniquement';
  return {
    type: 'employes',
    title: 'Liste du personnel',
    subtitle: filterSubtitle(actifLabel, meta),
    filenameBase: `Liste_employes_${new Date().toISOString().slice(0, 10)}`,
    landscape: true,
    kpis: [
      { label: 'Effectif', value: String(rows.length) },
      { label: 'Cadres', value: String(cadres) },
      { label: 'Non-cadres', value: String(rows.length - cadres) },
      { label: 'Salaires de base', value: `${fmtMoney(sums.SalaireBase)} FCFA`, tone: 'ok' },
    ],
    columns: [
      { key: 'Matricule', label: 'Matricule' },
      { key: 'Nom', label: 'Nom', bold: true },
      { key: 'Prenom', label: 'Prénom' },
      { key: 'Sexe', label: 'Sexe' },
      { key: 'Poste', label: 'Poste' },
      { key: 'Departement', label: 'Service' },
      { key: 'Categorie', label: 'Cat.' },
      { key: 'Echelon', label: 'Classe' },
      { key: 'Cadre', label: 'Statut' },
      { key: 'TypeContrat', label: 'Contrat' },
      { key: 'DateEmbauche', label: 'Embauche', format: 'date' },
      { key: 'DateSortie', label: 'Sortie', format: 'date' },
      { key: 'Situation', label: 'Sit. fam.' },
      { key: 'NombreEnfants', label: 'Enf.', align: 'n', format: 'num' },
      { key: 'NombreParts', label: 'Parts', align: 'n', format: 'num' },
      { key: 'NumeroIPRES', label: 'N° IPRES' },
      { key: 'NumeroCSS', label: 'N° CSS' },
      { key: 'ModePaiement', label: 'Paiement' },
      { key: 'SalaireBase', label: 'Salaire base', align: 'n', format: 'money', bold: true },
      { key: 'StatutActif', label: 'État' },
    ],
    rows,
    totals: rows.length ? { Matricule: `Total (${rows.length})`, SalaireBase: sums.SalaireBase } : null,
    emptyMessage: 'Aucun employé correspondant aux filtres.',
  };
}

function buildConges(rawData, filters, meta) {
  const vue = filters.vue === 'soldes' ? 'soldes' : 'demandes';
  if (vue === 'soldes') {
    const rows = rawData.soldes || [];
    const sums = sumCols(rows, ['Initial', 'acquis', 'pris', 'solde']);
    return {
      type: 'conges',
      title: 'État des soldes de congés payés',
      subtitle: filterSubtitle(`Au ${fmtDate(filters.dateFin)}`, meta),
      filenameBase: `Soldes_conges_${filters.dateFin}`,
      landscape: false,
      kpis: [
        { label: 'Employés', value: String(rows.length) },
        { label: 'Total acquis', value: `${fmtNum(sums.acquis)} j` },
        { label: 'Total pris', value: `${fmtNum(sums.pris)} j` },
        { label: 'Solde global', value: `${fmtNum(sums.solde)} j`, tone: 'ok' },
      ],
      columns: [
        { key: 'Matricule', label: 'Matricule' },
        { key: 'Nom', label: 'Nom', bold: true },
        { key: 'Prenom', label: 'Prénom' },
        { key: 'Categorie', label: 'Cat.' },
        { key: 'Depuis', label: 'Compté depuis', format: 'date' },
        { key: 'Initial', label: 'Reprise (j)', align: 'n', format: 'num' },
        { key: 'acquis', label: 'Acquis (j)', align: 'n', format: 'num' },
        { key: 'pris', label: 'Pris (j)', align: 'n', format: 'num' },
        { key: 'solde', label: 'Solde (j)', align: 'n', format: 'num', bold: true },
      ],
      rows,
      totals: rows.length ? { Matricule: `Total (${rows.length})`, ...sums } : null,
      emptyMessage: 'Aucun solde de congés trouvé pour ces critères.',
    };
  }

  const rows = (rawData.demandes || []).map((r) => ({
    ...r,
    RemunereLib: r.Remunere ? 'Oui' : 'Non',
    StatutLib: STATUT_CONGE[r.Statut] || r.Statut,
  }));
  const joursRem = r2(rows.filter((r) => r.Remunere).reduce((s, r) => s + Number(r.NombreJours || 0), 0));
  const joursNonRem = r2(rows.filter((r) => !r.Remunere).reduce((s, r) => s + Number(r.NombreJours || 0), 0));
  const totalJours = r2(joursRem + joursNonRem);

  return {
    type: 'conges',
    title: 'État des congés et absences',
    subtitle: filterSubtitle(`Du ${fmtDate(filters.dateDebut)} au ${fmtDate(filters.dateFin)}`, {
      ...meta,
      extraLabel: filters.statut ? `Statut : ${STATUT_CONGE[filters.statut] || filters.statut}` : null,
    }),
    filenameBase: `Conges_absences_${filters.dateDebut}_${filters.dateFin}`,
    landscape: false,
    kpis: [
      { label: 'Demandes', value: String(rows.length) },
      { label: 'Jours rémunérés', value: `${fmtNum(joursRem)} j`, tone: 'ok' },
      { label: 'Jours non payés', value: `${fmtNum(joursNonRem)} j`, tone: joursNonRem > 0 ? 'warn' : undefined },
      { label: 'Total jours', value: `${fmtNum(totalJours)} j` },
    ],
    columns: [
      { key: 'Matricule', label: 'Matricule' },
      { key: 'Nom', label: 'Nom', bold: true },
      { key: 'Prenom', label: 'Prénom' },
      { key: 'Categorie', label: 'Cat.' },
      { key: 'Type', label: 'Type' },
      { key: 'RemunereLib', label: 'Rémunéré' },
      { key: 'DateDebut', label: 'Du', format: 'date' },
      { key: 'DateFin', label: 'Au', format: 'date' },
      { key: 'NombreJours', label: 'Jours', align: 'n', format: 'num', bold: true },
      { key: 'StatutLib', label: 'Statut' },
    ],
    rows,
    totals: rows.length ? { Matricule: `Total (${rows.length})`, NombreJours: totalJours } : null,
    emptyMessage: 'Aucun congé ou absence trouvé pour ces critères.',
  };
}

/** Prêts du personnel : situation de chaque prêt (échéances payées, remboursé, reste) ou détail des échéances payées. */
function buildPrets(rawData, filters, meta) {
  const today = new Date().toISOString().slice(0, 10);
  const etat = ['ENCOURS', 'SOLDE'].includes(filters.etatPret) ? filters.etatPret : 'TOUS';
  const etatLabel = etat === 'ENCOURS' ? 'Prêts en cours' : etat === 'SOLDE' ? 'Prêts soldés' : 'Tous les prêts';
  const prets = (rawData.prets || []).map((r) => {
    const pret = Number(r.MontantPret) || 0;
    const rembourse = Number(r.Rembourse) || 0;
    const reste = Math.max(0, r2(pret - rembourse));
    const arrete = !r.Actif || (r.DateFin && String(r.DateFin).slice(0, 10) < today);
    return {
      ...r,
      MontantPret: pret, Rembourse: rembourse, Reste: reste,
      Echeances: `${Number(r.NbPayees) || 0} / ${Number(r.DureeMois) || 0}`,
      Statut: reste === 0 ? 'Soldé' : (arrete ? 'Arrêté (reste dû)' : 'En cours'),
    };
  }).filter((r) => etat === 'TOUS' || (etat === 'ENCOURS' ? r.Reste > 0 : r.Reste === 0));

  if (filters.vue === 'echeances') {
    const cumuls = new Map();
    const rows = (rawData.echeances || []).map((r) => {
      const montant = Number(r.Montant) || 0;
      const cumul = r2((cumuls.get(r.PretId) || 0) + montant);
      cumuls.set(r.PretId, cumul);
      const debut = String(r.DateDebut).slice(0, 10);
      const n = (Number(r.Annee) * 12 + Number(r.Mois)) - (Number(debut.slice(0, 4)) * 12 + Number(debut.slice(5, 7))) + 1;
      return {
        ...r, Echeance: `${n} / ${r.DureeMois}`, Periode: `${MOIS[Number(r.Mois) - 1]} ${r.Annee}`,
        Montant: montant, Cumul: cumul, ResteApres: Math.max(0, r2((Number(r.MontantPret) || 0) - cumul)),
      };
    }).filter((r) => prets.some((p) => p.PretId === r.PretId));
    const total = rows.reduce((a, r) => a + r.Montant, 0);
    return {
      type: 'prets',
      title: 'Échéances de prêts payées',
      subtitle: filterSubtitle(etatLabel, meta),
      filenameBase: `Echeances_prets_${today}`,
      landscape: true,
      kpis: [
        { label: 'Échéances payées', value: String(rows.length) },
        { label: 'Total retenu', value: `${fmtMoney(total)} FCFA`, tone: 'ok' },
      ],
      columns: [
        { key: 'Matricule', label: 'Matricule' },
        { key: 'Nom', label: 'Nom', bold: true },
        { key: 'Prenom', label: 'Prénom' },
        { key: 'Rubrique', label: 'Prêt' },
        { key: 'Echeance', label: 'N° échéance', align: 'n' },
        { key: 'Periode', label: 'Période' },
        { key: 'Montant', label: 'Montant retenu', align: 'n', format: 'money', bold: true },
        { key: 'Cumul', label: 'Cumul remboursé', align: 'n', format: 'money' },
        { key: 'ResteApres', label: 'Reste après', align: 'n', format: 'money' },
      ],
      rows,
      totals: rows.length ? { Matricule: `Total (${rows.length})`, Montant: total } : null,
      emptyMessage: 'Aucune échéance payée pour ces critères.',
    };
  }

  const sums = sumCols(prets, ['MontantPret', 'Rembourse', 'Reste']);
  return {
    type: 'prets',
    title: 'Situation des prêts du personnel',
    subtitle: filterSubtitle(etatLabel, meta),
    filenameBase: `Situation_prets_${today}`,
    landscape: true,
    kpis: [
      { label: 'Prêts', value: String(prets.length) },
      { label: 'Total accordé', value: `${fmtMoney(sums.MontantPret)} FCFA` },
      { label: 'Total remboursé', value: `${fmtMoney(sums.Rembourse)} FCFA`, tone: 'ok' },
      { label: 'Reste à rembourser', value: `${fmtMoney(sums.Reste)} FCFA` },
    ],
    columns: [
      { key: 'Matricule', label: 'Matricule' },
      { key: 'Nom', label: 'Nom', bold: true },
      { key: 'Prenom', label: 'Prénom' },
      { key: 'Rubrique', label: 'Prêt' },
      { key: 'DateDebut', label: 'Début', format: 'date' },
      { key: 'MontantPret', label: 'Montant du prêt', align: 'n', format: 'money' },
      { key: 'DureeMois', label: 'Durée (mois)', align: 'n', format: 'num' },
      { key: 'Montant', label: 'Mensualité', align: 'n', format: 'money' },
      { key: 'Echeances', label: 'Échéances payées', align: 'n' },
      { key: 'Rembourse', label: 'Remboursé', align: 'n', format: 'money' },
      { key: 'Reste', label: 'Reste à rembourser', align: 'n', format: 'money', bold: true },
      { key: 'Statut', label: 'Statut' },
    ],
    rows: prets,
    totals: prets.length ? { Matricule: `Total (${prets.length})`, MontantPret: sums.MontantPret, Rembourse: sums.Rembourse, Reste: sums.Reste } : null,
    emptyMessage: 'Aucun prêt pour ces critères.',
  };
}

function buildReport(type, rawData, filters = {}, meta = {}) {
  switch (type) {
    case 'journal': return buildJournal(rawData, filters, meta);
    case 'annuel': return buildAnnuel(rawData, filters, meta);
    case 'cotisations': return buildCotisations(rawData, filters, meta);
    case 'impots': return buildImpots(rawData, filters, meta);
    case 'historique': return buildHistorique(rawData, filters, meta);
    case 'employes': return buildEmployes(rawData, filters, meta);
    case 'conges': return buildConges(rawData, filters, meta);
    case 'prets': return buildPrets(rawData, filters, meta);
    default:
      if (String(type).startsWith('decl_')) return require('./declarations').buildDeclaration(type, rawData, filters, meta);   // chargé à la demande (évite une dépendance circulaire)
      throw new Error(`Type de rapport inconnu : ${type}`);
  }
}

// ───────────────────────── Export CSV ─────────────────────────

function tableToCsvLines(columns, rows, totals) {
  const lines = [columns.map((c) => csvCell(c.label)).join(';')];
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(fmtCsvVal(c, r[c.key]))).join(';'));
  }
  if (totals) {
    lines.push(columns.map((c) => csvCell(totals[c.key] === undefined ? '' : fmtCsvVal(c, totals[c.key]))).join(';'));
  }
  return lines;
}

function reportToCsv(report) {
  const lines = tableToCsvLines(report.columns, report.rows, report.totals);
  if (report.secondaryTable && report.secondaryTable.rows && report.secondaryTable.rows.length) {
    lines.push('');
    lines.push(csvCell(report.secondaryTable.title));
    lines.push(...tableToCsvLines(report.secondaryTable.columns, report.secondaryTable.rows, report.secondaryTable.totals));
  }
  return '\uFEFF' + lines.join('\r\n');
}

// ───────────────────────── Export HTML imprimable (PDF) ─────────────────────────

function renderHtmlTable(columns, rows, totals) {
  const head = columns.map((c) => `<th class="${c.align === 'n' ? 'n' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => `<tr>${columns.map((c) => {
    const txt = esc(fmtCellText(c, r[c.key]));
    return `<td class="${c.align === 'n' ? 'n' : ''}">${c.bold ? `<b>${txt}</b>` : txt}</td>`;
  }).join('')}</tr>`).join('');
  const tot = totals
    ? `<tr class="tot">${columns.map((c) => `<td class="${c.align === 'n' ? 'n' : ''}">${totals[c.key] === undefined ? '' : esc(fmtCellText(c, totals[c.key]))}</td>`).join('')}</tr>`
    : '';
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}${tot}</tbody></table>`;
}

function reportToHtml(report, entreprise = {}, editedAt = new Date().toISOString().slice(0, 10)) {
  const ent = entreprise || { Nom: '' };
  const orient = report.landscape ? 'A4 landscape' : 'A4 portrait';
  const kpiHtml = report.kpis && report.kpis.length
    ? `<div class="kpis">${report.kpis.map((k) => `<div class="kpi"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div></div>`).join('')}</div>`
    : '';
  const secHtml = report.secondaryTable && report.secondaryTable.rows && report.secondaryTable.rows.length
    ? `<h3>${esc(report.secondaryTable.title)}</h3>${renderHtmlTable(report.secondaryTable.columns, report.secondaryTable.rows, report.secondaryTable.totals)}`
    : '';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${esc(report.title)}</title><style>
  @page { size: ${orient}; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5px; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0D47A1; padding-bottom: 6px; margin-bottom: 10px; gap: 12px; }
  h1 { font-size: 14px; margin: 0 0 2px; color: #0D47A1; }
  h2 { font-size: 13px; margin: 0 0 2px; color: #111; }
  h3 { font-size: 11px; margin: 14px 0 6px; color: #0D47A1; }
  .s { color: #444; font-size: 9px; line-height: 1.4; }
  .titre { text-align: right; }
  .kpis { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .kpi { border: 1px solid #C5D6E8; background: #F4F8FC; border-radius: 4px; padding: 5px 10px; min-width: 110px; }
  .kl { font-size: 8.5px; color: #555; text-transform: uppercase; }
  .kv { font-size: 11px; font-weight: bold; color: #0D47A1; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { background: #0D47A1; color: #fff; padding: 4px 5px; text-align: left; font-size: 8.8px; white-space: nowrap; }
  th.n, td.n { text-align: right; white-space: nowrap; }
  td { padding: 3.5px 5px; border-bottom: 1px solid #DCE5EF; font-size: 8.8px; }
  tbody tr:nth-child(even) { background: #FAFBFD; }
  tr.tot td { font-weight: bold; background: #EEF3FA; border-top: 1.5px solid #0D47A1; border-bottom: 1.5px solid #0D47A1; }
  footer { margin-top: 12px; font-size: 8.5px; color: #555; display: flex; justify-content: space-between; border-top: 1px solid #DDD; padding-top: 5px; }
  </style></head><body>
  <header>
    <div>
      <h1>${esc(ent.Nom || 'PaieGestion')}</h1>
      <div class="s">${esc([ent.Adresse, ent.Ville].filter(Boolean).join(', '))}${ent.Telephone ? ' — Tél. ' + esc(ent.Telephone) : ''}</div>
      <div class="s">${[ent.NINEA && 'NINEA : ' + ent.NINEA, ent.NumeroIPRES && 'N° IPRES : ' + ent.NumeroIPRES, ent.NumeroCSS && 'N° CSS : ' + ent.NumeroCSS].filter(Boolean).map(esc).join(' · ')}</div>
    </div>
    <div class="titre">
      <h2>${esc(report.title)}</h2>
      <div class="s">${esc(report.subtitle)}</div>
    </div>
  </header>
  ${kpiHtml}
  ${report.rows.length ? renderHtmlTable(report.columns, report.rows, report.totals) : `<p class="s">${esc(report.emptyMessage || 'Aucune donnée.')}</p>`}
  ${secHtml}
  <footer><span>PaieGestion — Montants en francs CFA (FCFA)</span><span>Édité le ${esc(fmtDate(editedAt))}</span></footer>
  </body></html>`;
}

module.exports = {
  REPORT_TYPES, MOIS, SITFAM, STATUT_CONGE,
  buildReport, reportToCsv, reportToHtml,
  fmtMoney, fmtNum, fmtDate, periodLabel, periodSlug,
};
