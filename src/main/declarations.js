'use strict';
/**
 * Module « Déclarations sur salaires » : états à remettre à l'administration fiscale et aux organismes sociaux.
 *   decl_ir        Impôt sur le revenu retenu à la source (DGID)
 *   decl_trimf     Taxe représentative de l'impôt minimum fiscal (DGID)
 *   decl_cfce      Contribution forfaitaire à la charge de l'employeur (DGID)
 *   decl_ipres_css Cotisations IPRES (régime général et cadre) et Caisse de sécurité sociale (CSS)
 *   decl_ipm       Institut de prévoyance maladie (IPM)
 *   decl_1024      État récapitulatif annuel des salaires et sommes versées (État 1024, DGID)
 * Fonctions pures : elles transforment les lignes agrégées par employé (rapportsRepo.queryDeclaration) en un rapport
 * au même format que les autres rapports (colonnes, lignes, totaux, KPI) : affichage, export CSV et PDF identiques.
 */
const { SITFAM, fmtMoney, periodLabel, periodSlug } = require('./rapports');

const DECL_TYPES = ['decl_ir', 'decl_trimf', 'decl_cfce', 'decl_ipres_css', 'decl_ipm', 'decl_1024'];

const r2 = (x) => Math.round(Number(x || 0) * 100) / 100;
const sum = (rows, keys) => Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((s, r) => s + Number(r[k] || 0), 0))]));
const money = (key, label, extra = {}) => ({ key, label, align: 'n', format: 'money', ...extra });
const ident = [
  { key: 'Matricule', label: 'Matricule' },
  { key: 'Nom', label: 'Nom', bold: true },
  { key: 'Prenom', label: 'Prénom' },
];
const sub = (txt, meta = {}) => [txt, meta.employeLabel && `Employé : ${meta.employeLabel}`, meta.categorieLabel && `Catégorie : ${meta.categorieLabel}`].filter(Boolean).join(' · ');

function prepare(rawRows) {
  return rawRows.map((r) => ({
    ...r,
    Situation: SITFAM[r.SituationFamiliale] || r.SituationFamiliale || '',
    IpresTotal: r2(Number(r.IpresRgSal || 0) + Number(r.IpresRgPat || 0) + Number(r.IpresRccSal || 0) + Number(r.IpresRccPat || 0)),
    CssTotal: r2(Number(r.CssPfPat || 0) + Number(r.CssAtmpPat || 0)),
    IpmTotal: r2(Number(r.IpmSal || 0) + Number(r.IpmPat || 0)),
  })).map((r) => ({ ...r, SocialTotal: r2(r.IpresTotal + r.CssTotal) }));
}

function base(type, titre, f, meta, extra) {
  const per = periodLabel(f.annee, f.moisDebut, f.moisFin);
  return {
    type, title: titre, subtitle: sub(per, meta), landscape: true,
    filenameBase: `${extra.fichier}_${periodSlug(f.annee, f.moisDebut, f.moisFin)}`,
    emptyMessage: `Aucun bulletin trouvé pour ${per}. Calculez d'abord la paie de la période.`,
    ...extra.report,
  };
}

function buildDeclaration(type, rawRows, f, meta = {}) {
  const rows = prepare(rawRows);
  const n = rows.length;
  const tot = (keys) => (n ? { Matricule: `Total (${n})`, ...sum(rows, keys) } : null);

  if (type === 'decl_ir') {
    const s = sum(rows, ['BrutImposable', 'ImpotRevenu']);
    return base(type, 'Déclaration de l\'impôt sur le revenu (IR) retenu à la source', f, meta, {
      fichier: 'Declaration_IR',
      report: {
        kpis: [{ label: 'Salariés', value: String(n) }, { label: 'Revenu brut imposable', value: `${fmtMoney(s.BrutImposable)} FCFA` }, { label: 'IR à reverser', value: `${fmtMoney(s.ImpotRevenu)} FCFA`, tone: 'ok' }],
        columns: [...ident, { key: 'Situation', label: 'Situation' }, { key: 'NombreParts', label: 'Parts', align: 'n', format: 'num' }, { key: 'NbMois', label: 'Mois', align: 'n', format: 'num' },
          money('BrutImposable', 'Revenu brut imposable'), money('ImpotRevenu', 'IR retenu', { bold: true })],
        rows, totals: tot(['BrutImposable', 'ImpotRevenu']),
      },
    });
  }

  if (type === 'decl_trimf') {
    const s = sum(rows, ['BrutCfceTrimf', 'TRIMF']);
    return base(type, 'Déclaration de la TRIMF retenue à la source', f, meta, {
      fichier: 'Declaration_TRIMF',
      report: {
        kpis: [{ label: 'Salariés', value: String(n) }, { label: 'Salariés soumis', value: String(rows.filter((r) => Number(r.TRIMF) > 0).length) }, { label: 'TRIMF à reverser', value: `${fmtMoney(s.TRIMF)} FCFA`, tone: 'ok' }],
        columns: [...ident, { key: 'Situation', label: 'Situation' }, { key: 'NbMois', label: 'Mois', align: 'n', format: 'num' }, money('BrutCfceTrimf', 'Revenu brut soumis'), money('TRIMF', 'TRIMF retenue', { bold: true })],
        rows, totals: tot(['BrutCfceTrimf', 'TRIMF']),
      },
    });
  }

  if (type === 'decl_cfce') {
    const s = sum(rows, ['BrutCfceTrimf', 'CfcePat']);
    const taux = s.BrutCfceTrimf > 0 ? Math.round(s.CfcePat / s.BrutCfceTrimf * 10000) / 100 : 0;
    return base(type, 'Déclaration de la CFCE (contribution forfaitaire à la charge de l\'employeur)', f, meta, {
      fichier: 'Declaration_CFCE',
      report: {
        kpis: [{ label: 'Salariés', value: String(n) }, { label: 'Masse salariale soumise', value: `${fmtMoney(s.BrutCfceTrimf)} FCFA` }, { label: 'Taux effectif', value: `${String(taux).replace('.', ',')} %` }, { label: 'CFCE à reverser', value: `${fmtMoney(s.CfcePat)} FCFA`, tone: 'ok' }],
        columns: [...ident, { key: 'NbMois', label: 'Mois', align: 'n', format: 'num' }, money('BrutCfceTrimf', 'Base CFCE (salaires soumis)'), money('CfcePat', 'CFCE (employeur)', { bold: true })],
        rows, totals: tot(['BrutCfceTrimf', 'CfcePat']),
      },
    });
  }

  if (type === 'decl_ipres_css') {
    const s = sum(rows, ['IpresRgSal', 'IpresRgPat', 'IpresRccSal', 'IpresRccPat', 'CssPfPat', 'CssAtmpPat', 'IpresTotal', 'CssTotal', 'SocialTotal']);
    const rec = [
      { Organisme: 'IPRES — régime général', Sal: s.IpresRgSal, Pat: s.IpresRgPat },
      { Organisme: 'IPRES — régime complémentaire cadres', Sal: s.IpresRccSal, Pat: s.IpresRccPat },
      { Organisme: 'CSS — prestations familiales', Sal: 0, Pat: s.CssPfPat },
      { Organisme: 'CSS — accidents du travail et maladies professionnelles', Sal: 0, Pat: s.CssAtmpPat },
    ].map((x) => ({ ...x, Total: r2(x.Sal + x.Pat) }));
    return base(type, 'Déclaration des cotisations IPRES et Caisse de sécurité sociale (CSS)', f, meta, {
      fichier: 'Declaration_IPRES_CSS',
      report: {
        kpis: [{ label: 'Salariés', value: String(n) }, { label: 'IPRES à verser', value: `${fmtMoney(s.IpresTotal)} FCFA` }, { label: 'CSS à verser', value: `${fmtMoney(s.CssTotal)} FCFA` }, { label: 'Total', value: `${fmtMoney(s.SocialTotal)} FCFA`, tone: 'ok' }],
        columns: [...ident, { key: 'NumeroIPRES', label: 'N° IPRES' }, { key: 'NumeroCSS', label: 'N° CSS' }, money('BaseIPRES', 'Base plafonnée'),
          money('IpresRgSal', 'IPRES RG sal.'), money('IpresRgPat', 'IPRES RG pat.'), money('IpresRccSal', 'RCC sal.'), money('IpresRccPat', 'RCC pat.'),
          money('CssPfPat', 'CSS PF'), money('CssAtmpPat', 'CSS AT/MP'), money('SocialTotal', 'Total', { bold: true })],
        rows, totals: tot(['BaseIPRES', 'IpresRgSal', 'IpresRgPat', 'IpresRccSal', 'IpresRccPat', 'CssPfPat', 'CssAtmpPat', 'SocialTotal']),
        secondaryTable: {
          title: 'Récapitulatif par organisme',
          columns: [{ key: 'Organisme', label: 'Organisme / régime', bold: true }, money('Sal', 'Part salariale'), money('Pat', 'Part patronale'), money('Total', 'Total à verser', { bold: true })],
          rows: rec, totals: { Organisme: 'Total', ...sum(rec, ['Sal', 'Pat', 'Total']) },
        },
      },
    });
  }

  if (type === 'decl_ipm') {
    const s = sum(rows, ['IpmSal', 'IpmPat', 'IpmTotal']);
    return base(type, 'Déclaration des cotisations IPM (institut de prévoyance maladie)', f, meta, {
      fichier: 'Declaration_IPM',
      report: {
        kpis: [{ label: 'Salariés', value: String(n) }, { label: 'Part salariale', value: `${fmtMoney(s.IpmSal)} FCFA` }, { label: 'Part patronale', value: `${fmtMoney(s.IpmPat)} FCFA` }, { label: 'Total à verser', value: `${fmtMoney(s.IpmTotal)} FCFA`, tone: 'ok' }],
        columns: [...ident, { key: 'NbMois', label: 'Mois', align: 'n', format: 'num' }, money('Brut', 'Brut'), money('IpmSal', 'Part salariale'), money('IpmPat', 'Part patronale'), money('IpmTotal', 'Total', { bold: true })],
        rows, totals: tot(['Brut', 'IpmSal', 'IpmPat', 'IpmTotal']),
      },
    });
  }

  if (type === 'decl_1024') {
    const s = sum(rows, ['Brut', 'TotalCotisSalariales', 'BrutImposable', 'ImpotRevenu', 'TRIMF', 'Net', 'CfcePat']);
    const rec = [
      { Rubrique: 'Nombre de salariés', Valeur: n },
      { Rubrique: 'Total des rémunérations brutes versées', Valeur: s.Brut },
      { Rubrique: 'Total des cotisations sociales salariales', Valeur: s.TotalCotisSalariales },
      { Rubrique: 'Total du revenu brut imposable', Valeur: s.BrutImposable },
      { Rubrique: 'Total de l\'IR retenu', Valeur: s.ImpotRevenu },
      { Rubrique: 'Total de la TRIMF retenue', Valeur: s.TRIMF },
      { Rubrique: 'Total de la CFCE (employeur)', Valeur: s.CfcePat },
    ];
    return {
      type, title: 'État récapitulatif annuel des salaires versés (État 1024)',
      subtitle: sub(`Exercice ${f.annee} — état de travail à reporter sur l'imprimé ou la télé-procédure de la DGID`, meta),
      filenameBase: `Etat_1024_${f.annee}`, landscape: true,
      emptyMessage: `Aucun bulletin trouvé pour l'exercice ${f.annee}.`,
      kpis: [{ label: 'Salariés', value: String(n) }, { label: 'Rémunérations brutes', value: `${fmtMoney(s.Brut)} FCFA` }, { label: 'IR retenu', value: `${fmtMoney(s.ImpotRevenu)} FCFA` }, { label: 'TRIMF retenue', value: `${fmtMoney(s.TRIMF)} FCFA`, tone: 'ok' }],
      columns: [...ident, { key: 'NumeroCSS', label: 'N° CSS' }, { key: 'DateEmbauche', label: 'Embauche', format: 'date' }, { key: 'DateSortie', label: 'Sortie', format: 'date' },
        { key: 'NbMois', label: 'Mois', align: 'n', format: 'num' }, money('Brut', 'Rémunération brute'), money('TotalCotisSalariales', 'Cotis. sociales sal.'),
        money('BrutImposable', 'Revenu imposable'), money('ImpotRevenu', 'IR retenu'), money('TRIMF', 'TRIMF'), money('Net', 'Net payé', { bold: true })],
      rows, totals: tot(['Brut', 'TotalCotisSalariales', 'BrutImposable', 'ImpotRevenu', 'TRIMF', 'Net']),
      secondaryTable: {
        title: 'Récapitulatif de l\'exercice',
        columns: [{ key: 'Rubrique', label: 'Rubrique', bold: true }, { key: 'Valeur', label: 'Valeur', align: 'n', format: 'money' }],
        rows: rec.map((x, i) => (i === 0 ? { ...x, Valeur: x.Valeur } : x)), totals: null,
      },
    };
  }
  throw new Error(`Déclaration inconnue : ${type}`);
}

module.exports = { DECL_TYPES, buildDeclaration };
