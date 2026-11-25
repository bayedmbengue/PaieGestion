'use strict';
/** Génère le HTML des bulletins de paie (impression A4 en PDF par Electron). */

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(n))).replace(/[\u202f\u00a0]/g, ' '));
const fmtTaux = (t) => (t == null ? '' : `${String(Number(t)).replace('.', ',')} %`);
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const SITFAM = { C: 'Célibataire', M: 'Marié(e)', D: 'Divorcé(e)', V: 'Veuf/Veuve' };

function bulletinHtml(b, per, ent) {
  const gains = b.lignes.filter((l) => Number(l.MontantGain) !== 0);   // inclut les retenues d'absence (gain négatif)
  const retenues = b.lignes.filter((l) => Number(l.MontantRetenue) > 0);
  const patronal = b.lignes.filter((l) => Number(l.MontantPatronal) > 0);
  const totalRet = Number(b.TotalCotisSalariales) + Number(b.ImpotRevenu) + Number(b.TRIMF) + Number(b.AutresRetenues);
  const periodeTxt = `${MOIS[per.Mois - 1]} ${per.Annee}`;

  const rows = [
    ...gains.map((l) => `<tr><td>${esc(l.Libelle)}</td><td class="n">${fmt(l.Base)}</td><td class="n">${fmtTaux(l.Taux)}</td><td class="n">${fmt(l.MontantGain)}</td><td class="n"></td></tr>`),
    `<tr class="sub"><td colspan="3">Salaire brut</td><td class="n">${fmt(b.Brut)}</td><td></td></tr>`,
    ...retenues.map((l) => `<tr><td>${esc(l.Libelle)}</td><td class="n">${fmt(l.Base)}</td><td class="n">${fmtTaux(l.Taux)}</td><td></td><td class="n">${fmt(l.MontantRetenue)}</td></tr>`),
    `<tr class="sub"><td colspan="3">Total des retenues</td><td></td><td class="n">${fmt(totalRet)}</td></tr>`,
  ].join('');

  return `<section class="page">
  <header>
    <div><h1>${esc(ent.Nom)}</h1>
      <div class="s">${esc([ent.Adresse, ent.Ville].filter(Boolean).join(', '))}${ent.Telephone ? ' — Tél. ' + esc(ent.Telephone) : ''}</div>
      <div class="s">${ent.NINEA ? 'NINEA : ' + esc(ent.NINEA) + ' ' : ''}${ent.NumeroIPRES ? '· N° IPRES employeur : ' + esc(ent.NumeroIPRES) + ' ' : ''}${ent.NumeroCSS ? '· N° CSS employeur : ' + esc(ent.NumeroCSS) : ''}</div></div>
    <div class="titre"><h2>BULLETIN DE PAIE</h2><div>${esc(periodeTxt)}</div></div>
  </header>
  <table class="info"><tr>
    <td><b>${esc(b.Nom)} ${esc(b.Prenom)}</b><br>Matricule : ${esc(b.Matricule)}<br>Emploi : ${esc(b.Poste || '—')}${b.Departement ? '<br>Service : ' + esc(b.Departement) : ''}${b.Categorie ? '<br>Catégorie : ' + esc(b.CategorieLibelle || b.Categorie) : ''}${b.Echelon ? ' — Classe : ' + esc(b.ClasseLibelle || b.Echelon) : ''}</td>
    <td>Date d'embauche : ${fmtDate(b.DateEmbauche)}<br>Situation : ${esc(SITFAM[b.SituationFamiliale] || '')} — ${esc(b.NombreEnfants)} enfant(s)<br>Nombre de parts : ${esc(String(b.NombreParts).replace('.', ','))}<br>Statut : ${b.EstCadre ? 'Cadre' : 'Non-cadre'}</td>
    <td>N° IPRES : ${esc(b.NumeroIPRES || '—')}<br>N° CSS : ${esc(b.NumeroCSS || '—')}<br>Paiement : ${esc(b.ModePaiement)}${b.Banque ? '<br>' + esc(b.Banque) : ''}${b.NumeroCompte ? '<br>Compte : ' + esc(b.NumeroCompte) : ''}</td>
  </tr></table>
  <table class="lignes">
    <thead><tr><th>Désignation</th><th>Base</th><th>Taux</th><th>Gains</th><th>Retenues</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="net"><tr><td>NET À PAYER</td><td class="n">${fmt(b.Net)} FCFA</td></tr></table>
  <table class="pat">
    <thead><tr><th colspan="3">Charges patronales (information)</th></tr></thead>
    <tbody>${patronal.map((l) => `<tr><td>${esc(l.Libelle)}</td><td class="n">${fmtTaux(l.Taux)}</td><td class="n">${fmt(l.MontantPatronal)}</td></tr>`).join('')}
    <tr class="sub"><td colspan="2">Total charges patronales</td><td class="n">${fmt(b.TotalCotisPatronales)}</td></tr>
    <tr class="sub"><td colspan="2">Coût total employeur</td><td class="n">${fmt(b.CoutEmployeur)}</td></tr></tbody>
  </table>
  ${b.conge ? `<table class="pat"><tbody><tr class="sub"><td>Congés payés : acquis ${esc(String(b.conge.acquis).replace('.', ','))} j — pris ${esc(String(b.conge.pris).replace('.', ','))} j</td><td class="n">Solde : ${esc(String(b.conge.solde).replace('.', ','))} j</td></tr></tbody></table>` : ''}
  <footer>Bulletin à conserver sans limitation de durée. Montants en francs CFA (FCFA).</footer>
</section>`;
}

function bulletinsDocument(data) {
  const pages = data.bulletins.map((b) => bulletinHtml(b, data.periode, data.entreprise)).join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Bulletins de paie</title><style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
  .page { page-break-after: always; } .page:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0D47A1; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 16px; margin: 0 0 3px; color: #0D47A1; } h2 { font-size: 15px; margin: 0; } .s { color: #444; font-size: 10px; }
  .titre { text-align: right; } table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .info td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; width: 33%; line-height: 1.5; }
  .lignes th { background: #0D47A1; color: #fff; padding: 5px 6px; text-align: left; font-size: 10.5px; } .lignes th:nth-child(n+2) { text-align: right; }
  .lignes td, .pat td { padding: 4px 6px; border-bottom: 1px solid #ddd; } .n { text-align: right; white-space: nowrap; }
  tr.sub td { font-weight: bold; background: #EEF3FA; border-top: 1px solid #999; }
  .net td { background: #0D47A1; color: #fff; font-size: 14px; font-weight: bold; padding: 9px 10px; }
  .pat th { text-align: left; background: #EEF3FA; padding: 4px 6px; font-size: 10px; border: 1px solid #ccc; } .pat { font-size: 10px; }
  footer { margin-top: 14px; font-size: 9px; color: #555; text-align: center; }
  </style></head><body>${pages}</body></html>`;
}

module.exports = { bulletinsDocument, bulletinHtml, fmt };
