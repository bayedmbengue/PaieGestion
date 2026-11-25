'use strict';
/**
 * Nombre de parts d'après le tableau récapitulatif fourni (et le support de cours Impôts directs, ESP 2023, p. 31).
 *
 * PARTS POUR L'IR (réduction d'impôt pour charges de famille) :
 *   - Célibataire / divorcé : 1 part + 0,5 par enfant à charge.
 *   - Marié, conjoint QUI TRAVAILLE : 1,5 part + 0,5 par enfant.
 *   - Marié, conjoint QUI NE TRAVAILLE PAS : 2 parts + 0,5 par enfant (demi-part supplémentaire).
 *   - Veuf : 1 part sans enfant ; avec enfant(s) : 1,5 part + 0,5 par enfant.
 *   - Maximum : 5 parts.
 *   Cas particuliers (1,5 part pour un célibataire/divorcé/veuf sans enfant : enfant décédé, pension d'invalidité
 *   d'au moins 40 %, enfant adopté) : à saisir manuellement dans la fiche employé.
 *
 * PARTS POUR LA TRIMF : 2 pour un marié dont le conjoint ne travaille pas (la retenue est faite au nom du chef de
 * famille, pour lui et son conjoint) ; 1 dans tous les autres cas.
 */
function calcParts({ situation, enfants, conjointTravaille }) {
  const n = Math.max(0, Math.trunc(Number(enfants) || 0));
  let parts;
  if (situation === 'M') parts = (conjointTravaille ? 1.5 : 2) + 0.5 * n;
  else if (situation === 'V') parts = n === 0 ? 1 : 1.5 + 0.5 * n;
  else parts = 1 + 0.5 * n;          // C (célibataire) ou D (divorcé)
  return Math.min(5, parts);
}

function calcPartsTrimf({ situation, conjointTravaille }) {
  return situation === 'M' && !conjointTravaille ? 2 : 1;
}

module.exports = { calcParts, calcPartsTrimf };
