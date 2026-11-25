'use strict';
/**
 * Moteur de calcul de la paie (montants mensuels en FCFA, arrondis à l'unité).
 *
 * Les règles ont été recoupées avec un bulletin de paie de référence (octobre 2026, cadre marié, 2 enfants, conjoint
 * sans revenus) : IPRES, IPM, CSS, CFCE, TRIMF, IR et net à payer retrouvés au franc près (voir test/calc.test.js).
 * À faire valider par un expert en paie / la DGID avant usage réel.
 * Les taux et plafonds viennent de la base (tables ParametreLegal, BaremeIR, BaremeTRIMF).
 */
const R = (x) => Math.sign(x) * Math.round(Math.abs(x));

/** rows: [{Code, Valeur}] ; bareme: [{TrancheMin, TrancheMax, Taux}] ; trimf: [{SalaireMin, SalaireMax, Montant}] */
function makeParams(rows, bareme = [], trimf = []) {
  const map = new Map(rows.map((r) => [r.Code, Number(r.Valeur)]));
  return {
    has: (code) => map.has(code),
    get(code) {
      if (!map.has(code)) throw new Error(`Paramètre légal manquant ou expiré : ${code}`);
      return map.get(code);
    },
    bareme: bareme.map((t) => ({ min: Number(t.TrancheMin), max: t.TrancheMax == null ? Infinity : Number(t.TrancheMax), taux: Number(t.Taux) }))
      .sort((a, b) => a.min - b.min),
    trimf: trimf.map((t) => ({ min: Number(t.SalaireMin), max: t.SalaireMax == null ? Infinity : Number(t.SalaireMax), montant: Number(t.Montant) })),
  };
}

function calculer({ brut, brutCotisable, brutImposable, brutCfceTrimf = brutImposable, estCadre, parts, partsTrimf = 1, autresRetenues = 0 }, p) {
  // IPRES régime général
  const plafondRg = p.get('IPRES_RG_PLAFOND');
  const baseRg = Math.min(brutCotisable, plafondRg);
  const rgSal = R(baseRg * p.get('IPRES_RG_SAL') / 100);
  const rgPat = R(baseRg * p.get('IPRES_RG_PAT') / 100);

  // IPRES régime complémentaire cadre : sur TOUT le salaire cotisable, jusqu'à son plafond (bulletin de référence)
  let rccSal = 0; let rccPat = 0;
  if (estCadre) {
    const baseRcc = Math.min(brutCotisable, p.get('IPRES_RCC_PLAFOND'));
    rccSal = R(baseRcc * p.get('IPRES_RCC_SAL') / 100);
    rccPat = R(baseRcc * p.get('IPRES_RCC_PAT') / 100);
  }

  // CSS et CFCE (charges patronales)
  const baseCss = Math.min(brutCotisable, p.get('CSS_PLAFOND'));
  const cssPf = R(baseCss * p.get('CSS_PF_PAT') / 100);
  const cssAtmp = R(baseCss * p.get('CSS_ATMP_PAT') / 100);
  // CFCE : 3 % des éléments soumis à CFCE/TRIMF (hors remboursements de frais exonérés)
  const cfce = R(brutCfceTrimf * p.get('CFCE_PAT') / 100);

  // IPM (assurance maladie) : taux et plafonds mensuels paramétrables (5 % salarié plafonné à 12 500 ; 6 % employeur plafonné à 15 000)
  const ipmSal = Math.min(R(brutCotisable * p.get('IPM_SAL') / 100), p.get('IPM_PLAFOND_SAL'));
  const ipmPat = Math.min(R(brutCotisable * p.get('IPM_PAT') / 100), p.get('IPM_PLAFOND_PAT'));

  const totalCotisSal = rgSal + rccSal + ipmSal;
  const totalCotisPat = rgPat + rccPat + cssPf + cssAtmp + cfce + ipmPat;


  // Impôt sur le revenu : brut imposable annualisé (les cotisations salariales ne sont PAS déduites : méthode
  // vérifiée au franc près sur un bulletin de référence), abattement de 30 % plafonné (900 000 FCFA/an), barème
  // progressif par tranches, puis RÉDUCTION D'IMPÔT POUR CHARGES DE FAMILLE (pourcentage de l'impôt selon le
  // nombre de parts, comprise entre un minimum et un maximum).
  const nbParts = Math.min(5, Math.max(1, Math.round((Number(parts) || 1) * 2) / 2));
  const annuelAvantAbattement = Math.max(0, brutImposable) * 12;
  const abattement = Math.min(annuelAvantAbattement * p.get('ABATTEMENT_IR') / 100, p.get('ABATTEMENT_IR_PLAFOND'));
  const revenuNetAnnuel = annuelAvantAbattement - abattement;
  let impotBrut = 0;
  for (const t of p.bareme) {
    if (revenuNetAnnuel > t.min) impotBrut += (Math.min(revenuNetAnnuel, t.max) - t.min) * t.taux / 100;
  }
  let reduction = 0;
  if (nbParts > 1) {
    const taux = p.get(`RED_FAM_${nbParts}_TAUX`);
    const mini = p.get(`RED_FAM_${nbParts}_MIN`);
    const maxi = p.get(`RED_FAM_${nbParts}_MAX`);
    reduction = Math.min(Math.max(impotBrut * taux / 100, mini), maxi);
  }
  const ir = R(Math.max(0, impotBrut - reduction) / 12);

  // TRIMF : barème sur le revenu ANNUEL (brut x 12), montant annuel x parts TRIMF (1 ou 2), retenu par 12e chaque mois.
  // La règle d'articulation avec l'IR est paramétrable (TRIMF_REGLE) car elle reste à confirmer :
  //   1 = s'ajoute à l'IR (défaut) ; 2 = seule la plus élevée des deux est due ; 3 = non due si l'IR est > 0.
  const annuelBrut = Math.floor(brutCfceTrimf * 12);
  const tr = p.trimf.find((t) => annuelBrut >= t.min && annuelBrut <= t.max);
  let trimf = tr ? R(tr.montant * (Number(partsTrimf) || 1) / 12) : 0;
  const regle = p.has('TRIMF_REGLE') ? p.get('TRIMF_REGLE') : 1;
  if (regle === 2) trimf = Math.max(0, trimf - ir);
  else if (regle === 3 && ir > 0) trimf = 0;

  const net = brut - totalCotisSal - ir - trimf - autresRetenues;
  return {
    brut, baseIPRES: baseRg, baseImposable: R(revenuNetAnnuel / 12), baseCfceTrimf: brutCfceTrimf,
    rgSal, rccSal, rgPat, rccPat, ipmSal, ipmPat, baseIPM: brutCotisable, cssPf, cssAtmp, cfce,
    ir, trimf, totalCotisSal, totalCotisPat, autresRetenues,
    net, coutEmployeur: brut + totalCotisPat,
  };
}

module.exports = { calculer, makeParams, R };
