'use strict';
/**
 * Logique pure du module « Rubriques de paie » :
 *  - calcul du montant d'une ligne selon son mode de calcul (FIXE, POURCENTAGE, VARIABLE, AUTO) ;
 *  - calcul des 3 assiettes distinctes (IR, cotisations IPRES/CSS/IPM, CFCE/TRIMF) avec plafonds d'exonération.
 */

const MODES_CALCUL = ['FIXE', 'POURCENTAGE', 'VARIABLE', 'AUTO'];
const MODES_SAISIE = ['FIXE', 'POURCENTAGE', 'VARIABLE'];

/** Résout le montant mensuel (FCFA) d'une ligne selon son mode de calcul. */
function montantLigne(ligne, salaireBase = 0) {
  const mt = ligne.Montant != null && ligne.Montant !== '' ? Number(ligne.Montant) : 0;
  const taux = ligne.Taux != null && ligne.Taux !== '' ? Number(ligne.Taux) : 0;
  if (ligne.ModeCalcul === 'POURCENTAGE' && taux !== 0 && !mt) {
    return Math.round(Number(salaireBase || 0) * taux / 100);
  }
  return Number.isFinite(mt) ? mt : 0;
}

/** Plafond d'exonération mensuel d'un gain : colonne PlafondExoneration de la rubrique (avec repli sur ParametreLegal EXO_<CODE>). */
function plafondExoneration(ligne, params) {
  if (ligne.PlafondExoneration !== undefined && ligne.PlafondExoneration !== null && ligne.PlafondExoneration !== '') {
    const n = Number(ligne.PlafondExoneration);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (params && typeof params.has === 'function' && ligne.Code && params.has(`EXO_${ligne.Code}`)) {
    const n = Number(params.get(`EXO_${ligne.Code}`));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

/** Part soumise d'un gain après déduction du plafond d'exonération mensuel (un gain négatif comme une absence réduit intégralement l'assiette). */
function partSoumise(montant, plafond) {
  if (montant < 0) return montant;
  if (plafond > 0) return Math.max(0, montant - Math.min(montant, plafond));
  return montant;
}

/**
 * Calcule les montants résolus et les assiettes (brut, brutImposable/IR, brutCotisable/IPRES-CSS-IPM, brutCfceTrimf/CFCE-TRIMF, autresRetenues)
 * à partir des indicateurs propres à chaque rubrique.
 */
function calculerAssiettes(lignes, salaireBase = 0, params = null) {
  const resolved = lignes.map((l) => {
    const m = montantLigne(l, salaireBase);
    const isPct = l.ModeCalcul === 'POURCENTAGE' && l.Taux != null && Number(l.Taux) !== 0 && !(l.Montant != null && Number(l.Montant) !== 0);
    return {
      ...l,
      Montant: m,
      BaseCalculee: isPct ? Number(salaireBase || 0) : null,
      TauxCalcule: isPct ? Number(l.Taux) : null,
    };
  });

  const gains = resolved.filter((l) => l.Type === 'GAIN');
  const retenues = resolved.filter((l) => l.Type === 'RETENUE');

  let brut = 0;
  let brutImposable = 0;
  let brutCotisable = 0;
  let brutCfceTrimf = 0;

  for (const g of gains) {
    const m = Number(g.Montant);
    brut += m;
    const soumis = partSoumise(m, plafondExoneration(g, params));
    const sIr = !!g.Imposable;
    const sCotis = g.SoumisCotisation !== undefined ? !!g.SoumisCotisation : sIr;
    const sCfce = g.SoumisCfceTrimf !== undefined ? !!g.SoumisCfceTrimf : sIr;
    if (sIr) brutImposable += soumis;
    if (sCotis) brutCotisable += soumis;
    if (sCfce) brutCfceTrimf += soumis;
  }

  const autresRetenues = retenues.reduce((s, r) => s + Number(r.Montant), 0);

  return {
    gains,
    retenues,
    brut,
    brutImposable: Math.max(0, brutImposable),
    brutCotisable: Math.max(0, brutCotisable),
    brutCfceTrimf: Math.max(0, brutCfceTrimf),
    autresRetenues,
  };
}

module.exports = { MODES_CALCUL, MODES_SAISIE, montantLigne, plafondExoneration, partSoumise, calculerAssiettes };
