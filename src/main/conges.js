'use strict';
/** Calculs de congés et d'absences (fonctions pures, testées). Dates au format AAAA-MM-JJ. */
const DAY = 86400000;
const parse = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** Jours ouvrables (du lundi au samedi) entre deux dates incluses. Les jours fériés ne sont pas retirés : le nombre de jours reste modifiable. */
function joursOuvrables(debut, fin) {
  let n = 0;
  for (let t = parse(debut); t <= parse(fin); t += DAY) if (new Date(t).getUTCDay() !== 0) n += 1;
  return n;
}

/** Part d'un congé comprise dans la période [pDebut, pFin] ; au prorata si le nombre de jours saisi diffère du calcul. */
function joursDansPeriode({ debut, fin, nombreJours }, pDebut, pFin) {
  const a = parse(debut) > parse(pDebut) ? debut : pDebut;
  const b = parse(fin) < parse(pFin) ? fin : pFin;
  if (parse(a) > parse(b)) return 0;
  const total = joursOuvrables(debut, fin);
  if (total === 0) return 0;
  const part = joursOuvrables(a, b);
  const nb = Number(nombreJours);
  return nb > 0 ? Math.round((part * nb / total) * 10) / 10 : part;
}

/** Nombre de mois entiers écoulés entre deux dates. */
function moisComplets(depuis, jusqu) {
  const [y1, m1, d1] = String(depuis).slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = String(jusqu).slice(0, 10).split('-').map(Number);
  const n = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, n);
}

/** Solde de congés payés : reprise de solde + jours acquis par mois de service − jours pris. */
function calcSolde({ initial, depuis, jusqu, pris, joursParMois }) {
  const acquis = Math.round((Number(initial || 0) + Number(joursParMois) * moisComplets(depuis, jusqu)) * 10) / 10;
  const p = Number(pris || 0);
  return { acquis, pris: p, solde: Math.round((acquis - p) * 10) / 10 };
}

module.exports = { joursOuvrables, joursDansPeriode, moisComplets, calcSolde };
