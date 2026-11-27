'use strict';
/* PaieGestion — interface. Aucune donnée n'est lue directement : tout passe par window.paie (pont sécurisé). */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || n === '' ? '' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(Number(n))));
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const PERMS = {
  ADMIN: ['read', 'write', 'paie', 'export', 'admin'], GESTIONNAIRE: ['read', 'write', 'paie', 'export'],
  COMPTABLE: ['read', 'export'], LECTEUR: ['read'],
};
const ROLE_LABEL = { ADMIN: 'Administrateur', GESTIONNAIRE: 'Gestionnaire de paie', COMPTABLE: 'Comptable', LECTEUR: 'Lecture seule' };
const today = () => new Date().toISOString().slice(0, 10);

const state = {
  user: null, info: null, page: 'employes', annee: new Date().getFullYear(), mois: new Date().getMonth() + 1, periode: null,
  paramTab: 'param', congeTab: 'demandes', congeAnnee: new Date().getFullYear(), congeStatut: '', comptaTab: 'ecritures',
  rubTab: 'catalogue', rubType: '', rubQ: '', rubEmp: '', rubRub: '', rubActifOnly: true,
  declTab: 'decl_ir', declAnnee: new Date().getFullYear(), declDebut: new Date().getMonth() + 1, declFin: new Date().getMonth() + 1,
  rapTab: 'journal', rapAnnee: new Date().getFullYear(), rapMois: new Date().getMonth() + 1,
  rapPerDebut: new Date().getMonth() + 1, rapPerFin: new Date().getMonth() + 1,
  rapAnnDebut: 1, rapAnnFin: 12,
  rapDateDebut: `${new Date().getFullYear()}-01-01`, rapDateFin: `${new Date().getFullYear()}-12-31`,
  rapEmp: '', rapCat: '', rapAnnuelVue: 'mois', rapOrg: 'TOUS', rapActif: '1', rapCongeStatut: '', rapCongeVue: 'demandes',
};
const can = (p) => !!state.user && (PERMS[state.user.role] || []).includes(p);

async function api(channel, ...args) {
  const r = await window.paie.call(channel, ...args);
  if (!r.ok) {
    if (/Session expirée/.test(r.error)) { state.user = null; showLogin(false); }
    throw new Error(r.error);
  }
  return r.data;
}

function toast(msg, type = 'ok') {
  const d = document.createElement('div');
  d.className = type; d.textContent = msg;
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), type === 'err' ? 7000 : 3500);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } };

// ───────────── Fenêtres modales ─────────────
function closeModal() { $('#modal').innerHTML = ''; }
function openModal({ title, body, wide, buttons = [], onOpen }) {
  const m = $('#modal');
  m.innerHTML = `<div class="overlay"><div class="dlg ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="dh"><h3>${esc(title)}</h3><button class="x" data-x aria-label="Fermer">✕</button></div><div class="db">${body}</div><div class="df"></div></div></div>`;
  $('[data-x]', m).onclick = closeModal;
  const df = $('.df', m);
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label; btn.className = b.cls || '';
    btn.onclick = async () => {
      btn.disabled = true;
      try { const r = await b.onClick(); if (r !== false) closeModal(); } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; }
    };
    df.appendChild(btn);
  }
  if (onOpen) onOpen($('.db', m));
}
const cancelBtn = { label: 'Fermer', onClick: () => true };
function confirmBox(message, label = 'Confirmer', cls = 'p') {
  return new Promise((resolve) => {
    openModal({
      title: 'Confirmation', body: `<p style="line-height:1.5">${esc(message)}</p>`,
      buttons: [{ label: 'Annuler', onClick: () => { resolve(false); return true; } }, { label, cls, onClick: () => { resolve(true); return true; } }],
    });
    $('[data-x]').onclick = () => { closeModal(); resolve(false); };
  });
}

// ───────────── Aides de formulaire ─────────────
const inp = (label, name, v = '', type = 'text', extra = '', cls = '') =>
  `<label class="f ${cls}"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(v)}" ${extra}></label>`;
const sel = (label, name, opts, v, cls = '') =>
  `<label class="f ${cls}"><span>${esc(label)}</span><select name="${name}">${opts.map(([val, txt]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select></label>`;
const chk = (label, name, v) => `<label class="f chk"><input type="checkbox" name="${name}" ${v ? 'checked' : ''}> <span>${esc(label)}</span></label>`;
function formData(form) {
  const d = {};
  new FormData(form).forEach((v, k) => { d[k] = v; });
  form.querySelectorAll('input[type=checkbox]').forEach((c) => { d[c.name] = c.checked; });
  return d;
}

// ───────────── Connexion ─────────────
function showLogin(needsAdmin, msg) {
  $('#root').innerHTML = `<div class="login"><form id="lf" class="card" autocomplete="off">
    <h1>PaieGestion</h1>
    <p>${needsAdmin ? 'Première utilisation : créez le compte administrateur.' : 'Gestion de la paie — Sénégal. Connectez-vous pour continuer.'}</p>
    ${needsAdmin ? inp('Nom complet', 'nom', '', 'text', 'required') : ''}
    ${inp('Identifiant', 'login', '', 'text', 'required autofocus')}
    ${inp('Mot de passe', 'password', '', 'password', 'required')}
    ${needsAdmin ? inp('Confirmer le mot de passe', 'password2', '', 'password', 'required') + '<p style="font-size:12px;margin:0">8 caractères minimum.</p>' : ''}
    <div id="lmsg">${msg ? `<div class="msg">${esc(msg)}</div>` : ''}</div>
    <div class="row"><button class="p" type="submit">${needsAdmin ? 'Créer le compte et entrer' : 'Se connecter'}</button></div>
    ${state.info ? `<p style="margin:14px 0 0;font-size:11px">Base : ${esc(state.info.database)} sur ${esc(state.info.server)}</p>` : ''}
  </form></div>`;
  $('#lf').onsubmit = async (ev) => {
    ev.preventDefault();
    const d = formData(ev.target);
    const err = (t) => { $('#lmsg').innerHTML = `<div class="msg">${esc(t)}</div>`; };
    const btn = $('button[type=submit]', ev.target); btn.disabled = true;
    try {
      if (needsAdmin) {
        if (d.password !== d.password2) throw new Error('Les deux mots de passe ne correspondent pas.');
        await api('auth:createAdmin', { Login: d.login, NomComplet: d.nom, Password: d.password });
      }
      state.user = await api('auth:login', { login: d.login, password: d.password });
      showApp();
    } catch (e) { err(e.message); btn.disabled = false; }
  };
}

// ───────────── Structure principale ─────────────
const PAGES = [['employes', 'Employés'], ['rubriques', 'Rubriques de paie'], ['paie', 'Paie mensuelle'], ['conges', 'Congés & absences'], ['compta', 'Comptabilité'], ['declarations', 'Déclarations'], ['rapports', 'Rapports'], ['params', 'Paramètres']];
function showApp() {
  $('#root').innerHTML = `<div class="shell">
    <aside><div class="logo">PaieGestion<small>Sénégal</small></div>
      ${PAGES.map(([id, t]) => `<button class="nav" data-page="${id}">${t}</button>`).join('')}
      <div class="foot">Base : ${esc(state.info.database)}<br>${esc(state.info.server)}<br>v${esc(state.info.version)}</div></aside>
    <div class="content"><header class="top"><span class="sp"></span>
      <span class="who">${esc(state.user.nom)} <span class="badge">${esc(ROLE_LABEL[state.user.role] || state.user.role)}</span></span>
      <button id="logout" class="s">Déconnexion</button></header>
      <main id="page"></main></div></div>`;
  document.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => go(b.dataset.page); });
  $('#logout').onclick = guard(async () => { await api('auth:logout'); state.user = null; showLogin(false); });
  go(state.page);
}
function go(page) {
  state.page = page;
  document.querySelectorAll('[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  $('#page').innerHTML = '<p class="muted">Chargement…</p>';
  const fn = { employes: pageEmployes, rubriques: pageRubriques, paie: pagePaie, conges: pageConges, compta: pageCompta, declarations: pageDeclarations, rapports: pageRapports, params: pageParams }[page];
  guard(fn)();
}

// ───────────── Employés ─────────────
async function pageEmployes() {
  const rows = await api('emp:list');
  $('#page').innerHTML = `<div class="bar"><h2>Employés <span class="muted">(${rows.length})</span></h2>
    <input id="q" type="search" placeholder="Rechercher un nom, un matricule…"><span class="sp"></span>
    ${can('write') ? '<button class="p" id="add">+ Nouvel employé</button>' : ''}</div>
    <div class="tw"><table><thead><tr><th>Matricule</th><th>Nom</th><th>Prénom</th><th>Poste</th><th>Catégorie</th><th>Statut</th><th class="n">Parts</th><th>Embauche</th><th class="n">Salaire de base</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase();
    const list = rows.filter((r) => `${r.Matricule} ${r.Nom} ${r.Prenom} ${r.Poste || ''}`.toLowerCase().includes(q));
    $('#tb').innerHTML = list.map((r) => `<tr class="click" data-id="${r.Id}"><td>${esc(r.Matricule)}</td><td><b>${esc(r.Nom)}</b></td><td>${esc(r.Prenom)}</td>
      <td>${esc(r.Poste || '')}</td><td>${esc(r.Categorie || '')}${r.Echelon ? ' / ' + esc(r.Echelon) : ''}</td><td>${r.EstCadre ? 'Cadre' : 'Non-cadre'}</td><td class="n">${esc(String(r.NombreParts).replace('.', ','))}</td>
      <td>${fmtDate(r.DateEmbauche)}</td><td class="n">${fmt(r.SalaireBase)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Aucun employé. Cliquez sur « Nouvel employé » pour commencer.</td></tr>';
    document.querySelectorAll('#tb tr[data-id]').forEach((tr) => { tr.onclick = () => guard(openEmploye)(Number(tr.dataset.id)); });
  };
  $('#q').oninput = draw; draw();
  if ($('#add')) $('#add').onclick = () => guard(openEmploye)(null);
}

async function openEmploye(id) {
  const [rubs, emp, cats] = await Promise.all([api('rub:list'), id ? api('emp:get', id) : null, api('cat:list')]);
  const e = emp || { Matricule: '', Nom: '', Prenom: '', Sexe: '', SituationFamiliale: 'C', NombreEnfants: 0, NombreParts: 1, EstCadre: false, ModePaiement: 'VIREMENT', TypeContrat: 'CDI', SalaireBase: '', DateEmbauche: today(), primes: [] };
  const ro = !can('write');
  let primes = (e.primes || []).map((p) => ({
    Id: p.Id || null, RubriqueId: p.RubriqueId, Libelle: p.Libelle, Type: p.Type || 'GAIN', ModeCalcul: p.ModeCalcul || 'FIXE',
    Montant: p.Montant != null ? Number(p.Montant) : null, Taux: p.Taux != null ? Number(p.Taux) : null,
    DateDebut: p.DateDebut || e.DateEmbauche || today(), DateFin: p.DateFin || '',
  }));
  const body = `<form id="ef"><fieldset ${ro ? 'disabled' : ''}>
    <div class="grid">
      ${inp('Matricule *', 'Matricule', e.Matricule, 'text', 'required maxlength="20"')}
      ${inp('Nom *', 'Nom', e.Nom, 'text', 'required')}${inp('Prénom *', 'Prenom', e.Prenom, 'text', 'required')}
      ${sel('Sexe', 'Sexe', [['', '—'], ['M', 'Masculin'], ['F', 'Féminin']], e.Sexe || '')}
      ${inp('Date de naissance', 'DateNaissance', e.DateNaissance || '', 'date')}${inp('N° CNI', 'NumeroCNI', e.NumeroCNI || '')}
      ${inp('Téléphone', 'Telephone', e.Telephone || '')}${inp('Adresse', 'Adresse', e.Adresse || '', 'text', '', 'span2')}
      ${sel('Situation familiale', 'SituationFamiliale', [['C', 'Célibataire'], ['M', 'Marié(e)'], ['D', 'Divorcé(e)'], ['V', 'Veuf/Veuve']], e.SituationFamiliale)}
      ${inp("Nombre d'enfants", 'NombreEnfants', e.NombreEnfants, 'number', 'min="0" max="20"')}
      ${inp('Nombre de parts (IR) — calculé, modifiable', 'NombreParts', e.NombreParts, 'number', 'min="1" max="5" step="0.5"')}
      ${chk('Conjoint(e) qui travaille', 'ConjointTravaille', e.ConjointTravaille)}
      ${chk('Cadre (IPRES complémentaire)', 'EstCadre', e.EstCadre)}${inp('N° IPRES', 'NumeroIPRES', e.NumeroIPRES || '')}${inp('N° CSS', 'NumeroCSS', e.NumeroCSS || '')}
      ${inp('Service / Département', 'Departement', e.Departement || '')}${inp('Poste', 'Poste', e.Poste || '')}
      ${inp("Date d'embauche *", 'DateEmbauche', e.DateEmbauche || '', 'date', 'required')}
      ${inp('Date de sortie', 'DateSortie', e.DateSortie || '', 'date')}
      ${sel('Catégorie professionnelle', 'Categorie', [['', '—']].concat(cats.categories.filter((c) => c.Actif || c.Code === e.Categorie).map((c) => [c.Code, `${c.Code} — ${c.Libelle}`])), e.Categorie || '')}
      ${sel('Classe professionnelle', 'Echelon', [['', '—']].concat(cats.classes.filter((c) => c.Actif || c.Code === e.Echelon).map((c) => [c.Code, `${c.Code} — ${c.Libelle}`])), e.Echelon || '')}
      ${sel('Type de contrat', 'TypeContrat', [['CDI', 'CDI'], ['CDD', 'CDD'], ['STAGE', 'Stage'], ['JOURNALIER', 'Journalier'], ['CONSULTANT', 'Consultant']], e.TypeContrat)}
      ${inp('Salaire de base (FCFA) *', 'SalaireBase', e.SalaireBase, 'number', 'required min="1" step="1"')}
      ${sel('Mode de paiement', 'ModePaiement', [['VIREMENT', 'Virement'], ['ESPECES', 'Espèces'], ['CHEQUE', 'Chèque'], ['MOBILE', 'Mobile money']], e.ModePaiement)}
      ${inp('Banque', 'Banque', e.Banque || '')}${inp('N° de compte', 'NumeroCompte', e.NumeroCompte || '')}
    </div>
    <h4>Rubriques affectées (catalogue)</h4>
    <p class="muted" style="margin:0 0 8px;font-size:12px">Sélectionnez les rubriques du catalogue actives pour cet employé. L'historique et la gestion complète se trouvent dans « Rubriques de paie » (les prêts échelonnés s'y saisissent : montant + durée).</p>
    <div id="primes"></div>
    ${ro ? '' : `<div class="inline" style="margin-top:8px">
      ${sel('Rubrique du catalogue', 'pr_rub', rubs.filter((r) => !r.Echelonne).map((r) => [r.Id, `${r.Libelle} (${r.ModeCalcul === 'POURCENTAGE' ? '% base' : r.Type === 'RETENUE' ? 'retenue' : 'fixe'})`]), '')}
      ${inp('Montant (FCFA)', 'pr_mt', '', 'number', 'min="0.01" step="any"')}
      ${inp('Début', 'pr_deb', e.DateEmbauche || today(), 'date')}
      ${inp('Fin (facultatif)', 'pr_fin', '', 'date')}
      <button type="button" id="pr_add">Ajouter</button></div>`}
  </fieldset></form>`;

  const drawPrimes = (root) => {
    $('#primes', root).innerHTML = primes.length
      ? `<table class="mini"><thead><tr><th>Rubrique</th><th class="n">Valeur</th><th>Période</th><th></th></tr></thead><tbody>${primes.map((p, i) => `<tr>
          <td>${esc(p.Libelle)} ${p.Type === 'RETENUE' ? '<span class="badge warn">Retenue</span>' : ''}</td>
          <td class="n">${p.ModeCalcul === 'POURCENTAGE' ? esc(String(p.Taux).replace('.', ',')) + ' %' : fmt(p.Montant) + ' FCFA'}</td>
          <td class="muted">${fmtDate(p.DateDebut)}${p.DateFin ? ' → ' + fmtDate(p.DateFin) : ' → en cours'}</td>
          <td class="n">${ro ? '' : `<button type="button" class="s d" data-rm="${i}">Retirer</button>`}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted" style="margin:0">Aucune rubrique affectée.</p>';
    root.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { primes.splice(Number(b.dataset.rm), 1); drawPrimes(root); }; });
  };
  const buttons = [cancelBtn];
  if (id && !ro) buttons.unshift({ label: "Désactiver l'employé", cls: 'd', onClick: async () => {
    if (!(await confirmBox(`Désactiver ${e.Nom} ${e.Prenom} ? Il n'apparaîtra plus dans les prochains calculs de paie.`, 'Désactiver', 'd'))) return false;
    await api('emp:deactivate', id); toast('Employé désactivé.'); pageEmployes(); return true;
  } });
  if (!ro) buttons.push({ label: 'Enregistrer', cls: 'p', onClick: async () => {
    const form = $('#ef');
    if (!form.reportValidity()) return false;
    const d = formData(form);
    d.Id = id; d.primes = primes;
    const r = await api('emp:save', d); toast('Employé enregistré.'); if (r && r.avertissement) toast(r.avertissement, 'warn'); pageEmployes(); return true;
  } });
  openModal({ title: id ? `${e.Nom} ${e.Prenom}` : 'Nouvel employé', body, wide: true, buttons, onOpen: (root) => {
    drawPrimes(root);
    const form = $('#ef', root);
    const recalcParts = guard(async () => {
      const d = formData(form);
      form.NombreParts.value = await api('emp:parts', { situation: d.SituationFamiliale, enfants: Number(d.NombreEnfants), conjointTravaille: d.ConjointTravaille });
    });
    ['SituationFamiliale', 'NombreEnfants', 'ConjointTravaille'].forEach((n) => form[n].addEventListener('change', recalcParts));
    const rubSel = $('[name=pr_rub]', root);
    const mtLbl = $('[name=pr_mt]', root) && $('[name=pr_mt]', root).previousElementSibling;
    const syncRubLabel = () => {
      if (!rubSel || !mtLbl) return;
      const r = rubs.find((x) => String(x.Id) === rubSel.value);
      mtLbl.textContent = r && r.ModeCalcul === 'POURCENTAGE' ? 'Taux (% du salaire de base)' : 'Montant (FCFA)';
    };
    if (rubSel) { rubSel.addEventListener('change', syncRubLabel); syncRubLabel(); }
    if ($('#pr_add', root)) $('#pr_add', root).onclick = () => {
      const rid = Number($('[name=pr_rub]', root).value); const val = Number($('[name=pr_mt]', root).value);
      const deb = $('[name=pr_deb]', root).value || form.DateEmbauche.value || today();
      const fin = $('[name=pr_fin]', root).value || '';
      const r = rubs.find((x) => x.Id === rid);
      if (!r || !(val > 0)) return toast('Choisissez une rubrique et une valeur positive.', 'warn');
      if (r.ModeCalcul === 'POURCENTAGE' && val > 100) return toast('Le taux doit être compris entre 0 et 100 %.', 'warn');
      if (fin && fin < deb) return toast('La date de fin doit être postérieure ou égale au début.', 'warn');
      primes = primes.filter((p) => p.RubriqueId !== rid).concat([{
        Id: null, RubriqueId: rid, Libelle: r.Libelle, Type: r.Type, ModeCalcul: r.ModeCalcul,
        Montant: r.ModeCalcul === 'POURCENTAGE' ? null : val, Taux: r.ModeCalcul === 'POURCENTAGE' ? val : null,
        DateDebut: deb, DateFin: fin,
      }]);
      $('[name=pr_mt]', root).value = ''; $('[name=pr_fin]', root).value = ''; drawPrimes(root);
    };
  } });
}

// ───────────── Paie mensuelle ─────────────
async function pagePaie() {
  const yearOpts = [state.annee - 1, state.annee, state.annee + 1];
  $('#page').innerHTML = `<div class="bar"><h2>Paie mensuelle</h2>
    <select id="mois">${MOIS.map((m, i) => `<option value="${i + 1}" ${i + 1 === state.mois ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <input id="annee" type="number" value="${state.annee}" min="2000" max="2100"><span id="statut"></span><span class="sp"></span>
    ${can('paie') ? '<button id="vars">Variables du mois</button><button class="p" id="calc">Calculer la paie</button><button id="close" class="d">Clôturer</button>' : '<button id="vars">Variables du mois</button>'}
    ${can('export') ? '<button id="pdf">Bulletins PDF</button><button id="csv">Journal CSV</button>' : ''}</div>
    <div class="tw"><table><thead><tr><th>Matricule</th><th>Nom</th><th>Prénom</th><th class="n">Brut</th><th class="n">Cotis. sal.</th><th class="n">IR</th><th class="n">TRIMF</th><th class="n">Autres ret.</th><th class="n">Net à payer</th><th class="n">Charges pat.</th><th class="n">Coût employeur</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  void yearOpts;
  $('#mois').onchange = () => { state.mois = Number($('#mois').value); guard(loadPaie)(); };
  $('#annee').onchange = () => { state.annee = Number($('#annee').value) || state.annee; guard(loadPaie)(); };
  if ($('#calc')) $('#calc').onclick = guard(async () => {
    const btn = $('#calc'); btn.disabled = true; btn.textContent = 'Calcul…';
    try {
      const per = await api('per:open', state.annee, state.mois);
      const r = await api('paie:calculer', per.Id);
      toast(`${r.count} bulletin(s) calculé(s).`);
      if (r.nonVerifies > 0) toast(`Attention : ${r.nonVerifies} paramètre(s) légal(aux) non vérifié(s). Contrôlez-les dans Paramètres avant d'utiliser ces bulletins.`, 'warn');
    } finally { btn.disabled = false; btn.textContent = 'Calculer la paie'; }
    await loadPaie();
  });
  if ($('#close')) $('#close').onclick = guard(async () => {
    if (!state.periode) return toast("Rien à clôturer : calculez d'abord la paie.", 'warn');
    if (!(await confirmBox(`Clôturer ${MOIS[state.mois - 1]} ${state.annee} ? Les bulletins ne pourront plus être recalculés.`, 'Clôturer', 'd'))) return;
    await api('per:close', state.periode.Id); toast('Période clôturée.'); await loadPaie();
  });
  $('#vars').onclick = guard(openVariables);
  if ($('#pdf')) $('#pdf').onclick = guard(async () => { if (!state.periode) return toast("Calculez d'abord la paie.", 'warn'); const r = await api('paie:pdf', state.periode.Id); if (r.saved) toast('PDF enregistré.'); });
  if ($('#csv')) $('#csv').onclick = guard(async () => { if (!state.periode) return toast("Calculez d'abord la paie.", 'warn'); const r = await api('paie:csv', state.periode.Id); if (r.saved) toast('Fichier CSV enregistré.'); });
  await loadPaie();
}

async function loadPaie() {
  state.periode = await api('per:get', state.annee, state.mois);
  const rows = state.periode ? await api('paie:journal', state.periode.Id) : [];
  $('#statut').innerHTML = !state.periode ? '<span class="badge">Période non ouverte</span>'
    : state.periode.Cloturee ? '<span class="badge ok">Clôturée</span>' : `<span class="badge warn">Ouverte — ${rows.length} bulletin(s)</span>`;
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
  $('#tb').innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${esc(r.Matricule)}</td><td><b>${esc(r.Nom)}</b></td><td>${esc(r.Prenom)}</td><td class="n">${fmt(r.Brut)}</td><td class="n">${fmt(r.TotalCotisSalariales)}</td>
        <td class="n">${fmt(r.ImpotRevenu)}</td><td class="n">${fmt(r.TRIMF)}</td><td class="n">${fmt(r.AutresRetenues)}</td><td class="n"><b>${fmt(r.Net)}</b></td>
        <td class="n">${fmt(r.TotalCotisPatronales)}</td><td class="n">${fmt(r.CoutEmployeur)}</td>
        <td class="n"><button class="s" data-det="${r.Id}">Détail</button> ${can('export') ? `<button class="s" data-pdf="${r.Id}">PDF</button>` : ''}</td></tr>`).join('')
      + `<tr class="tot"><td colspan="3">Total (${rows.length})</td><td class="n">${fmt(sum('Brut'))}</td><td class="n">${fmt(sum('TotalCotisSalariales'))}</td><td class="n">${fmt(sum('ImpotRevenu'))}</td><td class="n">${fmt(sum('TRIMF'))}</td><td class="n">${fmt(sum('AutresRetenues'))}</td><td class="n">${fmt(sum('Net'))}</td><td class="n">${fmt(sum('TotalCotisPatronales'))}</td><td class="n">${fmt(sum('CoutEmployeur'))}</td><td></td></tr>`
    : `<tr><td colspan="12" class="empty">Aucun bulletin pour ${MOIS[state.mois - 1]} ${state.annee}.${can('paie') ? ' Cliquez sur « Calculer la paie ».' : ''}</td></tr>`;
  document.querySelectorAll('[data-det]').forEach((b) => { b.onclick = guard(() => openDetail(Number(b.dataset.det))); });
  document.querySelectorAll('[data-pdf]').forEach((b) => { b.onclick = guard(async () => { const r = await api('paie:pdf', state.periode.Id, Number(b.dataset.pdf)); if (r.saved) toast('PDF enregistré.'); }); });
}

async function openDetail(bulletinId) {
  const b = await api('paie:detail', state.periode.Id, bulletinId);
  if (!b) throw new Error('Bulletin introuvable.');
  const part = (title, key, cls) => {
    const ls = b.lignes.filter((l) => (key === 'MontantGain' ? Number(l[key]) !== 0 : Number(l[key]) > 0));
    return `<h4>${title}</h4><table class="mini"><tbody>${ls.map((l) => `<tr><td>${esc(l.Libelle)}</td><td class="n muted">${l.Base != null ? fmt(l.Base) : ''}</td><td class="n muted">${l.Taux != null ? esc(String(Number(l.Taux)).replace('.', ',')) + (l.TauxEnJours ? ' j' : ' %') : ''}</td><td class="n ${cls}">${fmt(l[key])}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table>`;
  };
  openModal({ title: `${b.Nom} ${b.Prenom} — ${MOIS[state.mois - 1]} ${state.annee}`, wide: true, buttons: [cancelBtn],
    body: `${part('Gains', 'MontantGain', '')}<p style="text-align:right;margin:4px 0"><b>Brut : ${fmt(b.Brut)} FCFA</b></p>${part('Retenues', 'MontantRetenue', '')}
      <p style="text-align:right;margin:4px 0">Total retenues : ${fmt(Number(b.TotalCotisSalariales) + Number(b.ImpotRevenu) + Number(b.TRIMF) + Number(b.AutresRetenues))} FCFA</p>
      <p style="text-align:right;font-size:17px;margin:10px 0"><b>Net à payer : ${fmt(b.Net)} FCFA</b></p>${part('Charges patronales', 'MontantPatronal', '')}
      <p style="text-align:right;margin:4px 0">Coût total employeur : <b>${fmt(b.CoutEmployeur)} FCFA</b></p>` });
}

async function openVariables() {
  let per = state.periode;
  if (!per) { if (!can('paie')) return toast("Aucune période ouverte pour ce mois.", 'warn'); per = state.periode = await api('per:open', state.annee, state.mois); }
  const editable = can('paie') && !per.Cloturee;
  const [emps, rubs] = editable ? await Promise.all([api('emp:list'), api('rub:list')]) : [[], []];
  const body = `<p class="muted" style="margin-top:0">Éléments propres à ${MOIS[state.mois - 1]} ${state.annee} : heures supplémentaires, primes exceptionnelles (gains) ou absences, acomptes (retenues). Après toute modification, relancez « Calculer la paie ».</p>
    <h4>Jours travaillés</h4><p class="muted" style="margin-top:0">Pour un employé qui n'a pas travaillé tout le mois, indiquez ses jours travaillés : les rubriques proratisées sont multipliées par jours / 26. Sans saisie, le mois est complet.</p>
    <div id="pl"></div>
    ${editable ? `<div class="inline">${sel('Employé', 'p_emp', emps.map((e) => [e.Id, `${e.Nom} ${e.Prenom}`]), '')}${inp('Jours travaillés (0 à 31)', 'p_j', '', 'number', 'min="0" max="31" step="0.5"')}<button type="button" class="p" id="p_add">Enregistrer</button></div>` : ''}
    <h4>Variables</h4>
    <div id="vl"></div>
    ${editable ? `<h4>Ajouter</h4><div class="inline">${sel('Employé', 'v_emp', emps.map((e) => [e.Id, `${e.Nom} ${e.Prenom}`]), '')}${sel('Rubrique', 'v_rub', rubs.map((r) => [r.Id, `${r.Libelle} (${r.Type === 'GAIN' ? 'gain' : 'retenue'})`]), '')}${inp('Montant (FCFA)', 'v_mt', '', 'number', 'min="1"')}${inp('Commentaire', 'v_com', '')}<button type="button" class="p" id="v_add">Ajouter</button></div>` : (per.Cloturee ? '<p class="muted">Période clôturée : lecture seule.</p>' : '')}`;
  const drawPres = async (root) => {
    const lp = await api('pres:list', per.Id);
    $('#pl', root).innerHTML = lp.length
      ? `<table class="mini"><thead><tr><th>Employé</th><th class="n">Jours travaillés</th><th></th></tr></thead><tbody>${lp.map((x) => `<tr><td>${esc(x.Nom)} ${esc(x.Prenom)}</td><td class="n">${fmt(x.JoursTravailles)}</td><td class="n">${editable ? `<button class="s d" data-delp="${x.EmployeId}">Supprimer</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Aucune saisie : tous les employés sont comptés sur un mois complet.</p>';
    root.querySelectorAll('[data-delp]').forEach((b) => { b.onclick = guard(async () => { await api('pres:delete', Number(b.dataset.delp), per.Id); await drawPres(root); }); });
  };
  const draw = async (root) => {
    const list = await api('var:list', per.Id);
    $('#vl', root).innerHTML = list.length
      ? `<table class="mini"><thead><tr><th>Employé</th><th>Rubrique</th><th class="n">Montant</th><th>Commentaire</th><th></th></tr></thead><tbody>${list.map((v) => `<tr><td>${esc(v.Nom)} ${esc(v.Prenom)}</td><td>${esc(v.Rubrique)}</td><td class="n">${fmt(v.Montant)}</td><td>${esc(v.Commentaire || '')}</td><td class="n">${editable ? `<button class="s d" data-del="${v.Id}">Supprimer</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Aucune variable saisie pour ce mois.</p>';
    root.querySelectorAll('[data-del]').forEach((b) => { b.onclick = guard(async () => { await api('var:delete', Number(b.dataset.del), per.Id); await draw(root); }); });
  };
  openModal({ title: 'Variables du mois', wide: true, body, buttons: [cancelBtn], onOpen: (root) => {
    guard(draw)(root); guard(drawPres)(root);
    const addP = $('#p_add', root);
    if (addP) addP.onclick = guard(async () => {
      await api('pres:save', { PeriodeId: per.Id, EmployeId: Number($('[name=p_emp]', root).value), JoursTravailles: Number($('[name=p_j]', root).value) });
      $('[name=p_j]', root).value = ''; await drawPres(root);
    });
    const add = $('#v_add', root);
    if (add) add.onclick = guard(async () => {
      await api('var:save', { PeriodeId: per.Id, EmployeId: Number($('[name=v_emp]', root).value), RubriqueId: Number($('[name=v_rub]', root).value), Montant: Number($('[name=v_mt]', root).value), Commentaire: $('[name=v_com]', root).value });
      $('[name=v_mt]', root).value = ''; $('[name=v_com]', root).value = ''; await draw(root);
    });
  } });
}

// ───────────── Paramètres ─────────────
const KINDS = {
  param: { title: 'Paramètres légaux', cols: [['Code', 'Code'], ['Libelle', 'Libellé'], ['Valeur', 'Valeur', 'n'], ['DateDebut', 'Début', 'd'], ['DateFin', 'Fin', 'd'], ['Source', 'Source'], ['Verifie', 'Vérifié', 'b']],
    fields: [['Code', 'Code', 'text'], ['Libelle', 'Libellé', 'text'], ['Valeur', 'Valeur', 'number'], ['DateDebut', 'Date de début', 'date'], ['DateFin', 'Date de fin (vide = en vigueur)', 'date'], ['Source', 'Source (texte, lien officiel…)', 'text'], ['Verifie', 'Valeur vérifiée auprès de la source officielle', 'check']] },
  ir: { title: "Barème de l'impôt sur le revenu (annuel)", cols: [['TrancheMin', 'De', 'n'], ['TrancheMax', 'À', 'n'], ['Taux', 'Taux %', 'n'], ['DateDebut', 'Début', 'd'], ['DateFin', 'Fin', 'd'], ['Verifie', 'Vérifié', 'b']],
    fields: [['TrancheMin', 'Tranche : de (FCFA / an)', 'number'], ['TrancheMax', 'Tranche : à (vide = sans limite)', 'number'], ['Taux', 'Taux (%)', 'number'], ['DateDebut', 'Date de début', 'date'], ['DateFin', 'Date de fin', 'date'], ['Verifie', 'Barème vérifié auprès de la source officielle', 'check']] },
  trimf: { title: 'Barème TRIMF (revenu annuel)', cols: [['SalaireMin', 'Revenu annuel de', 'n'], ['SalaireMax', 'à', 'n'], ['Montant', 'TRIMF annuelle', 'n'], ['DateDebut', 'Début', 'd'], ['DateFin', 'Fin', 'd'], ['Verifie', 'Vérifié', 'b']],
    fields: [['SalaireMin', 'Revenu annuel : de (FCFA)', 'number'], ['SalaireMax', 'Revenu annuel : à (vide = sans limite)', 'number'], ['Montant', 'TRIMF annuelle (FCFA, retenue par 12e chaque mois)', 'number'], ['DateDebut', 'Date de début', 'date'], ['DateFin', 'Date de fin', 'date'], ['Verifie', 'Barème vérifié auprès de la source officielle', 'check']] },
};
const TABS = [['param', 'Paramètres légaux'], ['ir', 'Barème IR'], ['trimf', 'Barème TRIMF'], ['cat', 'Catégories'], ['classe', 'Classes professionnelles'], ['ent', 'Entreprise'], ['users', 'Utilisateurs']];

async function pageParams() {
  const tabs = TABS.filter(([id]) => id !== 'users' || can('admin'));
  if (!tabs.some(([id]) => id === state.paramTab)) state.paramTab = 'param';
  $('#page').innerHTML = `<div class="tabs">${tabs.map(([id, t]) => `<button data-tab="${id}" class="${state.paramTab === id ? 'on' : ''}">${t}</button>`).join('')}</div><div id="tabc"></div>`;
  document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { state.paramTab = b.dataset.tab; pageParams(); }; });
  if (KINDS[state.paramTab]) await tabKind(state.paramTab);
  else if (state.paramTab === 'cat' || state.paramTab === 'classe') await tabCategories(state.paramTab);
  else if (state.paramTab === 'ent') await tabEntreprise();
  else await tabUsers();
}

async function tabKind(kind) {
  const def = KINDS[kind];
  const all = await api('params:list');
  const rows = all[kind];
  const cellVal = (r, [k, , t]) => (t === 'n' ? fmt(r[k]) === '' ? '' : (kind !== 'param' || k !== 'Valeur' ? fmt(r[k]) : String(Number(r[k]))) : t === 'd' ? fmtDate(r[k]) : t === 'b' ? (r[k] ? '<span class="badge ok">Oui</span>' : '<span class="badge warn">Non</span>') : esc(r[k] == null ? '' : r[k]));
  const unverified = rows.filter((r) => !r.Verifie && !r.DateFin).length;
  $('#tabc').innerHTML = `${unverified ? `<div class="banner"><b>${unverified} valeur(s) en vigueur non vérifiée(s).</b> Ces valeurs ont été saisies à titre indicatif : contrôlez-les auprès de la DGID, de l'IPRES et de la CSS, puis cochez « vérifié ».</div>` : ''}
    <div class="bar"><h2>${def.title}</h2><span class="sp"></span>${can('admin') ? '<button class="p" id="addk">+ Ajouter</button>' : ''}</div>
    <div class="tw"><table><thead><tr>${def.cols.map(([, t, ty]) => `<th class="${ty === 'n' ? 'n' : ''}">${t}</th>`).join('')}<th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>${def.cols.map((c) => `<td class="${c[2] === 'n' ? 'n' : ''}">${cellVal(r, c)}</td>`).join('')}<td class="n">${can('admin') ? `<button class="s" data-ed="${r.Id}">Modifier</button> <button class="s d" data-rm="${r.Id}">Supprimer</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${def.cols.length + 1}" class="empty">Aucune ligne.</td></tr>`}</tbody></table></div>`;
  const edit = (r) => {
    const v = r || {};
    openModal({ title: r ? 'Modifier' : 'Ajouter', body: `<form id="kf"><div class="grid two">${def.fields.map(([n, l, t]) => (t === 'check' ? chk(l, n, v[n]) : inp(l, n, v[n] == null ? '' : v[n], t, t === 'number' ? 'step="any"' : ''))).join('')}</div></form>`,
      buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { const d = formData($('#kf')); d.Id = r ? r.Id : null; await api('params:save', kind, d); toast('Enregistré.'); pageParams(); return true; } }] });
  };
  if ($('#addk')) $('#addk').onclick = () => edit(null);
  document.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => edit(rows.find((r) => r.Id === Number(b.dataset.ed))); });
  document.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = guard(async () => {
    if (!(await confirmBox('Supprimer cette ligne ?', 'Supprimer', 'd'))) return;
    await api('params:delete', kind, Number(b.dataset.rm)); pageParams();
  }); });
}

const TYPE_RUB = { GAIN: 'Gain', RETENUE: 'Retenue', COTIS_SAL: 'Cotisation salariale', COTIS_PAT: 'Cotisation patronale', IMPOT: 'Impôt' };
const MODE_RUB = { FIXE: 'Montant fixe', POURCENTAGE: '% salaire de base', VARIABLE: 'Variable mensuelle', AUTO: 'Automatique' };

// ───────────── Rubriques de paie (module autonome) ─────────────
async function pageRubriques() {
  const tabs = [['catalogue', 'Catalogue des rubriques'], ['affectations', 'Affectations aux employés']];
  $('#page').innerHTML = `<div class="tabs">${tabs.map(([id, t]) => `<button data-rubtab="${id}" class="${state.rubTab === id ? 'on' : ''}">${t}</button>`).join('')}</div><div id="tabc"></div>`;
  document.querySelectorAll('[data-rubtab]').forEach((b) => { b.onclick = () => { state.rubTab = b.dataset.rubtab; guard(pageRubriques)(); }; });
  if (state.rubTab === 'affectations') await tabRubriquesAffectations();
  else await tabRubriquesCatalogue();
}

async function tabRubriquesCatalogue() {
  const [rows, plan] = await Promise.all([api('rub:all'), api('compta:plan')]);
  const yes = (v) => (v ? '<span class="badge ok">Oui</span>' : '<span class="badge">Non</span>');
  const accounts = [['', '— par défaut —']].concat(plan.filter((c) => c.Actif).map((c) => [c.Compte, `${c.Compte} — ${c.Libelle}`]));

  $('#tabc').innerHTML = `<div class="banner" style="background:#E3F0FB;color:#12263F">Définissez ici le <b>catalogue des rubriques</b> (primes, indemnités, retenues) : mode de calcul, soumission indépendante à l'<b>IR</b>, aux <b>cotisations sociales</b> (IPRES/CSS/IPM) et à la <b>CFCE / TRIMF</b>, plafond d'exonération mensuel et compte comptable. Affectez-les ensuite aux employés dans l'onglet « Affectations aux employés » ou depuis leur fiche.</div>
    <div class="bar"><h2>Catalogue des rubriques</h2>
      <input id="rq" type="search" placeholder="Rechercher code ou libellé…" value="${esc(state.rubQ)}">
      <select id="rt"><option value="">Tous les types</option>${Object.entries(TYPE_RUB).map(([k, v]) => `<option value="${k}" ${state.rubType === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <span class="sp"></span>${can('admin') ? '<button class="p" id="addr">+ Nouvelle rubrique</button>' : ''}</div>
    <div class="tw"><table><thead><tr><th>Code</th><th>Libellé</th><th>Type</th><th>Mode</th><th>IR</th><th>Cotis.</th><th>CFCE/TRIMF</th><th class="n">Exo. max.</th><th>Compte</th><th class="n">Ordre</th><th>Statut</th><th></th></tr></thead><tbody id="rtb"></tbody></table></div>`;

  const draw = () => {
    const q = state.rubQ.toLowerCase();
    const list = rows.filter((r) => (!state.rubType || r.Type === state.rubType) && `${r.Code} ${r.Libelle} ${r.CompteComptable || ''}`.toLowerCase().includes(q));
    $('#rtb').innerHTML = list.map((r) => {
      const g = r.Type === 'GAIN';
      const isSys = !!r.EstSysteme;
      return `<tr><td><b>${esc(r.Code)}</b>${isSys ? ' <span class="badge">Système</span>' : ''}</td><td>${esc(r.Libelle)}</td><td>${esc(TYPE_RUB[r.Type] || r.Type)}</td>
        <td>${esc(MODE_RUB[r.ModeCalcul] || r.ModeCalcul || 'Montant fixe')}${r.Type === 'RETENUE' ? `<br><span class="muted">${r.BaseRetenue === 'BRUT_IMPOSABLE' ? 'sur brut imposable' : 'sur net après impôt'}${r.Echelonne ? ' · prêt échelonné' : ''}</span>` : (g && r.ProrataJours ? '<br><span class="muted">au prorata des jours travaillés</span>' : '')}</td>
        <td>${g ? yes(r.Imposable) : '—'}</td><td>${g ? yes(r.SoumisCotisation) : '—'}</td><td>${g ? yes(r.SoumisCfceTrimf) : '—'}</td>
        <td class="n">${g && Number(r.PlafondExoneration) > 0 ? fmt(r.PlafondExoneration) : ''}</td>
        <td>${esc(r.CompteComptable || '')}</td><td class="n">${r.Ordre}</td>
        <td>${isSys ? '<span class="badge ok">Actif</span>' : (r.Actif ? '<span class="badge ok">Actif</span>' : '<span class="badge err">Inactif</span>')}</td>
        <td class="n">${can('admin') ? `<button class="s" data-er="${r.Id}">Modifier</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="12" class="empty">Aucune rubrique pour ces critères.</td></tr>';
    document.querySelectorAll('[data-er]').forEach((bt) => { bt.onclick = () => edit(rows.find((r) => r.Id === Number(bt.dataset.er))); });
  };

  const edit = (r) => {
    const v = r || { Type: 'GAIN', ModeCalcul: 'FIXE', BaseRetenue: 'NET_APRES_IMPOT', Echelonne: false, ProrataJours: true, Imposable: true, SoumisCotisation: true, SoumisCfceTrimf: true, Ordre: 100, CompteComptable: '', EstSysteme: false, Actif: true };
    const isSys = !!(r && v.EstSysteme);
    openModal({
      title: r ? `Rubrique ${v.Code}` : 'Nouvelle rubrique', wide: true,
      body: `<form id="rf"><div class="grid two">
        ${r ? `<label class="f"><span>Code</span><input value="${esc(v.Code)}" disabled></label>` : inp('Code * (ex. SURSALAIRE)', 'Code', '', 'text', 'required maxlength="30" style="text-transform:uppercase"')}
        ${inp('Libellé *', 'Libelle', v.Libelle || '', 'text', 'required maxlength="100"')}
        ${r ? `<label class="f"><span>Type</span><input value="${esc(TYPE_RUB[v.Type] || v.Type)}" disabled></label>` : sel('Type', 'Type', [['GAIN', 'Gain (prime, indemnité…)'], ['RETENUE', 'Retenue (acompte, prêt…)']], v.Type)}
        ${isSys ? `<label class="f"><span>Mode de calcul</span><input value="${esc(MODE_RUB[v.ModeCalcul] || v.ModeCalcul)}" disabled></label>` : sel('Mode de calcul', 'ModeCalcul', [['FIXE', 'Montant fixe mensuel'], ['POURCENTAGE', 'Pourcentage du salaire de base'], ['VARIABLE', 'Variable (saisie mensuelle)']], v.ModeCalcul || 'FIXE')}
        ${sel('Compte comptable', 'CompteComptable', accounts, v.CompteComptable || '')}
        ${inp("Ordre d'affichage", 'Ordre', v.Ordre, 'number', 'min="0" max="9999"')}
        <div id="rgain" class="grid two span2" style="${v.Type === 'GAIN' && !isSys ? '' : 'display:none'}">
          ${chk("Soumise à l'IR (Imposable)", 'Imposable', v.Imposable)}
          ${chk('Soumise aux cotisations (IPRES / CSS / IPM)', 'SoumisCotisation', v.SoumisCotisation !== undefined ? v.SoumisCotisation : v.Imposable)}
          ${chk('Soumise à la CFCE et à la TRIMF', 'SoumisCfceTrimf', v.SoumisCfceTrimf !== undefined ? v.SoumisCfceTrimf : v.Imposable)}
          ${chk('Proratisée selon les jours travaillés (montant × jours travaillés / 26)', 'ProrataJours', v.ProrataJours)}
          ${inp("Plafond d'exonération mensuel (FCFA, vide = aucun)", 'PlafondExoneration', Number(v.PlafondExoneration) > 0 ? v.PlafondExoneration : '', 'number', 'min="0" step="1"')}
        </div>
        <div id="rret" class="grid two span2" style="${v.Type === 'RETENUE' && !isSys ? '' : 'display:none'}">
          ${sel('La retenue est appliquée sur…', 'BaseRetenue', [['NET_APRES_IMPOT', 'le net après impôt (déduite du net à payer)'], ['BRUT_IMPOSABLE', 'le brut imposable (réduit la base de calcul de l\'IR)']], v.BaseRetenue || 'NET_APRES_IMPOT')}
          ${chk('Remboursement échelonné (prêt) : montant total + durée en mois', 'Echelonne', v.Echelonne)}
        </div>
        ${!isSys && r ? chk('Rubrique active', 'Actif', v.Actif) : ''}
        ${isSys ? '<p class="muted span2">Rubrique système utilisée par le moteur de calcul : seuls le libellé, l\'ordre et le compte comptable sont modifiables.</p>' : ''}
      </div></form>`,
      buttons: [{ label: 'Annuler', onClick: () => true }, {
        label: 'Enregistrer', cls: 'p', onClick: async () => {
          const f = $('#rf'); if (!f.reportValidity()) return false;
          const d = formData(f); d.Id = r ? r.Id : null; if (!r) d.Actif = true;
          await api('rub:save', d); toast('Rubrique enregistrée.'); pageRubriques(); return true;
        },
      }],
      onOpen: (root) => {
        const typeSel = $('[name=Type]', root);
        if (typeSel) typeSel.addEventListener('change', () => { $('#rgain', root).style.display = typeSel.value === 'GAIN' ? '' : 'none'; $('#rret', root).style.display = typeSel.value === 'RETENUE' ? '' : 'none'; });
      },
    });
  };

  $('#rq').oninput = () => { state.rubQ = $('#rq').value; draw(); };
  $('#rt').onchange = () => { state.rubType = $('#rt').value; draw(); };
  if ($('#addr')) $('#addr').onclick = () => edit(null);
  draw();
}

async function tabRubriquesAffectations() {
  const [emps, rubs, rows] = await Promise.all([
    api('emp:list'),
    api('rub:list'),
    api('emprub:list', { employeId: state.rubEmp || null, rubriqueId: state.rubRub || null, actifOnly: state.rubActifOnly }),
  ]);
  const write = can('write');
  const tday = today();

  $('#tabc').innerHTML = `<div class="bar"><h2>Affectations aux employés</h2>
      <select id="re_f"><option value="">Tous les employés</option>${emps.map((e) => `<option value="${e.Id}" ${String(state.rubEmp) === String(e.Id) ? 'selected' : ''}>${esc(e.Nom)} ${esc(e.Prenom)} (${esc(e.Matricule)})</option>`).join('')}</select>
      <select id="rr_f"><option value="">Toutes les rubriques</option>${rubs.map((r) => `<option value="${r.Id}" ${String(state.rubRub) === String(r.Id) ? 'selected' : ''}>${esc(r.Libelle)} (${esc(r.Code)})</option>`).join('')}</select>
      <select id="ra_f"><option value="1" ${state.rubActifOnly ? 'selected' : ''}>Actives uniquement</option><option value="0" ${!state.rubActifOnly ? 'selected' : ''}>Tout l'historique</option></select>
      <span class="sp"></span>${write ? '<button class="p" id="addaff">+ Affecter une rubrique</button>' : ''}</div>
    <p class="muted" style="margin-top:0">Les affectations actives sur la période sont reprises automatiquement lors du calcul mensuel. Clôturez une affectation avec une date de fin pour conserver l'historique.</p>
    <div class="tw"><table><thead><tr><th>Employé</th><th>Rubrique</th><th>Mode</th><th class="n">Valeur</th><th>Du</th><th>Au</th><th>Commentaire</th><th></th></tr></thead><tbody>
      ${rows.map((r) => {
        const closed = r.DateFin && r.DateFin < tday;
        const val = r.MontantPret > 0 ? `${fmt(r.MontantPret)} FCFA sur ${r.DureeMois} mois<br><span class="muted">${fmt(r.Montant)} FCFA / mois</span>` : (r.ModeCalcul === 'POURCENTAGE' ? `${esc(String(r.Taux).replace('.', ','))} %` : `${fmt(r.Montant)} FCFA`);
        return `<tr><td><b>${esc(r.Nom)}</b> ${esc(r.Prenom)} <span class="muted">${esc(r.Matricule)}</span></td>
          <td>${esc(r.Rubrique)} <span class="muted">${esc(r.RubriqueCode)}</span>${r.Type === 'RETENUE' ? ' <span class="badge warn">Retenue</span>' : ''}</td>
          <td>${esc(MODE_RUB[r.ModeCalcul] || r.ModeCalcul)}</td>
          <td class="n"><b>${val}</b></td>
          <td>${fmtDate(r.DateDebut)}</td>
          <td>${r.DateFin ? `${fmtDate(r.DateFin)}${closed ? ' <span class="badge">Clôturée</span>' : ''}` : '<span class="badge ok">En cours</span>'}</td>
          <td class="muted">${esc(r.Commentaire || '')}</td>
          <td class="n">${write ? `<button class="s" data-eaf="${r.Id}">Modifier</button> ${!closed ? `<button class="s" data-caf="${r.Id}">Clôturer</button> ` : ''}<button class="s d" data-daf="${r.Id}">Supprimer</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="8" class="empty">Aucune affectation pour ces critères.</td></tr>'}</tbody></table></div>`;

  const openAff = (r) => {
    const v = r || { EmployeId: state.rubEmp || (emps[0] ? emps[0].Id : ''), RubriqueId: state.rubRub || (rubs[0] ? rubs[0].Id : ''), Montant: '', Taux: '', DateDebut: today(), DateFin: '', Commentaire: '' };
    openModal({
      title: r ? "Modifier l'affectation" : 'Affecter une rubrique à un employé', wide: true,
      body: `<form id="afff"><div class="grid two">
        ${sel('Employé *', 'EmployeId', emps.map((e) => [e.Id, `${e.Nom} ${e.Prenom} (${e.Matricule})`]), v.EmployeId)}
        ${sel('Rubrique *', 'RubriqueId', rubs.map((x) => [x.Id, `${x.Libelle} — ${MODE_RUB[x.ModeCalcul] || x.ModeCalcul}`]), v.RubriqueId)}
        <div id="aff_mt">${inp('Montant mensuel (FCFA) *', 'Montant', v.Montant != null ? v.Montant : '', 'number', 'min="1" step="1"')}</div>
        <div id="aff_pret" class="grid two span2" style="display:none">
          ${inp('Montant du prêt (FCFA) *', 'MontantPret', v.MontantPret != null ? v.MontantPret : '', 'number', 'min="1" step="1"')}
          ${inp('Durée de remboursement (mois) *', 'DureeMois', v.DureeMois != null ? v.DureeMois : '', 'number', 'min="1" max="120" step="1"')}
          <p class="muted span2" id="aff_pret_info" style="margin:0"></p>
        </div>
        <div id="aff_tx">${inp('Taux (% du salaire de base) *', 'Taux', v.Taux != null ? v.Taux : '', 'number', 'min="0.01" max="100" step="0.01"')}</div>
        ${inp('Date de début *', 'DateDebut', v.DateDebut, 'date', 'required')}
        ${inp('Date de fin (vide = en cours)', 'DateFin', v.DateFin || '', 'date')}
        ${inp('Commentaire', 'Commentaire', v.Commentaire || '', 'text', 'maxlength="200"', 'span2')}
      </div></form>`,
      buttons: [{ label: 'Annuler', onClick: () => true }, {
        label: 'Enregistrer', cls: 'p', onClick: async () => {
          const f = $('#afff'); if (!f.reportValidity()) return false;
          const d = formData(f); d.Id = r ? r.Id : null;
          await api('emprub:save', d); toast('Affectation enregistrée.'); tabRubriquesAffectations(); return true;
        },
      }],
      onOpen: (root) => {
        const sync = () => {
          const cur = rubs.find((x) => String(x.Id) === $('[name=RubriqueId]', root).value);
          const isPct = cur && cur.ModeCalcul === 'POURCENTAGE';
          const isPret = !!(cur && cur.Echelonne && cur.Type === 'RETENUE');
          $('#aff_mt', root).style.display = isPct || isPret ? 'none' : '';
          $('#aff_tx', root).style.display = isPct ? '' : 'none';
          $('#aff_pret', root).style.display = isPret ? '' : 'none';
          $('[name=Montant]', root).required = !isPct && !isPret;
          $('[name=Taux]', root).required = !!isPct;
          $('[name=MontantPret]', root).required = isPret;
          $('[name=DureeMois]', root).required = isPret;
          const info = () => {
            const mt = Number($('[name=MontantPret]', root).value); const du = Number($('[name=DureeMois]', root).value);
            $('#aff_pret_info', root).textContent = mt > 0 && du > 0 ? `Mensualité : ${fmt(Math.floor(mt / du))} FCFA pendant ${du} mois (dernier mois : ${fmt(mt - Math.floor(mt / du) * (du - 1))} FCFA). Déduite chaque mois à partir du mois de la date de début ; la date de fin est calculée automatiquement.` : '';
          };
          $('[name=MontantPret]', root).oninput = info; $('[name=DureeMois]', root).oninput = info; info();
        };
        $('[name=RubriqueId]', root).addEventListener('change', sync);
        sync();
      },
    });
  };

  $('#re_f').onchange = () => { state.rubEmp = $('#re_f').value; guard(tabRubriquesAffectations)(); };
  $('#rr_f').onchange = () => { state.rubRub = $('#rr_f').value; guard(tabRubriquesAffectations)(); };
  $('#ra_f').onchange = () => { state.rubActifOnly = $('#ra_f').value === '1'; guard(tabRubriquesAffectations)(); };
  if ($('#addaff')) $('#addaff').onclick = () => openAff(null);
  document.querySelectorAll('[data-eaf]').forEach((b) => { b.onclick = () => openAff(rows.find((x) => x.Id === Number(b.dataset.eaf))); });
  document.querySelectorAll('[data-caf]').forEach((b) => {
    b.onclick = () => {
      const r = rows.find((x) => x.Id === Number(b.dataset.caf));
      openModal({
        title: `Clôturer — ${r.Rubrique}`,
        body: `<form id="caf"><p class="muted" style="margin-top:0">Définissez la date de fin d'application pour <b>${esc(r.Nom)} ${esc(r.Prenom)}</b>. L'historique sera conservé.</p>${inp('Date de fin *', 'fin', today(), 'date', 'required')}</form>`,
        buttons: [{ label: 'Annuler', onClick: () => true }, {
          label: 'Clôturer', cls: 'p', onClick: async () => {
            const f = $('#caf'); if (!f.reportValidity()) return false;
            await api('emprub:close', r.Id, f.fin.value); toast('Affectation clôturée.'); tabRubriquesAffectations(); return true;
          },
        }],
      });
    };
  });
  document.querySelectorAll('[data-daf]').forEach((b) => {
    b.onclick = guard(async () => {
      if (!(await confirmBox('Supprimer définitivement cette affectation ?', 'Supprimer', 'd'))) return;
      await api('emprub:delete', Number(b.dataset.daf)); toast('Affectation supprimée.'); await tabRubriquesAffectations();
    });
  });
}

async function tabEntreprise() {
  const e = await api('ent:get'); const ro = !can('admin');
  $('#tabc').innerHTML = `<div class="panel"><h3 style="margin-top:0">Entreprise (en-tête des bulletins)</h3><form id="entf"><fieldset ${ro ? 'disabled' : ''}><div class="grid two">
    ${inp("Raison sociale *", 'Nom', e.Nom, 'text', 'required', 'span2')}${inp('Adresse', 'Adresse', e.Adresse || '', 'text', '', 'span2')}${inp('Ville', 'Ville', e.Ville || '')}${inp('Téléphone', 'Telephone', e.Telephone || '')}
    ${inp('NINEA', 'NINEA', e.NINEA || '')}${inp('N° employeur IPRES', 'NumeroIPRES', e.NumeroIPRES || '')}${inp('N° employeur CSS', 'NumeroCSS', e.NumeroCSS || '')}</div></fieldset>
    ${ro ? '' : '<p><button class="p" type="submit">Enregistrer</button></p>'}</form></div>`;
  $('#entf').onsubmit = guard(async (ev) => { ev.preventDefault(); await api('ent:save', formData(ev.target)); toast('Entreprise enregistrée.'); });
}

async function tabUsers() {
  const users = await api('users:list');
  $('#tabc').innerHTML = `<div class="bar"><h2>Utilisateurs</h2><span class="sp"></span><button class="p" id="addu">+ Nouvel utilisateur</button></div>
    <div class="tw"><table><thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.Login)}</td><td>${esc(u.NomComplet)}</td><td>${esc(ROLE_LABEL[u.Role] || u.Role)}</td><td>${u.Actif ? '<span class="badge ok">Actif</span>' : '<span class="badge err">Désactivé</span>'}</td>
      <td>${u.DernierLogin ? esc(String(u.DernierLogin).replace('T', ' ').slice(0, 16)) : '—'}</td>
      <td class="n"><button class="s" data-pw="${u.Id}">Mot de passe</button> <button class="s ${u.Actif ? 'd' : ''}" data-act="${u.Id}" data-v="${u.Actif ? 0 : 1}">${u.Actif ? 'Désactiver' : 'Activer'}</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#addu').onclick = () => openModal({ title: 'Nouvel utilisateur', body: `<form id="uf" autocomplete="off"><div class="grid two">${inp('Identifiant *', 'Login', '', 'text', 'required')}${inp('Nom complet *', 'NomComplet', '', 'text', 'required')}
    ${sel('Rôle', 'Role', state.info.roles.map((r) => [r, ROLE_LABEL[r] || r]), 'GESTIONNAIRE')}${inp('Mot de passe * (8 car. min.)', 'Password', '', 'password', 'required')}</div></form>`,
  buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Créer', cls: 'p', onClick: async () => { const f = $('#uf'); if (!f.reportValidity()) return false; await api('users:create', formData(f)); toast('Utilisateur créé.'); pageParams(); return true; } }] });
  document.querySelectorAll('[data-act]').forEach((b) => { b.onclick = guard(async () => { await api('users:setActive', Number(b.dataset.act), b.dataset.v === '1'); pageParams(); }); });
  document.querySelectorAll('[data-pw]').forEach((b) => { b.onclick = () => openModal({ title: 'Réinitialiser le mot de passe', body: `<form id="pf" autocomplete="off">${inp('Nouveau mot de passe (8 car. min.)', 'pw', '', 'password', 'required')}</form>`,
    buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { const f = $('#pf'); if (!f.reportValidity()) return false; await api('users:resetPassword', Number(b.dataset.pw), f.pw.value); toast('Mot de passe modifié.'); return true; } }] }); });
}

// ───────────── Catégories et classes professionnelles ─────────────
async function tabCategories(kind) {
  const all = await api('cat:list');
  const isCat = kind === 'cat';
  const rows = isCat ? all.categories : all.classes;
  const k = isCat ? 'categorie' : 'classe';
  const yes = (v) => (v ? '<span class="badge ok">Oui</span>' : '<span class="badge">Non</span>');
  $('#tabc').innerHTML = `<div class="banner" style="background:#E3F0FB;color:#12263F">${isCat
    ? "Les catégories (1 à 8 et hors catégorie) viennent de la convention collective ; adaptez la liste à votre entreprise. Le <b>salaire minimum</b> est facultatif : s'il est renseigné, l'application avertit quand le salaire de base d'un employé lui est inférieur."
    : "Les classes professionnelles (ou échelons) s'ajoutent à la catégorie dans la fiche de l'employé et sur le bulletin. Créez celles de votre entreprise."}</div>
    <div class="bar"><h2>${isCat ? 'Catégories professionnelles' : 'Classes professionnelles'}</h2><span class="sp"></span>${can('admin') ? '<button class="p" id="addc">+ Ajouter</button>' : ''}</div>
    <div class="tw"><table><thead><tr><th>Code</th><th>Libellé</th>${isCat ? '<th class="n">Salaire minimum</th>' : ''}<th>Actif</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.Code)}</td><td>${esc(r.Libelle)}</td>${isCat ? `<td class="n">${r.SalaireMinimum != null ? fmt(r.SalaireMinimum) : ''}</td>` : ''}<td>${yes(r.Actif)}</td>
      <td class="n">${can('admin') ? `<button class="s" data-ec="${r.Id}">Modifier</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">Aucune ligne.</td></tr>`}</tbody></table></div>`;
  const edit = (r) => {
    const v = r || { Actif: true };
    openModal({ title: r ? `${isCat ? 'Catégorie' : 'Classe'} ${v.Code}` : `Nouvelle ${isCat ? 'catégorie' : 'classe'}`, body: `<form id="cf"><div class="grid two">
      ${r ? `<label class="f"><span>Code</span><input value="${esc(v.Code)}" disabled></label>` : inp('Code *', 'Code', '', 'text', 'required maxlength="20" style="text-transform:uppercase"')}
      ${inp('Libellé *', 'Libelle', v.Libelle || '', 'text', 'required maxlength="100"')}
      ${isCat ? inp('Salaire minimum (FCFA, facultatif)', 'SalaireMinimum', v.SalaireMinimum != null ? v.SalaireMinimum : '', 'number', 'min="0" step="1"') : ''}
      ${r ? chk('Actif', 'Actif', v.Actif) : ''}</div></form>`,
    buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { const f = $('#cf'); if (!f.reportValidity()) return false; const d = formData(f); d.Id = r ? r.Id : null; await api('cat:save', k, d); toast('Enregistré.'); pageParams(); return true; } }] });
  };
  if ($('#addc')) $('#addc').onclick = () => edit(null);
  document.querySelectorAll('[data-ec]').forEach((b) => { b.onclick = () => edit(rows.find((r) => r.Id === Number(b.dataset.ec))); });
}

// ───────────── Congés et absences ─────────────
const STATUT_LABEL = { DEMANDE: 'En attente', APPROUVE: 'Approuvé', REFUSE: 'Refusé', PRIS: 'Pris' };
const STATUT_CLS = { DEMANDE: 'warn', APPROUVE: 'ok', REFUSE: 'err', PRIS: 'ok' };

async function pageConges() {
  const tabs = [['demandes', 'Demandes et absences'], ['soldes', 'Soldes de congés'], ['types', 'Types de congé / absence']].filter(([id]) => id !== 'types' || can('admin'));
  $('#page').innerHTML = `<div class="tabs">${tabs.map(([id, t]) => `<button data-ctab="${id}" class="${state.congeTab === id ? 'on' : ''}">${t}</button>`).join('')}</div><div id="tabc"></div>`;
  document.querySelectorAll('[data-ctab]').forEach((b) => { b.onclick = () => { state.congeTab = b.dataset.ctab; pageConges(); }; });
  if (state.congeTab === 'soldes') await tabSoldes();
  else if (state.congeTab === 'types') await tabTypesConge();
  else await tabDemandes();
}

async function tabDemandes() {
  const rows = await api('conge:list', { annee: state.congeAnnee, statut: state.congeStatut || null });
  $('#tabc').innerHTML = `<div class="bar"><h2>Congés et absences</h2>
    <input id="cg_an" type="number" value="${state.congeAnnee}" min="2000" max="2100" title="Année">
    <select id="cg_st"><option value="">Tous les statuts</option>${Object.entries(STATUT_LABEL).map(([k, v]) => `<option value="${k}" ${state.congeStatut === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <span class="sp"></span>${can('write') ? '<button class="p" id="cg_add">+ Nouvelle demande / absence</button>' : ''}</div>
    <p class="muted" style="margin-top:0">Les absences <b>non rémunérées</b> approuvées sont retenues automatiquement sur la paie du mois (salaire de base ÷ diviseur × jours).</p>
    <div class="tw"><table><thead><tr><th>Employé</th><th>Type</th><th>Du</th><th>Au</th><th class="n">Jours</th><th>Statut</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><b>${esc(r.Nom)}</b> ${esc(r.Prenom)} <span class="muted">${esc(r.Matricule)}</span></td><td>${esc(r.Type)}${r.Remunere ? '' : ' <span class="badge err">non payé</span>'}</td>
      <td>${fmtDate(r.DateDebut)}</td><td>${fmtDate(r.DateFin)}</td><td class="n">${esc(String(r.NombreJours).replace('.', ','))}</td>
      <td><span class="badge ${STATUT_CLS[r.Statut] || ''}">${esc(STATUT_LABEL[r.Statut] || r.Statut)}</span></td>
      <td class="n">${can('paie') && r.Statut === 'DEMANDE' ? `<button class="s p" data-ap="${r.Id}">Approuver</button> <button class="s d" data-rf="${r.Id}">Refuser</button> ` : ''}${can('paie') && r.Statut === 'APPROUVE' ? `<button class="s d" data-rf="${r.Id}">Annuler</button> ` : ''}${can('write') && r.Statut === 'DEMANDE' ? `<button class="s" data-md="${r.Id}">Modifier</button> ` : ''}${can('write') && (r.Statut === 'DEMANDE' || r.Statut === 'REFUSE') ? `<button class="s d" data-sp="${r.Id}">Supprimer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucune demande pour ces critères.</td></tr>'}</tbody></table></div>`;
  $('#cg_an').onchange = () => { state.congeAnnee = Number($('#cg_an').value) || state.congeAnnee; guard(tabDemandes)(); };
  $('#cg_st').onchange = () => { state.congeStatut = $('#cg_st').value; guard(tabDemandes)(); };
  if ($('#cg_add')) $('#cg_add').onclick = guard(() => openConge(null));
  const action = (attr, fn) => document.querySelectorAll(`[${attr}]`).forEach((b) => { b.onclick = guard(async () => { await fn(Number(b.getAttribute(attr))); await tabDemandes(); }); });
  action('data-ap', async (id) => { await api('conge:statut', id, 'APPROUVE'); toast('Demande approuvée.'); });
  action('data-rf', async (id) => { await api('conge:statut', id, 'REFUSE'); toast('Demande refusée / annulée.'); });
  action('data-sp', async (id) => { if (await confirmBox('Supprimer cette demande ?', 'Supprimer', 'd')) { await api('conge:delete', id); toast('Supprimée.'); } });
  document.querySelectorAll('[data-md]').forEach((b) => { b.onclick = guard(() => openConge(rows.find((r) => r.Id === Number(b.dataset.md)))); });
}

async function openConge(r) {
  const [emps, types] = await Promise.all([api('emp:list'), api('conge:types')]);
  const v = r || { DateDebut: today(), DateFin: today(), NombreJours: '' };
  openModal({ title: r ? 'Modifier la demande' : 'Nouvelle demande / absence', body: `<form id="cgf"><div class="grid two">
    ${sel('Employé *', 'EmployeId', emps.map((e) => [e.Id, `${e.Nom} ${e.Prenom} (${e.Matricule})`]), r ? r.EmployeId : '')}
    ${sel('Type *', 'TypeCongeId', types.map((t) => [t.Id, t.Libelle + (t.Remunere ? '' : ' — non payé')]), r ? (types.find((t) => t.Code === r.TypeCode) || {}).Id : '')}
    ${inp('Du *', 'DateDebut', v.DateDebut, 'date', 'required')}${inp('Au *', 'DateFin', v.DateFin, 'date', 'required')}
    ${inp('Nombre de jours (jours ouvrables, modifiable)', 'NombreJours', v.NombreJours, 'number', 'min="0.5" step="0.5"')}
    ${can('paie') ? chk('Approuver directement', 'Approuver', false) : ''}
    <p class="muted span2" id="cg_note" style="margin:0"></p></div></form>`,
  buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => {
    const f = $('#cgf'); if (!f.reportValidity()) return false;
    const d = formData(f); d.Id = r ? r.Id : null; d.Statut = d.Approuver ? 'APPROUVE' : 'DEMANDE';
    const res = await api('conge:save', d); toast('Enregistré.'); if (res && res.avertissement) toast(res.avertissement, 'warn');
    pageConges(); return true; } }],
  onOpen: (root) => {
    const f = $('#cgf', root);
    const maj = guard(async () => { if (f.DateDebut.value && f.DateFin.value && f.DateFin.value >= f.DateDebut.value) f.NombreJours.value = await api('conge:jours', f.DateDebut.value, f.DateFin.value); });
    const note = () => { const t = types.find((x) => String(x.Id) === f.TypeCongeId.value); $('#cg_note', root).textContent = t && !t.Remunere ? 'Type non rémunéré : une fois approuvé, une retenue sera appliquée sur la paie du mois concerné.' : ''; };
    f.DateDebut.addEventListener('change', maj); f.DateFin.addEventListener('change', maj); f.TypeCongeId.addEventListener('change', note);
    if (!r) maj(); note();
  } });
}

async function tabSoldes() {
  if (!state.soldeDate) state.soldeDate = today();
  const rows = await api('conge:soldes', state.soldeDate);
  $('#tabc').innerHTML = `<div class="bar"><h2>Soldes de congés payés</h2><label class="muted">au</label><input id="sd" type="date" value="${esc(state.soldeDate)}" style="max-width:160px"><span class="sp"></span></div>
    <p class="muted" style="margin-top:0">Jours acquis = reprise de solde + jours ouvrables acquis par mois de service (paramètre <code>CONGE_JOURS_PAR_MOIS</code>, à confirmer) ; jours pris = congés annuels approuvés. Pour un employé déjà en poste, saisissez sa <b>reprise de solde</b>.</p>
    <div class="tw"><table><thead><tr><th>Employé</th><th>Compté depuis</th><th class="n">Reprise</th><th class="n">Acquis</th><th class="n">Pris</th><th class="n">Solde</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><b>${esc(r.Nom)}</b> ${esc(r.Prenom)} <span class="muted">${esc(r.Matricule)}</span></td><td>${fmtDate(r.Depuis)}</td><td class="n">${esc(String(r.Initial).replace('.', ','))}</td>
      <td class="n">${esc(String(r.acquis).replace('.', ','))}</td><td class="n">${esc(String(r.pris).replace('.', ','))}</td>
      <td class="n"><b style="color:${r.solde < 0 ? 'var(--err)' : 'inherit'}">${esc(String(r.solde).replace('.', ','))}</b></td>
      <td class="n">${can('write') ? `<button class="s" data-ri="${r.EmployeId}">Reprise de solde</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucun employé.</td></tr>'}</tbody></table></div>`;
  $('#sd').onchange = () => { state.soldeDate = $('#sd').value || today(); guard(tabSoldes)(); };
  document.querySelectorAll('[data-ri]').forEach((b) => { b.onclick = () => {
    const r = rows.find((x) => x.EmployeId === Number(b.dataset.ri));
    openModal({ title: `Reprise de solde — ${r.Nom} ${r.Prenom}`, body: `<form id="rf2"><p class="muted" style="margin-top:0">Indiquez le solde de congés à une date donnée (par exemple au 1er janvier) : l'application compte les jours acquis et pris à partir de cette date.</p><div class="grid two">
      ${inp('Solde à la date (jours)', 'solde', r.Initial, 'number', 'step="0.5" required')}${inp('Date de reprise', 'date', r.Depuis, 'date', 'required')}</div></form>`,
    buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { const f = $('#rf2'); if (!f.reportValidity()) return false; await api('conge:soldeInit', r.EmployeId, Number(f.solde.value), f.date.value); toast('Reprise enregistrée.'); tabSoldes(); return true; } }] });
  }; });
}

async function tabTypesConge() {
  const rows = await api('conge:types');
  $('#tabc').innerHTML = `<div class="bar"><h2>Types de congé et d'absence</h2><span class="sp"></span><button class="p" id="addt">+ Nouveau type</button></div>
    <p class="muted" style="margin-top:0">Un type <b>non rémunéré</b> déclenche une retenue sur la paie. Le type <code>ANNUEL</code> alimente le solde de congés payés.</p>
    <div class="tw"><table><thead><tr><th>Code</th><th>Libellé</th><th>Rémunéré</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.Code)}</td><td>${esc(r.Libelle)}</td><td>${r.Remunere ? '<span class="badge ok">Oui</span>' : '<span class="badge err">Non</span>'}</td><td class="n"><button class="s" data-et="${r.Id}">Modifier</button></td></tr>`).join('')}</tbody></table></div>`;
  const edit = (r) => openModal({ title: r ? `Type ${r.Code}` : 'Nouveau type', body: `<form id="tf"><div class="grid two">
    ${r ? `<label class="f"><span>Code</span><input value="${esc(r.Code)}" disabled></label>` : inp('Code *', 'Code', '', 'text', 'required maxlength="20" style="text-transform:uppercase"')}
    ${inp('Libellé *', 'Libelle', r ? r.Libelle : '', 'text', 'required maxlength="100"')}${chk('Rémunéré', 'Remunere', r ? r.Remunere : true)}</div></form>`,
  buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { const f = $('#tf'); if (!f.reportValidity()) return false; const d = formData(f); d.Id = r ? r.Id : null; await api('conge:typeSave', d); toast('Enregistré.'); tabTypesConge(); return true; } }] });
  $('#addt').onclick = () => edit(null);
  document.querySelectorAll('[data-et]').forEach((b) => { b.onclick = () => edit(rows.find((r) => r.Id === Number(b.dataset.et))); });
}

// ───────────── Comptabilité ─────────────
async function pageCompta() {
  const tabs = [['ecritures', 'Écritures de paie'], ['reverser', 'À reverser'], ['virements', 'Ordre de virement'], ['comptes', 'Comptes et paramètres']];
  $('#page').innerHTML = `<div class="tabs">${tabs.map(([id, t]) => `<button data-xtab="${id}" class="${state.comptaTab === id ? 'on' : ''}">${t}</button>`).join('')}</div><div id="tabc"></div>`;
  document.querySelectorAll('[data-xtab]').forEach((b) => { b.onclick = () => { state.comptaTab = b.dataset.xtab; pageCompta(); }; });
  if (state.comptaTab === 'comptes') return tabComptes();
  const periode = await comptaBarre();
  if (state.comptaTab === 'reverser') return tabReverser(periode);
  if (state.comptaTab === 'virements') return tabVirements(periode);
  return tabEcritures(periode);
}

/** Barre de choix du mois, commune aux onglets liés à une période. */
async function comptaBarre() {
  $('#tabc').innerHTML = `<div class="bar"><select id="cm">${MOIS.map((m, i) => `<option value="${i + 1}" ${i + 1 === state.mois ? 'selected' : ''}>${m}</option>`).join('')}</select>
    <input id="ca" type="number" value="${state.annee}" min="2000" max="2100"><span class="sp"></span><span id="cbtn"></span></div><div id="cbody"></div>`;
  $('#cm').onchange = () => { state.mois = Number($('#cm').value); guard(pageCompta)(); };
  $('#ca').onchange = () => { state.annee = Number($('#ca').value) || state.annee; guard(pageCompta)(); };
  return api('per:get', state.annee, state.mois);
}

async function tabEcritures(periode) {
  const body = $('#cbody');
  if (!periode) { body.innerHTML = '<p class="empty">Période non ouverte : calculez d\'abord la paie.</p>'; return; }
  const e = await api('compta:ecritures', periode.Id);
  if (e.vide) { body.innerHTML = '<p class="empty">Aucun bulletin pour cette période : calculez d\'abord la paie.</p>'; return; }
  if (can('export')) $('#cbtn').innerHTML = '<button id="cx">Exporter les écritures (CSV)</button>';
  body.innerHTML = `${e.sansCompte.length ? `<div class="banner"><b>${e.sansCompte.length} rubrique(s) sans compte attribué</b> (compte par défaut utilisé) : ${e.sansCompte.map(esc).join(' ; ')}. Attribuez-leur un compte dans « Comptes et paramètres ».</div>` : ''}
    <div class="bar"><span>Journal <b>${esc(e.journal)}</b> — Pièce <b>${esc(e.piece)}</b> — Date <b>${fmtDate(e.date)}</b></span><span class="sp"></span>
    ${e.equilibre ? '<span class="badge ok">Écriture équilibrée</span>' : '<span class="badge err">Écriture NON équilibrée</span>'}${periode.Cloturee ? ' <span class="badge ok">Période clôturée</span>' : ' <span class="badge warn">Période ouverte</span>'}</div>
    <div class="tw"><table><thead><tr><th>Compte</th><th>Intitulé du compte</th><th>Libellé</th><th class="n">Débit</th><th class="n">Crédit</th></tr></thead><tbody>
    ${e.lignes.map((l) => `<tr><td><b>${esc(l.compte)}</b></td><td class="muted">${esc(l.compteLibelle)}</td><td>${esc(l.libelle)}</td><td class="n">${l.debit ? fmt(l.debit) : ''}</td><td class="n">${l.credit ? fmt(l.credit) : ''}</td></tr>`).join('')}
    <tr class="tot"><td colspan="3">Total</td><td class="n">${fmt(e.totalDebit)}</td><td class="n">${fmt(e.totalCredit)}</td></tr></tbody></table></div>
    <p class="muted">Écriture globale de la paie du mois (OD). Les comptes sont des propositions SYSCOHADA à faire valider par votre comptable.</p>`;
  if ($('#cx')) $('#cx').onclick = guard(async () => { const r = await api('compta:csv', periode.Id); if (r.saved) toast('Fichier CSV enregistré.'); });
}

async function tabReverser(periode) {
  const body = $('#cbody');
  if (!periode) { body.innerHTML = '<p class="empty">Période non ouverte : calculez d\'abord la paie.</p>'; return; }
  const rows = await api('compta:reverser', periode.Id);
  const t = (k) => rows.reduce((s, r) => s + r[k], 0);
  body.innerHTML = `<div class="tw"><table><thead><tr><th>Organisme</th><th class="n">Retenue salariale</th><th class="n">Part patronale</th><th class="n">Total à reverser</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.organisme)}</td><td class="n">${fmt(r.retenueSalariale)}</td><td class="n">${fmt(r.partPatronale)}</td><td class="n"><b>${fmt(r.total)}</b></td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td class="n">${fmt(t('retenueSalariale'))}</td><td class="n">${fmt(t('partPatronale'))}</td><td class="n">${fmt(t('total'))}</td></tr></tbody></table></div>
    <p class="muted">Montants à payer aux organismes et à l'administration fiscale pour ${MOIS[state.mois - 1]} ${state.annee}, d'après les bulletins calculés.</p>`;
}

async function tabVirements(periode) {
  const body = $('#cbody');
  if (!periode) { body.innerHTML = '<p class="empty">Période non ouverte : calculez d\'abord la paie.</p>'; return; }
  const rows = await api('paie:journal', periode.Id);
  if (can('export')) $('#cbtn').innerHTML = '<button class="p" id="cv">Exporter l\'ordre de virement (CSV)</button>';
  body.innerHTML = `<div class="tw"><table><thead><tr><th>Matricule</th><th>Nom</th><th>Prénom</th><th class="n">Net à payer</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.Matricule)}</td><td>${esc(r.Nom)}</td><td>${esc(r.Prenom)}</td><td class="n"><b>${fmt(r.Net)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Aucun bulletin.</td></tr>'}
    ${rows.length ? `<tr class="tot"><td colspan="3">Total (${rows.length})</td><td class="n">${fmt(rows.reduce((s, r) => s + Number(r.Net), 0))}</td></tr>` : ''}</tbody></table></div>
    <p class="muted">Le fichier contient la banque et le numéro de compte de chaque employé (renseignés dans sa fiche).</p>`;
  if ($('#cv')) $('#cv').onclick = guard(async () => { const r = await api('compta:virements', periode.Id); if (r.saved) toast('Fichier CSV enregistré.'); });
}

async function tabComptes() {
  const [params, rubs, plan] = await Promise.all([api('compta:params'), api('compta:rubriques'), api('compta:plan')]);
  const admin = can('admin');
  const accounts = plan.filter((c) => c.Actif).map((c) => [c.Compte, `${c.Compte} — ${c.Libelle}`]);
  const LABEL = { COMPTE_REMUNERATION_DUE: 'Rémunérations dues (net à payer)', CODE_JOURNAL: 'Code du journal', COMPTE_GAIN_DEFAUT: 'Gains sans compte (débit)', COMPTE_RETENUE_DEFAUT: 'Retenues sans compte (crédit)',
    COMPTE_COTIS_SAL_DEFAUT: 'Cotisations salariales sans compte (crédit)', COMPTE_IMPOT_DEFAUT: 'Impôts sans compte (crédit)', COMPTE_CHARGE_PAT_DEFAUT: 'Charges patronales sans compte (débit)', COMPTE_ORGANISME_PAT_DEFAUT: 'Organismes sans compte (crédit)' };
  $('#tabc').innerHTML = `<div class="banner" style="background:#E3F0FB;color:#12263F">Comptes proposés d'après le SYSCOHADA : <b>à faire valider par votre comptable</b> avant d'importer les écritures dans votre logiciel comptable.</div>
    <div class="bar"><h2>Paramètres généraux</h2></div>
    <div class="tw" style="max-height:none"><table><thead><tr><th>Paramètre</th><th>Valeur</th><th></th></tr></thead><tbody>
    ${params.map((p) => `<tr><td>${esc(LABEL[p.Cle] || p.Cle)}</td><td><b>${esc(p.Valeur)}</b></td><td class="n">${admin ? `<button class="s" data-ep="${esc(p.Cle)}">Modifier</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="bar" style="margin-top:22px"><h2>Compte de chaque rubrique</h2></div>
    <div class="tw" style="max-height:none"><table><thead><tr><th>Rubrique</th><th>Type</th><th>Compte débit</th><th>Compte crédit</th><th></th></tr></thead><tbody>
    ${rubs.map((r) => `<tr><td>${esc(r.Libelle)} <span class="muted">${esc(r.Code)}</span></td><td>${esc(TYPE_RUB[r.Type] || r.Type)}</td><td>${esc(r.CompteDebit || '')}</td><td>${esc(r.CompteCredit || '')}</td><td class="n">${admin ? `<button class="s" data-er2="${r.Id}">Modifier</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="bar" style="margin-top:22px"><h2>Plan comptable</h2><span class="sp"></span>${admin ? '<button class="p" id="addpc">+ Ajouter un compte</button>' : ''}</div>
    <div class="tw" style="max-height:none"><table><thead><tr><th>Compte</th><th>Libellé</th><th>Actif</th><th></th></tr></thead><tbody>
    ${plan.map((c) => `<tr><td><b>${esc(c.Compte)}</b></td><td>${esc(c.Libelle)}</td><td>${c.Actif ? '<span class="badge ok">Oui</span>' : '<span class="badge">Non</span>'}</td><td class="n">${admin ? `<button class="s" data-epc="${esc(c.Compte)}">Modifier</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const done = (msg) => { toast(msg); tabComptes(); return true; };
  document.querySelectorAll('[data-ep]').forEach((b) => { b.onclick = () => {
    const p = params.find((x) => x.Cle === b.dataset.ep);
    const champ = p.Cle === 'CODE_JOURNAL' ? inp('Code du journal', 'v', p.Valeur, 'text', 'required maxlength="20"') : sel('Compte', 'v', accounts, p.Valeur);
    openModal({ title: LABEL[p.Cle] || p.Cle, body: `<form id="pf2">${champ}</form>`, buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { await api('compta:paramSave', p.Cle, $('#pf2').v.value); return done('Enregistré.'); } }] });
  }; });
  document.querySelectorAll('[data-er2]').forEach((b) => { b.onclick = () => {
    const r = rubs.find((x) => x.Id === Number(b.dataset.er2));
    const aide = r.Type === 'GAIN' ? 'Un gain n\'utilise que le compte de débit (charge).' : r.Type === 'COTIS_PAT' ? 'Une charge patronale utilise le compte de débit (charge) et le compte de crédit (organisme).' : 'Cette rubrique n\'utilise que le compte de crédit.';
    openModal({ title: r.Libelle, body: `<form id="rf3"><p class="muted" style="margin-top:0">${aide} Laissez vide pour utiliser le compte par défaut.</p><div class="grid two">
      ${sel('Compte débit', 'CompteDebit', [['', '— par défaut —']].concat(accounts), r.CompteDebit || '')}${sel('Compte crédit', 'CompteCredit', [['', '— par défaut —']].concat(accounts), r.CompteCredit || '')}</div></form>`,
    buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { const f = $('#rf3'); await api('compta:rubSave', { RubriqueId: r.Id, CompteDebit: f.CompteDebit.value, CompteCredit: f.CompteCredit.value }); return done('Enregistré.'); } }] });
  }; });
  const editCompte = (c) => openModal({ title: c ? `Compte ${c.Compte}` : 'Nouveau compte', body: `<form id="cpf"><div class="grid two">
    ${c ? `<label class="f"><span>Compte</span><input value="${esc(c.Compte)}" disabled></label>` : inp('Numéro de compte *', 'Compte', '', 'text', 'required pattern="[0-9]{1,20}" maxlength="20"')}
    ${inp('Libellé *', 'Libelle', c ? c.Libelle : '', 'text', 'required maxlength="150"')}${c ? chk('Actif', 'Actif', c.Actif) : ''}</div></form>`,
  buttons: [{ label: 'Annuler', onClick: () => true }, { label: 'Enregistrer', cls: 'p', onClick: async () => { const f = $('#cpf'); if (!f.reportValidity()) return false; const d = formData(f); if (c) d.Compte = c.Compte; else d.Nouveau = true; await api('compta:planSave', d); return done('Enregistré.'); } }] });
  if ($('#addpc')) $('#addpc').onclick = () => editCompte(null);
  document.querySelectorAll('[data-epc]').forEach((b) => { b.onclick = () => editCompte(plan.find((x) => x.Compte === b.dataset.epc)); });
}

// ───────────── Rapports ─────────────
const RAP_TABS = [
  ['journal', 'Journal de paie'],
  ['annuel', 'Récapitulatif annuel'],
  ['cotisations', 'IPRES / CSS / IPM'],
  ['impots', 'IR / TRIMF / CFCE'],
  ['historique', 'Historique employé'],
  ['employes', 'Liste des employés'],
  ['conges', 'Congés & absences'],
];

function fmtRapCell(col, val) {
  if (val == null || val === '') return '';
  if (col.format === 'money') return fmt(val);
  if (col.format === 'num') return String(Number(val)).replace('.', ',');
  if (col.format === 'date') return fmtDate(val);
  if (col.format === 'bool') return val ? 'Oui' : 'Non';
  return String(val);
}

function renderRapTable(columns, rows, totals, emptyMsg, maxHeight = '') {
  const head = columns.map((c) => `<th class="${c.align === 'n' ? 'n' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map((r) => `<tr>${columns.map((c) => {
      const txt = esc(fmtRapCell(c, r[c.key]));
      return `<td class="${c.align === 'n' ? 'n' : ''}">${c.bold ? `<b>${txt}</b>` : txt}</td>`;
    }).join('')}</tr>`).join('')
      + (totals ? `<tr class="tot">${columns.map((c) => `<td class="${c.align === 'n' ? 'n' : ''}">${totals[c.key] === undefined ? '' : esc(fmtRapCell(c, totals[c.key]))}</td>`).join('')}</tr>` : '')
    : `<tr><td colspan="${columns.length}" class="empty">${esc(emptyMsg || 'Aucune donnée.')}</td></tr>`;
  return `<div class="tw" ${maxHeight ? `style="max-height:${maxHeight}"` : ''}><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ───────────── Déclarations sur salaires ─────────────
const DECLS = [['decl_ir', 'Impôt sur le revenu'], ['decl_trimf', 'TRIMF'], ['decl_cfce', 'CFCE'], ['decl_ipres_css', 'IPRES & CSS'], ['decl_ipm', 'IPM'], ['decl_1024', 'État 1024 (annuel)']];
const DECL_AIDE = {
  decl_ir: 'IR retenu sur les salaires de la période, à reverser à la DGID.',
  decl_trimf: 'TRIMF retenue sur les salaires de la période, à reverser à la DGID.',
  decl_cfce: 'Contribution à la charge de l\'employeur, calculée sur la masse salariale soumise.',
  decl_ipres_css: 'Cotisations salariales et patronales IPRES (régime général et cadres) et cotisations patronales CSS (prestations familiales, accidents du travail).',
  decl_ipm: 'Cotisations salariales et patronales à l\'institut de prévoyance maladie.',
  decl_1024: 'État récapitulatif annuel des salaires versés : choisissez l\'exercice. La mise en forme officielle de la DGID est à vérifier avant dépôt.',
};
const declPayload = (tab) => (tab === 'decl_1024' ? { annee: state.declAnnee, moisDebut: 1, moisFin: 12 } : { annee: state.declAnnee, moisDebut: state.declDebut, moisFin: state.declFin });

async function pageDeclarations() {
  const tab = state.declTab;
  const moisOpts = (sel) => MOIS.map((m, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${m}</option>`).join('');
  const annuel = tab === 'decl_1024';
  $('#page').innerHTML = `
    <div class="tabs">${DECLS.map(([id, t]) => `<button data-dtab="${id}" class="${tab === id ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="bar">
      <input id="da" type="number" value="${state.declAnnee}" min="2000" max="2100" title="Année">
      ${annuel ? '' : `<label class="muted">de</label><select id="dm1" title="Mois de début">${moisOpts(state.declDebut)}</select><label class="muted">à</label><select id="dm2" title="Mois de fin">${moisOpts(state.declFin)}</select>`}
      <span class="sp"></span>
      ${can('export') ? '<button id="d_csv">Exporter CSV</button><button class="p" id="d_pdf">Exporter PDF</button>' : ''}
    </div>
    <p class="muted" style="margin:4px 0 8px">${esc(DECL_AIDE[tab])}</p>
    <div id="d_body"><p class="muted">Chargement…</p></div>`;
  document.querySelectorAll('[data-dtab]').forEach((b) => { b.onclick = () => { state.declTab = b.dataset.dtab; guard(pageDeclarations)(); }; });

  const refresh = guard(async () => {
    $('#d_body').innerHTML = '<p class="muted">Chargement…</p>';
    const rep = await api('rapport:data', tab, declPayload(tab));
    const kpis = rep.kpis && rep.kpis.length ? `<div class="kpis">${rep.kpis.map((k) => `<div class="kpi ${esc(k.tone || '')}"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div></div>`).join('')}</div>` : '';
    const sec = rep.secondaryTable && rep.secondaryTable.rows && rep.secondaryTable.rows.length
      ? `<h3 class="rap-sec">${esc(rep.secondaryTable.title)}</h3>${renderRapTable(rep.secondaryTable.columns, rep.secondaryTable.rows, rep.secondaryTable.totals, '', 'none')}` : '';
    $('#d_body').innerHTML = `<div class="bar" style="margin-bottom:8px"><h2>${esc(rep.title)}</h2></div><p class="rap-sub">${esc(rep.subtitle)}</p>${kpis}${renderRapTable(rep.columns, rep.rows, rep.totals, rep.emptyMessage)}${sec}`;
  });
  $('#da').onchange = () => { state.declAnnee = Number($('#da').value) || state.declAnnee; refresh(); };
  if ($('#dm1')) $('#dm1').onchange = () => { state.declDebut = Number($('#dm1').value); if (state.declFin < state.declDebut) { state.declFin = state.declDebut; $('#dm2').value = state.declFin; } refresh(); };
  if ($('#dm2')) $('#dm2').onchange = () => { state.declFin = Number($('#dm2').value); if (state.declDebut > state.declFin) { state.declDebut = state.declFin; $('#dm1').value = state.declDebut; } refresh(); };
  const exp = (id, ch, msg) => { if ($(id)) $(id).onclick = guard(async () => { const btn = $(id); btn.disabled = true; try { const r = await api(ch, tab, declPayload(tab)); if (r.saved) toast(msg); } finally { btn.disabled = false; } }); };
  exp('#d_csv', 'rapport:csv', 'Fichier CSV enregistré.');
  exp('#d_pdf', 'rapport:pdf', 'PDF enregistré.');
  await refresh();
}

function rapFiltersPayload(tab) {
  const base = { employeId: state.rapEmp || null, categorie: state.rapCat || null };
  if (tab === 'journal') return { ...base, annee: state.rapAnnee, mois: state.rapMois };
  if (tab === 'annuel') return { ...base, annee: state.rapAnnee, moisDebut: state.rapAnnDebut, moisFin: state.rapAnnFin, vue: state.rapAnnuelVue };
  if (tab === 'historique') return { ...base, annee: state.rapAnnee, moisDebut: state.rapAnnDebut, moisFin: state.rapAnnFin };
  if (tab === 'cotisations') return { ...base, annee: state.rapAnnee, moisDebut: state.rapPerDebut, moisFin: state.rapPerFin, organisme: state.rapOrg };
  if (tab === 'impots') return { ...base, annee: state.rapAnnee, moisDebut: state.rapPerDebut, moisFin: state.rapPerFin };
  if (tab === 'employes') return { ...base, actif: state.rapActif };
  if (tab === 'conges') return { ...base, dateDebut: state.rapDateDebut, dateFin: state.rapDateFin, statut: state.rapCongeStatut || null, vue: state.rapCongeVue };
  return base;
}

async function pageRapports() {
  const opts = await api('rapport:filters');
  const tab = state.rapTab;
  const moisOpts = (selected) => MOIS.map((m, i) => `<option value="${i + 1}" ${i + 1 === selected ? 'selected' : ''}>${m}</option>`).join('');
  const empOpts = `<option value="">Tous les employés</option>${opts.employes.map((e) => `<option value="${e.Id}" ${String(state.rapEmp) === String(e.Id) ? 'selected' : ''}>${esc(e.Nom)} ${esc(e.Prenom)} (${esc(e.Matricule)})${e.Actif ? '' : ' — inactif'}</option>`).join('')}`;
  const catOpts = `<option value="">Toutes catégories</option>${opts.categories.map((c) => `<option value="${esc(c.Code)}" ${state.rapCat === c.Code ? 'selected' : ''}>${esc(c.Code)} — ${esc(c.Libelle)}</option>`).join('')}`;
  const anneeInp = `<input id="ra" type="number" value="${state.rapAnnee}" min="2000" max="2100" title="Année">`;

  let spec = '';
  if (tab === 'journal') {
    spec = `<select id="rm" title="Mois">${moisOpts(state.rapMois)}</select>${anneeInp}`;
  } else if (tab === 'annuel' || tab === 'historique') {
    spec = `${anneeInp}<label class="muted">de</label><select id="rm1" title="Mois de début">${moisOpts(state.rapAnnDebut)}</select><label class="muted">à</label><select id="rm2" title="Mois de fin">${moisOpts(state.rapAnnFin)}</select>`;
    if (tab === 'annuel') {
      spec += `<select id="rv" title="Regroupement"><option value="mois" ${state.rapAnnuelVue === 'mois' ? 'selected' : ''}>Par mois</option><option value="employe" ${state.rapAnnuelVue === 'employe' ? 'selected' : ''}>Par employé</option></select>`;
    }
  } else if (tab === 'cotisations' || tab === 'impots') {
    spec = `${anneeInp}<label class="muted">de</label><select id="rm1" title="Mois de début">${moisOpts(state.rapPerDebut)}</select><label class="muted">à</label><select id="rm2" title="Mois de fin">${moisOpts(state.rapPerFin)}</select>`;
    if (tab === 'cotisations') {
      spec += `<select id="ro" title="Organisme">${[['TOUS', 'Tous organismes'], ['IPRES', 'IPRES'], ['CSS', 'CSS'], ['IPM', 'IPM']].map(([v, l]) => `<option value="${v}" ${state.rapOrg === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    }
  } else if (tab === 'employes') {
    spec = `<select id="ract" title="État">${[['1', 'Actifs uniquement'], ['0', 'Inactifs uniquement'], ['ALL', 'Actifs et inactifs']].map(([v, l]) => `<option value="${v}" ${state.rapActif === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  } else if (tab === 'conges') {
    const soldes = state.rapCongeVue === 'soldes';
    spec = `<select id="rcv" title="Vue"><option value="demandes" ${!soldes ? 'selected' : ''}>Demandes et absences</option><option value="soldes" ${soldes ? 'selected' : ''}>Soldes de congés payés</option></select>`
      + (soldes
        ? `<label class="muted">au</label><input id="rd2" type="date" value="${esc(state.rapDateFin)}">`
        : `<label class="muted">du</label><input id="rd1" type="date" value="${esc(state.rapDateDebut)}"><label class="muted">au</label><input id="rd2" type="date" value="${esc(state.rapDateFin)}">`
          + `<select id="rst" title="Statut"><option value="">Tous les statuts</option>${Object.entries(STATUT_LABEL).map(([k, v]) => `<option value="${k}" ${state.rapCongeStatut === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`);
  }

  $('#page').innerHTML = `
    <div class="tabs">${RAP_TABS.map(([id, t]) => `<button data-rtab="${id}" class="${tab === id ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="bar">${spec}
      <select id="re" title="Employé">${empOpts}</select>
      <select id="rc" title="Catégorie">${catOpts}</select>
      <span class="sp"></span>
      ${can('export') ? '<button id="rap_csv">Exporter CSV</button><button class="p" id="rap_pdf">Exporter PDF</button>' : ''}
    </div>
    <div id="rap_body"><p class="muted">Chargement…</p></div>`;

  document.querySelectorAll('[data-rtab]').forEach((b) => { b.onclick = () => { state.rapTab = b.dataset.rtab; guard(pageRapports)(); }; });

  const refresh = guard(async () => {
    $('#rap_body').innerHTML = '<p class="muted">Chargement…</p>';
    const rep = await api('rapport:data', tab, rapFiltersPayload(tab));
    const kpis = rep.kpis && rep.kpis.length
      ? `<div class="kpis">${rep.kpis.map((k) => `<div class="kpi ${esc(k.tone || '')}"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div></div>`).join('')}</div>`
      : '';
    const sec = rep.secondaryTable && rep.secondaryTable.rows && rep.secondaryTable.rows.length
      ? `<h3 class="rap-sec">${esc(rep.secondaryTable.title)}</h3>${renderRapTable(rep.secondaryTable.columns, rep.secondaryTable.rows, rep.secondaryTable.totals, '', 'none')}`
      : '';
    $('#rap_body').innerHTML = `<div class="bar" style="margin-bottom:8px"><h2>${esc(rep.title)}</h2></div>
      <p class="rap-sub">${esc(rep.subtitle)}</p>
      ${kpis}
      ${renderRapTable(rep.columns, rep.rows, rep.totals, rep.emptyMessage)}
      ${sec}`;
  });

  if ($('#rm')) $('#rm').onchange = () => { state.rapMois = Number($('#rm').value); refresh(); };
  if ($('#ra')) $('#ra').onchange = () => { state.rapAnnee = Number($('#ra').value) || state.rapAnnee; refresh(); };
  if ($('#rm1')) $('#rm1').onchange = () => {
    const v = Number($('#rm1').value);
    if (tab === 'annuel' || tab === 'historique') { state.rapAnnDebut = v; if (state.rapAnnFin < v) { state.rapAnnFin = v; $('#rm2').value = v; } }
    else { state.rapPerDebut = v; if (state.rapPerFin < v) { state.rapPerFin = v; $('#rm2').value = v; } }
    refresh();
  };
  if ($('#rm2')) $('#rm2').onchange = () => {
    const v = Number($('#rm2').value);
    if (tab === 'annuel' || tab === 'historique') { state.rapAnnFin = v; if (state.rapAnnDebut > v) { state.rapAnnDebut = v; $('#rm1').value = v; } }
    else { state.rapPerFin = v; if (state.rapPerDebut > v) { state.rapPerDebut = v; $('#rm1').value = v; } }
    refresh();
  };
  if ($('#rv')) $('#rv').onchange = () => { state.rapAnnuelVue = $('#rv').value; refresh(); };
  if ($('#ro')) $('#ro').onchange = () => { state.rapOrg = $('#ro').value; refresh(); };
  if ($('#ract')) $('#ract').onchange = () => { state.rapActif = $('#ract').value; refresh(); };
  if ($('#rcv')) $('#rcv').onchange = () => { state.rapCongeVue = $('#rcv').value; guard(pageRapports)(); };
  if ($('#rd1')) $('#rd1').onchange = () => { state.rapDateDebut = $('#rd1').value || state.rapDateDebut; refresh(); };
  if ($('#rd2')) $('#rd2').onchange = () => { state.rapDateFin = $('#rd2').value || state.rapDateFin; refresh(); };
  if ($('#rst')) $('#rst').onchange = () => { state.rapCongeStatut = $('#rst').value; refresh(); };
  $('#re').onchange = () => { state.rapEmp = $('#re').value; refresh(); };
  $('#rc').onchange = () => { state.rapCat = $('#rc').value; refresh(); };

  if ($('#rap_csv')) $('#rap_csv').onclick = guard(async () => {
    const btn = $('#rap_csv'); btn.disabled = true;
    try { const r = await api('rapport:csv', tab, rapFiltersPayload(tab)); if (r.saved) toast('Fichier CSV enregistré.'); }
    finally { btn.disabled = false; }
  });
  if ($('#rap_pdf')) $('#rap_pdf').onclick = guard(async () => {
    const btn = $('#rap_pdf'); btn.disabled = true;
    try { const r = await api('rapport:pdf', tab, rapFiltersPayload(tab)); if (r.saved) toast('PDF enregistré.'); }
    finally { btn.disabled = false; }
  });

  await refresh();
}

// ───────────── Démarrage ─────────────
(async () => {
  try {
    state.info = await api('app:info');
    const st = await api('auth:status');
    if (st.user) { state.user = st.user; showApp(); } else showLogin(st.needsAdmin);
  } catch (e) {
    $('#root').innerHTML = `<div class="login"><div class="card"><h1>PaieGestion</h1><p>Impossible de démarrer.</p><div class="msg">${esc(e.message)}</div><div class="row"><button id="cfg" class="p">Configuration SQL Server</button></div></div></div>`;
    $('#cfg').onclick = () => window.paie.call('app:openSetup');
  }
})();
