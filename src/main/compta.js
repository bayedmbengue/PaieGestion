'use strict';
/** Construction des écritures comptables de paie (fonctions pures, testées). Montants en FCFA. */
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * rows : une ligne par rubrique { Code, Libelle, Type, CompteDebit, CompteCredit, Gain, Ret, Pat } (sommes de la période)
 * netTotal : total des nets à payer ; params : { COMPTE_REMUNERATION_DUE, ... } ; plan : { compte: libellé }
 */
function buildEcritures({ rows, netTotal, params, plan = {} }) {
  const acc = new Map();
  const sansCompte = new Set();
  const add = (compte, libelle, debit, credit) => {
    const k = `${compte}|${libelle}`;
    const e = acc.get(k) || { compte, libelle, debit: 0, credit: 0 };
    e.debit = r2(e.debit + debit); e.credit = r2(e.credit + credit);
    acc.set(k, e);
  };
  const defaut = (cle) => {
    if (!params[cle]) throw new Error(`Paramètre comptable manquant : ${cle}`);
    return params[cle];
  };
  for (const r of rows) {
    const choisir = (specifique, cle) => { if (specifique) return specifique; sansCompte.add(`${r.Code} — ${r.Libelle}`); return defaut(cle); };
    const gain = Number(r.Gain || 0); const ret = Number(r.Ret || 0); const pat = Number(r.Pat || 0);
    if (gain) {
      const c = choisir(r.CompteDebit, 'COMPTE_GAIN_DEFAUT');
      if (gain > 0) add(c, r.Libelle, gain, 0); else add(c, r.Libelle, 0, -gain);   // gain négatif (absence) : crédit
    }
    if (ret) {
      const cle = r.Type === 'COTIS_SAL' ? 'COMPTE_COTIS_SAL_DEFAUT' : r.Type === 'IMPOT' ? 'COMPTE_IMPOT_DEFAUT' : 'COMPTE_RETENUE_DEFAUT';
      add(choisir(r.CompteCredit, cle), r.Libelle, 0, ret);
    }
    if (pat) {
      add(choisir(r.CompteDebit, 'COMPTE_CHARGE_PAT_DEFAUT'), `${r.Libelle} (charge patronale)`, pat, 0);
      add(choisir(r.CompteCredit, 'COMPTE_ORGANISME_PAT_DEFAUT'), r.Libelle, 0, pat);
    }
  }
  add(defaut('COMPTE_REMUNERATION_DUE'), 'Rémunérations dues au personnel (net à payer)', 0, Number(netTotal || 0));
  const lignes = [...acc.values()]
    .map((l) => ({ ...l, compteLibelle: plan[l.compte] || '' }))
    .sort((a, b) => (b.debit > 0) - (a.debit > 0) || a.compte.localeCompare(b.compte) || a.libelle.localeCompare(b.libelle));
  const totalDebit = r2(lignes.reduce((s, l) => s + l.debit, 0));
  const totalCredit = r2(lignes.reduce((s, l) => s + l.credit, 0));
  return { lignes, totalDebit, totalCredit, equilibre: Math.abs(totalDebit - totalCredit) < 0.005, sansCompte: [...sansCompte] };
}

const ORGANISMES = [
  ['IPRES — régime général', ['IPRES_RG_SAL', 'IPRES_RG_PAT']],
  ['IPRES — régime complémentaire cadres', ['IPRES_RCC_SAL', 'IPRES_RCC_PAT']],
  ['CSS — prestations familiales et accidents du travail', ['CSS_PF_PAT', 'CSS_ATMP_PAT']],
  ['IPM', ['IPM_SAL', 'IPM_PAT']],
  ['Impôt sur le revenu (DGID)', ['IR']],
  ['TRIMF', ['TRIMF']],
  ['CFCE (DGID)', ['CFCE_PAT']],
];

/** rows : [{ Code, Ret, Pat }] sommes de la période par rubrique → montants à reverser par organisme. */
function regrouperReversements(rows) {
  const byCode = new Map(rows.map((r) => [r.Code, r]));
  return ORGANISMES.map(([organisme, codes]) => {
    let sal = 0; let pat = 0;
    for (const c of codes) { const r = byCode.get(c); if (r) { sal += Number(r.Ret || 0); pat += Number(r.Pat || 0); } }
    return { organisme, retenueSalariale: sal, partPatronale: pat, total: sal + pat };
  });
}

module.exports = { buildEcritures, regrouperReversements, ORGANISMES };
