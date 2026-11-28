'use strict';
const calc = require('./calc');
const { hashPassword } = require('./auth');
const { calcPartsTrimf } = require('./parts');
const conges = require('./conges');
const compta = require('./compta');
const rubriques = require('./rubriques');

const str = (v, max) => { const s = String(v == null ? '' : v).trim(); return s ? s.slice(0, max) : null; };
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const isoDate = (v) => { const s = str(v, 10); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const monthBounds = (annee, mois) => ({
  debut: `${annee}-${String(mois).padStart(2, '0')}-01`,
  fin: new Date(Date.UTC(annee, mois, 0)).toISOString().slice(0, 10),
});

async function audit(db, user, action, entite, entiteId, details) {
  try {
    await db.query(
      'INSERT INTO paie.JournalAudit (UtilisateurId, Action, Entite, EntiteId, Details) VALUES (@u, @a, @e, @i, @d)',
      { u: user ? user.id : null, a: action, e: entite, i: entiteId == null ? null : entiteId, d: details ? String(details).slice(0, 4000) : null });
  } catch (e) { console.error('[audit]', e.message); }
}

// ───────────────────────── Employés ─────────────────────────
const listEmployes = (db) => db.query(`
  SELECT e.Id, e.Matricule, e.Nom, e.Prenom, e.EstCadre, e.NombreParts, e.DateEmbauche,
         d.Libelle AS Departement, p.Libelle AS Poste, k.SalaireBase, k.TypeContrat, k.Categorie, k.Echelon
  FROM paie.Employe e
  LEFT JOIN paie.Departement d ON d.Id = e.DepartementId
  LEFT JOIN paie.Poste p ON p.Id = e.PosteId
  OUTER APPLY (SELECT TOP 1 SalaireBase, TypeContrat, Categorie, Echelon FROM paie.Contrat c
               WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
  WHERE e.Actif = 1 ORDER BY e.Nom, e.Prenom`);

async function getEmploye(db, id) {
  const e = (await db.query(`
    SELECT e.*, d.Libelle AS Departement, p.Libelle AS Poste
    FROM paie.Employe e LEFT JOIN paie.Departement d ON d.Id = e.DepartementId
    LEFT JOIN paie.Poste p ON p.Id = e.PosteId WHERE e.Id = @id`, { id }))[0];
  if (!e) throw new Error('Employé introuvable.');
  const k = (await db.query(`SELECT TOP 1 TypeContrat, SalaireBase, Categorie, Echelon FROM paie.Contrat
                             WHERE EmployeId = @id AND EstActif = 1 ORDER BY DateDebut DESC`, { id }))[0] || {};
  const primes = await db.query(`
    SELECT er.Id, er.RubriqueId, r.Code, r.Libelle, r.Type, r.ModeCalcul, er.Montant, er.Taux, er.DateDebut, er.DateFin, er.Commentaire
    FROM paie.EmployeRubrique er
    JOIN paie.Rubrique r ON r.Id = er.RubriqueId
    WHERE er.EmployeId = @id AND er.Actif = 1 AND (er.DateFin IS NULL OR er.DateFin >= CONVERT(date, GETDATE()))
    ORDER BY r.Ordre, er.DateDebut DESC`, { id });
  return { ...e, TypeContrat: k.TypeContrat || 'CDI', SalaireBase: k.SalaireBase || 0, Categorie: k.Categorie || '', Echelon: k.Echelon || '', primes };
}

async function lookupId(run, table, libelle) {
  const l = str(libelle, 100);
  if (!l) return null;
  const f = await run(`SELECT Id FROM paie.${table} WHERE Libelle = @l`, { l });
  if (f[0]) return f[0].Id;
  const sql = table === 'Departement'
    ? "INSERT INTO paie.Departement (Code, Libelle) OUTPUT INSERTED.Id VALUES ('D' + RIGHT(CONVERT(NVARCHAR(36), NEWID()), 12), @l)"
    : 'INSERT INTO paie.Poste (Libelle) OUTPUT INSERTED.Id VALUES (@l)';
  return (await run(sql, { l }))[0].Id;
}

async function saveEmploye(db, d, user) {
  const matricule = str(d.Matricule, 20), nom = str(d.Nom, 100), prenom = str(d.Prenom, 100);
  if (!matricule || !nom || !prenom) throw new Error('Matricule, nom et prénom sont obligatoires.');
  const embauche = isoDate(d.DateEmbauche);
  if (!embauche) throw new Error("La date d'embauche est obligatoire.");
  const salaire = num(d.SalaireBase);
  if (salaire <= 0) throw new Error('Le salaire de base doit être supérieur à 0.');
  const parts = num(d.NombreParts, 1);
  if (parts < 1 || parts > 5 || Math.round(parts * 2) / 2 !== parts) throw new Error('Le nombre de parts doit être compris entre 1 et 5, par demi-part (1 ; 1,5 ; 2 ; …).');
  const sit = ['C', 'M', 'D', 'V'].includes(d.SituationFamiliale) ? d.SituationFamiliale : 'C';
  const mode = ['VIREMENT', 'ESPECES', 'CHEQUE', 'MOBILE'].includes(d.ModePaiement) ? d.ModePaiement : 'VIREMENT';
  const typeC = ['CDI', 'CDD', 'STAGE', 'JOURNALIER', 'CONSULTANT'].includes(d.TypeContrat) ? d.TypeContrat : 'CDI';

  try {
    return await db.tx(async (run) => {
      const p = {
        Matricule: matricule, Nom: nom.toUpperCase(), Prenom: prenom,
        Sexe: d.Sexe === 'M' || d.Sexe === 'F' ? d.Sexe : null,
        DateNaissance: isoDate(d.DateNaissance), CNI: str(d.NumeroCNI, 30), Tel: str(d.Telephone, 30), Adr: str(d.Adresse, 200),
        Sit: sit, Conj: sit === 'M' && d.ConjointTravaille ? 1 : 0, Enf: Math.max(0, Math.min(20, Math.trunc(num(d.NombreEnfants)))), Parts: parts, Cadre: d.EstCadre ? 1 : 0,
        Ipres: str(d.NumeroIPRES, 30), Css: str(d.NumeroCSS, 30), Mode: mode, Banque: str(d.Banque, 100), Compte: str(d.NumeroCompte, 40),
        Dep: await lookupId(run, 'Departement', d.Departement), Poste: await lookupId(run, 'Poste', d.Poste),
        Emb: embauche, Sortie: isoDate(d.DateSortie),
      };
      let id = d.Id ? Number(d.Id) : null;
      if (id) {
        await run(`UPDATE paie.Employe SET Matricule=@Matricule, Nom=@Nom, Prenom=@Prenom, Sexe=@Sexe, DateNaissance=@DateNaissance,
          NumeroCNI=@CNI, Telephone=@Tel, Adresse=@Adr, SituationFamiliale=@Sit, ConjointTravaille=@Conj, NombreEnfants=@Enf, NombreParts=@Parts, EstCadre=@Cadre,
          NumeroIPRES=@Ipres, NumeroCSS=@Css, ModePaiement=@Mode, Banque=@Banque, NumeroCompte=@Compte,
          DepartementId=@Dep, PosteId=@Poste, DateEmbauche=@Emb, DateSortie=@Sortie WHERE Id=@Id`, { ...p, Id: id });
      } else {
        id = (await run(`INSERT INTO paie.Employe (Matricule, Nom, Prenom, Sexe, DateNaissance, NumeroCNI, Telephone, Adresse,
          SituationFamiliale, ConjointTravaille, NombreEnfants, NombreParts, EstCadre, NumeroIPRES, NumeroCSS, ModePaiement, Banque, NumeroCompte,
          DepartementId, PosteId, DateEmbauche, DateSortie)
          OUTPUT INSERTED.Id
          VALUES (@Matricule, @Nom, @Prenom, @Sexe, @DateNaissance, @CNI, @Tel, @Adr, @Sit, @Conj, @Enf, @Parts, @Cadre, @Ipres, @Css,
                  @Mode, @Banque, @Compte, @Dep, @Poste, @Emb, @Sortie)`, p))[0].Id;
      }
      // Contrat actif : mis à jour sur place, ou créé
      // Catégorie et classe professionnelle (codes définis dans Paramètres) ; avertissement si le salaire est sous le minimum de la catégorie
      const catCode = str(d.Categorie, 20); const classeCode = str(d.Echelon, 20);
      let avertissement = null;
      if (catCode) {
        const cat = (await run('SELECT SalaireMinimum FROM paie.Categorie WHERE Code=@c', { c: catCode }))[0];
        if (!cat) throw new Error(`Catégorie inconnue : ${catCode}`);
        if (cat.SalaireMinimum != null && salaire < Number(cat.SalaireMinimum)) avertissement = `Le salaire de base est inférieur au minimum de la catégorie ${catCode} (${Number(cat.SalaireMinimum).toLocaleString('fr-FR')} FCFA).`;
      }
      if (classeCode && !(await run('SELECT Id FROM paie.ClasseProfessionnelle WHERE Code=@c', { c: classeCode }))[0]) throw new Error(`Classe professionnelle inconnue : ${classeCode}`);
      const k = await run('SELECT TOP 1 Id FROM paie.Contrat WHERE EmployeId=@id AND EstActif=1 ORDER BY DateDebut DESC', { id });
      if (k[0]) await run('UPDATE paie.Contrat SET TypeContrat=@t, SalaireBase=@s, Categorie=@cat, Echelon=@cl WHERE Id=@cid', { t: typeC, s: salaire, cat: catCode, cl: classeCode, cid: k[0].Id });
      else await run('INSERT INTO paie.Contrat (EmployeId, TypeContrat, DateDebut, SalaireBase, Categorie, Echelon) VALUES (@id,@t,@d,@s,@cat,@cl)', { id, t: typeC, d: embauche, s: salaire, cat: catCode, cl: classeCode });
      // Sélection des rubriques du catalogue affectées à l'employé (préserve l'historique clôturé)
      if (Array.isArray(d.primes)) {
        const actives = await run(`SELECT Id FROM paie.EmployeRubrique
          WHERE EmployeId=@id AND Actif=1 AND (DateFin IS NULL OR DateFin >= CONVERT(date, GETDATE()))`, { id });
        const keepIds = new Set(d.primes.filter((pr) => pr.Id).map((pr) => Number(pr.Id)));
        for (const a of actives) {
          if (!keepIds.has(Number(a.Id))) await run('DELETE FROM paie.EmployeRubrique WHERE Id=@eid AND EmployeId=@id', { eid: a.Id, id });
        }
        for (const pr of d.primes) {
          const rid = Number(pr.RubriqueId);
          if (!rid) continue;
          const rInfo = (await run('SELECT ModeCalcul FROM paie.Rubrique WHERE Id=@r AND Actif=1 AND EstSysteme=0', { r: rid }))[0];
          if (!rInfo) continue;
          const isPct = rInfo.ModeCalcul === 'POURCENTAGE';
          const montant = isPct ? null : num(pr.Montant);
          const taux = isPct ? num(pr.Taux) : null;
          if ((isPct && !(taux > 0 && taux <= 100)) || (!isPct && !(montant > 0))) continue;
          const dDeb = isoDate(pr.DateDebut) || embauche;
          const dFin = isoDate(pr.DateFin);
          if (dFin && dFin < dDeb) throw new Error('La date de fin d\'une rubrique doit être postérieure ou égale à sa date de début.');
          if (pr.Id && keepIds.has(Number(pr.Id))) {
            await run(`UPDATE paie.EmployeRubrique SET RubriqueId=@r, Montant=@m, Taux=@t, DateDebut=@dd, DateFin=@df, Commentaire=@c
              WHERE Id=@eid AND EmployeId=@id`,
              { r: rid, m: montant, t: taux, dd: dDeb, df: dFin, c: str(pr.Commentaire, 200), eid: Number(pr.Id), id });
          } else {
            await run(`INSERT INTO paie.EmployeRubrique (EmployeId, RubriqueId, Montant, Taux, DateDebut, DateFin, Commentaire)
              VALUES (@id,@r,@m,@t,@dd,@df,@c)`,
              { id, r: rid, m: montant, t: taux, dd: dDeb, df: dFin, c: str(pr.Commentaire, 200) });
          }
        }
      }
      await audit({ query: (t, pp) => run(t, pp) }, user, d.Id ? 'MODIFICATION' : 'CREATION', 'Employe', id, `${matricule} ${nom}`);
      return { id, avertissement };
    });
  } catch (err) {
    if (err && (err.number === 2627 || err.number === 2601)) throw new Error('Ce matricule existe déjà.');
    throw err;
  }
}

async function deactivateEmploye(db, id, user) {
  await db.query('UPDATE paie.Employe SET Actif = 0, DateSortie = ISNULL(DateSortie, CONVERT(date, GETDATE())) WHERE Id = @id', { id });
  await audit(db, user, 'DESACTIVATION', 'Employe', id, null);
}

const listRubriquesSaisie = (db) => db.query(
  "SELECT Id, Code, Libelle, Type, ModeCalcul, Imposable, SoumisCotisation, SoumisCfceTrimf, PlafondExoneration, BaseRetenue, Echelonne FROM paie.Rubrique WHERE Actif = 1 AND Type IN (N'GAIN', N'RETENUE') AND EstSysteme = 0 AND Code <> N'SALBASE' ORDER BY Ordre, Id");

// ───────────────────────── Rubriques de paie ─────────────────────────
const listRubriques = (db) => db.query(`
  SELECT r.Id, r.Code, r.Libelle, r.Type, r.ModeCalcul, r.Imposable, r.SoumisCotisation, r.SoumisCfceTrimf,
         r.PlafondExoneration, r.BaseRetenue, r.Echelonne, r.ProrataJours, r.Ordre, r.CompteComptable, r.EstSysteme, r.Actif
  FROM paie.Rubrique r ORDER BY r.Ordre, r.Id`);

/** Plafond d'exonération mensuel (ParametreLegal EXO_<CODE> tenu synchronisé s'il existe déjà). */
async function syncExonerationParam(db, code, valeur) {
  const c = `EXO_${code}`;
  const ex = (await db.query('SELECT TOP 1 Id FROM paie.ParametreLegal WHERE Code = @c AND DateFin IS NULL ORDER BY DateDebut DESC', { c }))[0];
  if (ex) await db.query('UPDATE paie.ParametreLegal SET Valeur = @v WHERE Id = @id', { v: valeur || 0, id: ex.Id });
}

async function syncCompteRubrique(db, rubriqueId, type, compte) {
  if (!compte) return;
  const ex = (await db.query('SELECT RubriqueId, CompteDebit, CompteCredit FROM paie.CompteRubrique WHERE RubriqueId = @id', { id: rubriqueId }))[0];
  const deb = type === 'GAIN' || type === 'COTIS_PAT' ? compte : (ex ? ex.CompteDebit : null);
  const cre = type === 'GAIN' ? (ex ? ex.CompteCredit : null) : (type === 'COTIS_PAT' ? (ex ? ex.CompteCredit : null) : compte);
  if (ex) await db.query('UPDATE paie.CompteRubrique SET CompteDebit=@d, CompteCredit=@c WHERE RubriqueId=@id', { d: deb, c: cre, id: rubriqueId });
  else await db.query('INSERT INTO paie.CompteRubrique (RubriqueId, CompteDebit, CompteCredit) VALUES (@id,@d,@c)', { id: rubriqueId, d: deb, c: cre });
}

function exoValue(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error("Le plafond d'exonération doit être un montant positif (ou vide).");
  return n > 0 ? n : null;
}

async function saveRubrique(db, d, user) {
  const libelle = str(d.Libelle, 100);
  if (!libelle) throw new Error('Le libellé est obligatoire.');
  const ordre = Math.max(0, Math.min(9999, Math.trunc(num(d.Ordre, 100))));
  const compte = str(d.CompteComptable, 20);
  if (compte && !(await db.query('SELECT Compte FROM paie.PlanComptable WHERE Compte = @c AND Actif = 1', { c: compte }))[0]) {
    throw new Error(`Compte comptable inconnu ou inactif : ${compte} (ajoutez-le dans Comptabilité > Plan comptable).`);
  }
  if (d.Id) {
    const id = Number(d.Id);
    const cur = (await db.query('SELECT Code, Type, EstSysteme FROM paie.Rubrique WHERE Id = @id', { id }))[0];
    if (!cur) throw new Error('Rubrique introuvable.');
    const isSys = !!cur.EstSysteme || cur.Code === 'SALBASE' || !['GAIN', 'RETENUE'].includes(cur.Type);
    if (!isSys) {
      const gain = cur.Type === 'GAIN';
      const mode = rubriques.MODES_SAISIE.includes(d.ModeCalcul) ? d.ModeCalcul : 'FIXE';
      const imp = gain && d.Imposable ? 1 : 0;
      const cotis = gain && (d.SoumisCotisation !== undefined ? d.SoumisCotisation : d.Imposable) ? 1 : 0;
      const cfce = gain && (d.SoumisCfceTrimf !== undefined ? d.SoumisCfceTrimf : d.Imposable) ? 1 : 0;
      const plafond = gain ? exoValue(d.PlafondExoneration) : null;
      const baseRet = !gain && rubriques.BASES_RETENUE.includes(d.BaseRetenue) ? d.BaseRetenue : 'NET_APRES_IMPOT';
      const echel = !gain && d.Echelonne ? 1 : 0;
      const prorata = gain && d.ProrataJours ? 1 : 0;
      await db.query(`UPDATE paie.Rubrique
        SET Libelle=@l, ModeCalcul=@mc, Imposable=@i, SoumisCotisation=@s, SoumisCfceTrimf=@cf,
            PlafondExoneration=@pl, BaseRetenue=@br, Echelonne=@ec, ProrataJours=@pj, Ordre=@o, CompteComptable=@cc, Actif=@a
        WHERE Id=@id`,
        { l: libelle, mc: mode, i: imp, s: cotis, cf: cfce, pl: plafond, br: baseRet, ec: echel, pj: prorata, o: ordre, cc: compte, a: d.Actif === false ? 0 : 1, id });
      if (gain && d.PlafondExoneration !== undefined) await syncExonerationParam(db, cur.Code, plafond);
    } else {
      // rubrique système : seuls le libellé, l'ordre et le compte comptable sont modifiables
      await db.query('UPDATE paie.Rubrique SET Libelle=@l, Ordre=@o, CompteComptable=@cc WHERE Id=@id', { l: libelle, o: ordre, cc: compte, id });
    }
    await syncCompteRubrique(db, id, cur.Type, compte);
    await audit(db, user, 'MODIFICATION', 'Rubrique', id, libelle);
    return;
  }
  const code = String(d.Code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,30}$/.test(code)) throw new Error('Code : 2 à 30 caractères (lettres majuscules, chiffres, _).');
  if (!['GAIN', 'RETENUE'].includes(d.Type)) throw new Error('Seuls les gains et les retenues peuvent être créés.');
  const mode = rubriques.MODES_SAISIE.includes(d.ModeCalcul) ? d.ModeCalcul : 'FIXE';
  const gain = d.Type === 'GAIN';
  const imp = gain && d.Imposable ? 1 : 0;
  const cotis = gain && (d.SoumisCotisation !== undefined ? d.SoumisCotisation : d.Imposable) ? 1 : 0;
  const cfce = gain && (d.SoumisCfceTrimf !== undefined ? d.SoumisCfceTrimf : d.Imposable) ? 1 : 0;
  const plafond = gain ? exoValue(d.PlafondExoneration) : null;
  const baseRet = !gain && rubriques.BASES_RETENUE.includes(d.BaseRetenue) ? d.BaseRetenue : 'NET_APRES_IMPOT';
  const echel = !gain && d.Echelonne ? 1 : 0;
  const prorata = gain && d.ProrataJours ? 1 : 0;
  let newId = null;
  try {
    const ins = await db.query(`INSERT INTO paie.Rubrique
      (Code, Libelle, Type, ModeCalcul, Imposable, SoumisCotisation, SoumisCfceTrimf, PlafondExoneration, BaseRetenue, Echelonne, ProrataJours, Ordre, CompteComptable, EstSysteme)
      OUTPUT INSERTED.Id
      VALUES (@c,@l,@t,@mc,@i,@s,@cf,@pl,@br,@ec,@pj,@o,@cc,0)`,
      { c: code, l: libelle, t: d.Type, mc: mode, i: imp, s: cotis, cf: cfce, pl: plafond, br: baseRet, ec: echel, pj: prorata, o: ordre, cc: compte });
    newId = ins[0] ? ins[0].Id : null;
    if (newId && compte) await syncCompteRubrique(db, newId, d.Type, compte);
  } catch (err) {
    if (err && (err.number === 2627 || err.number === 2601)) throw new Error('Ce code de rubrique existe déjà.');
    throw err;
  }
  await audit(db, user, 'CREATION', 'Rubrique', newId, `${code} ${libelle}`);
}

// ───────────────────────── Affectations employé-rubrique ─────────────────────────
const listEmployeRubriques = (db, f = {}) => db.query(`
  SELECT er.Id, er.EmployeId, e.Matricule, e.Nom, e.Prenom,
         er.RubriqueId, r.Code AS RubriqueCode, r.Libelle AS Rubrique, r.Type, r.ModeCalcul, r.Echelonne, r.BaseRetenue,
         er.Montant, er.Taux, er.MontantPret, er.DureeMois, er.DateDebut, er.DateFin, er.Actif, er.Commentaire,
         -- prêt : total réellement retenu sur les bulletins (calculés) depuis le début du prêt ; reste = prêt - remboursé
         CASE WHEN er.MontantPret > 0 THEN (
           SELECT ISNULL(SUM(l.MontantRetenue), 0)
           FROM paie.LigneBulletin l
           JOIN paie.BulletinPaie b ON b.Id = l.BulletinId
           JOIN paie.PeriodePaie pp ON pp.Id = b.PeriodeId
           WHERE b.EmployeId = er.EmployeId AND l.RubriqueId = er.RubriqueId
             AND (pp.Annee * 12 + pp.Mois) >= (YEAR(er.DateDebut) * 12 + MONTH(er.DateDebut))
             AND (er.DateFin IS NULL OR (pp.Annee * 12 + pp.Mois) <= (YEAR(er.DateFin) * 12 + MONTH(er.DateFin)))
         ) END AS Rembourse
  FROM paie.EmployeRubrique er
  JOIN paie.Employe e ON e.Id = er.EmployeId
  JOIN paie.Rubrique r ON r.Id = er.RubriqueId
  WHERE (@emp IS NULL OR er.EmployeId = @emp)
    AND (@rub IS NULL OR er.RubriqueId = @rub)
    AND (@actifOnly = 0 OR (er.Actif = 1 AND (er.DateFin IS NULL OR er.DateFin >= @today)))
  ORDER BY e.Nom, e.Prenom, r.Ordre, er.DateDebut DESC`,
  {
    emp: f.employeId ? Number(f.employeId) : null,
    rub: f.rubriqueId ? Number(f.rubriqueId) : null,
    actifOnly: f.actifOnly === false ? 0 : 1,
    today: new Date().toISOString().slice(0, 10),
  });

async function saveEmployeRubrique(db, d, user) {
  const emp = Number(d.EmployeId);
  const rub = Number(d.RubriqueId);
  if (!emp || !rub) throw new Error("L'employé et la rubrique sont obligatoires.");
  const debut = isoDate(d.DateDebut);
  let fin = isoDate(d.DateFin);
  if (!debut) throw new Error('La date de début est obligatoire.');
  if (fin && fin < debut) throw new Error('La date de fin doit être postérieure ou égale à la date de début.');

  const rInfo = (await db.query('SELECT Code, Libelle, Type, ModeCalcul, Echelonne, EstSysteme, Actif FROM paie.Rubrique WHERE Id = @id', { id: rub }))[0];
  if (!rInfo || !rInfo.Actif || rInfo.EstSysteme || !['GAIN', 'RETENUE'].includes(rInfo.Type)) {
    throw new Error('Rubrique invalide, inactive ou système.');
  }
  const isPct = rInfo.ModeCalcul === 'POURCENTAGE';
  // Remboursement de prêt : montant total + durée en mois → mensualité automatique, fin d'affectation = dernier mois du prêt
  const isPret = !!rInfo.Echelonne && rInfo.Type === 'RETENUE';
  let montant = isPct ? null : num(d.Montant);
  const taux = isPct ? num(d.Taux) : null;
  let montantPret = null;
  let dureeMois = null;
  if (isPret) {
    montantPret = Math.round(num(d.MontantPret));
    dureeMois = Math.trunc(num(d.DureeMois));
    if (!(montantPret > 0)) throw new Error('Le montant du prêt doit être supérieur à 0.');
    if (!(dureeMois >= 1) || dureeMois > 120) throw new Error('La durée de remboursement doit être comprise entre 1 et 120 mois.');
    if (montantPret < dureeMois) throw new Error('Le montant du prêt est trop faible pour cette durée (moins de 1 FCFA par mois).');
    montant = rubriques.mensualitePret(montantPret, dureeMois, 0);
    const y = Number(debut.slice(0, 4)); const m = Number(debut.slice(5, 7)) - 1 + dureeMois - 1;
    fin = monthBounds(y + Math.floor(m / 12), (m % 12) + 1).fin;
  } else {
    if (isPct && (!(taux > 0) || taux > 100)) throw new Error('Le taux doit être compris entre 0 et 100 %.');
    if (!isPct && !(montant > 0)) throw new Error('Le montant doit être supérieur à 0.');
  }

  const id = d.Id ? Number(d.Id) : null;
  const chev = await db.query(`SELECT TOP 1 Id FROM paie.EmployeRubrique
    WHERE EmployeId = @e AND RubriqueId = @r AND Actif = 1
      AND DateDebut <= ISNULL(@fin, '9999-12-31') AND ISNULL(DateFin, '9999-12-31') >= @debut
      AND (@id IS NULL OR Id <> @id)`,
    { e: emp, r: rub, debut, fin, id });
  if (chev[0]) throw new Error('Une affectation active existe déjà pour cet employé et cette rubrique sur ces dates.');

  const com = str(d.Commentaire, 200);
  if (id) {
    await db.query(`UPDATE paie.EmployeRubrique
      SET EmployeId=@e, RubriqueId=@r, Montant=@m, Taux=@t, MontantPret=@mp, DureeMois=@dm, DateDebut=@debut, DateFin=@fin, Actif=@a, Commentaire=@c
      WHERE Id=@id`,
      { e: emp, r: rub, m: montant, t: taux, mp: montantPret, dm: dureeMois, debut, fin, a: d.Actif === false ? 0 : 1, c: com, id });
  } else {
    await db.query(`INSERT INTO paie.EmployeRubrique (EmployeId, RubriqueId, Montant, Taux, MontantPret, DureeMois, DateDebut, DateFin, Actif, Commentaire)
      VALUES (@e,@r,@m,@t,@mp,@dm,@debut,@fin,1,@c)`,
      { e: emp, r: rub, m: montant, t: taux, mp: montantPret, dm: dureeMois, debut, fin, c: com });
  }
  await audit(db, user, id ? 'MODIFICATION' : 'CREATION', 'EmployeRubrique', id, `emp ${emp} rub ${rInfo.Code} ${isPret ? 'prêt ' + montantPret + ' sur ' + dureeMois + ' mois' : (isPct ? taux + '%' : montant)}`);
}

async function closeEmployeRubrique(db, id, dateFin, user) {
  const fin = isoDate(dateFin);
  if (!fin) throw new Error('La date de fin est obligatoire (AAAA-MM-JJ).');
  const cur = (await db.query('SELECT DateDebut FROM paie.EmployeRubrique WHERE Id = @id', { id: Number(id) }))[0];
  if (!cur) throw new Error('Affectation introuvable.');
  if (fin < String(cur.DateDebut).slice(0, 10)) throw new Error('La date de fin ne peut pas être antérieure à la date de début.');
  await db.query('UPDATE paie.EmployeRubrique SET DateFin = @fin WHERE Id = @id', { fin, id: Number(id) });
  await audit(db, user, 'CLOTURE', 'EmployeRubrique', Number(id), `fin=${fin}`);
}

async function deleteEmployeRubrique(db, id, user) {
  await db.query('DELETE FROM paie.EmployeRubrique WHERE Id = @id', { id: Number(id) });
  await audit(db, user, 'SUPPRESSION', 'EmployeRubrique', Number(id), null);
}

// ───────────────────────── Périodes et variables ─────────────────────────
async function getOrCreatePeriode(db, annee, mois) {
  annee = Math.trunc(num(annee)); mois = Math.trunc(num(mois));
  if (annee < 2000 || annee > 2100 || mois < 1 || mois > 12) throw new Error('Période invalide.');
  let r = await db.query('SELECT Id, Annee, Mois, Cloturee FROM paie.PeriodePaie WHERE Annee=@a AND Mois=@m', { a: annee, m: mois });
  if (!r[0]) {
    await db.query('INSERT INTO paie.PeriodePaie (Annee, Mois) VALUES (@a, @m)', { a: annee, m: mois });
    r = await db.query('SELECT Id, Annee, Mois, Cloturee FROM paie.PeriodePaie WHERE Annee=@a AND Mois=@m', { a: annee, m: mois });
  }
  return r[0];
}

async function findPeriode(db, annee, mois) {
  const r = await db.query('SELECT Id, Annee, Mois, Cloturee FROM paie.PeriodePaie WHERE Annee=@a AND Mois=@m', { a: Math.trunc(num(annee)), m: Math.trunc(num(mois)) });
  return r[0] || null;
}

async function cloturerPeriode(db, id, user) {
  const n = (await db.query('SELECT COUNT(*) AS n FROM paie.BulletinPaie WHERE PeriodeId=@id', { id }))[0].n;
  if (!n) throw new Error('Aucun bulletin à clôturer : calculez la paie avant de clôturer.');
  await db.query('UPDATE paie.PeriodePaie SET Cloturee=1, DateCloture=SYSDATETIME() WHERE Id=@id', { id });
  await audit(db, user, 'CLOTURE', 'PeriodePaie', id, `${n} bulletins`);
}

async function assertOuverte(db, periodeId) {
  const p = (await db.query('SELECT Cloturee FROM paie.PeriodePaie WHERE Id=@id', { id: periodeId }))[0];
  if (!p) throw new Error('Période introuvable.');
  if (p.Cloturee) throw new Error('Cette période est clôturée.');
}

const listVariables = (db, periodeId) => db.query(`
  SELECT v.Id, v.EmployeId, e.Matricule, e.Nom, e.Prenom, r.Libelle AS Rubrique, r.Type, v.Montant, v.Commentaire
  FROM paie.VariablePaie v JOIN paie.Employe e ON e.Id = v.EmployeId JOIN paie.Rubrique r ON r.Id = v.RubriqueId
  WHERE v.PeriodeId = @p ORDER BY e.Nom, e.Prenom, r.Ordre`, { p: periodeId });

async function saveVariable(db, d, user) {
  await assertOuverte(db, d.PeriodeId);
  if (num(d.Montant) <= 0) throw new Error('Le montant doit être supérieur à 0.');
  const deja = await db.query('SELECT COUNT(*) AS n FROM paie.VariablePaie WHERE EmployeId=@e AND PeriodeId=@p AND RubriqueId=@r',
    { e: Number(d.EmployeId), p: Number(d.PeriodeId), r: Number(d.RubriqueId) });
  if (deja[0] && Number(deja[0].n) > 0) throw new Error('Une variable existe déjà pour cette rubrique et cet employé ce mois-ci : une rubrique ne s\'utilise qu\'une fois par mois. Supprimez-la puis saisissez le montant voulu.');
  // Rubrique déjà affectée à l'employé sur ce mois ? Dans ce cas la variable la remplace (indiquée à l'utilisateur)
  const per = (await db.query('SELECT Annee, Mois FROM paie.PeriodePaie WHERE Id=@p', { p: Number(d.PeriodeId) }))[0];
  let remplace = null;
  if (per) {
    const { debut, fin } = monthBounds(per.Annee, per.Mois);
    const aff = await db.query(`SELECT TOP 1 er.Montant, er.Taux, er.MontantPret FROM paie.EmployeRubrique er
      WHERE er.EmployeId=@e AND er.RubriqueId=@r AND er.Actif=1 AND er.DateDebut<=@fin AND (er.DateFin IS NULL OR er.DateFin>=@debut)`,
      { e: Number(d.EmployeId), r: Number(d.RubriqueId), debut, fin });
    if (aff[0]) remplace = { Montant: aff[0].Montant != null ? Number(aff[0].Montant) : null, Taux: aff[0].Taux != null ? Number(aff[0].Taux) : null, Pret: Number(aff[0].MontantPret) > 0 };
  }
  await db.query('INSERT INTO paie.VariablePaie (EmployeId, PeriodeId, RubriqueId, Montant, Commentaire) VALUES (@e,@p,@r,@m,@c)',
    { e: Number(d.EmployeId), p: Number(d.PeriodeId), r: Number(d.RubriqueId), m: num(d.Montant), c: str(d.Commentaire, 200) });
  await audit(db, user, 'CREATION', 'VariablePaie', null, `emp ${d.EmployeId} rub ${d.RubriqueId} ${d.Montant}`);
  return { remplace };
}

async function deleteVariable(db, id, periodeId, user) {
  await assertOuverte(db, periodeId);
  await db.query('DELETE FROM paie.VariablePaie WHERE Id=@id AND PeriodeId=@p', { id, p: periodeId });
  await audit(db, user, 'SUPPRESSION', 'VariablePaie', id, null);
}

// Jours travaillés par employé et par période (vide = mois complet) : proratisation des rubriques « ProrataJours »
const listPresences = (db, periodeId) => db.query(`
  SELECT pr.EmployeId, e.Matricule, e.Nom, e.Prenom, pr.JoursTravailles
  FROM paie.PresencePeriode pr JOIN paie.Employe e ON e.Id = pr.EmployeId
  WHERE pr.PeriodeId = @p ORDER BY e.Nom, e.Prenom`, { p: periodeId });

async function savePresence(db, d, user) {
  await assertOuverte(db, d.PeriodeId);
  const j = Math.round(num(d.JoursTravailles) * 2) / 2;
  if (!(j >= 0 && j <= 31)) throw new Error('Jours travaillés : un nombre entre 0 et 31 (demi-journées acceptées).');
  const k = { e: Number(d.EmployeId), p: Number(d.PeriodeId), j };
  await db.query(`MERGE paie.PresencePeriode AS t USING (SELECT @e AS EmployeId, @p AS PeriodeId) AS s
    ON t.EmployeId = s.EmployeId AND t.PeriodeId = s.PeriodeId
    WHEN MATCHED THEN UPDATE SET JoursTravailles = @j
    WHEN NOT MATCHED THEN INSERT (EmployeId, PeriodeId, JoursTravailles) VALUES (@e, @p, @j);`, k);
  await audit(db, user, 'MODIFICATION', 'PresencePeriode', null, `emp ${k.e} période ${k.p} : ${j} jours`);
}

async function deletePresence(db, employeId, periodeId, user) {
  await assertOuverte(db, periodeId);
  await db.query('DELETE FROM paie.PresencePeriode WHERE EmployeId=@e AND PeriodeId=@p', { e: employeId, p: periodeId });
  await audit(db, user, 'SUPPRESSION', 'PresencePeriode', null, `emp ${employeId} période ${periodeId}`);
}

// ───────────────────────── Calcul de la paie ─────────────────────────
async function loadParams(run, dateIso) {
  const rows = await run('SELECT Code, Valeur FROM paie.ParametreLegal WHERE DateDebut<=@d AND (DateFin IS NULL OR DateFin>=@d) ORDER BY DateDebut', { d: dateIso });
  const ir = await run('SELECT TrancheMin, TrancheMax, Taux FROM paie.BaremeIR WHERE DateDebut<=@d AND (DateFin IS NULL OR DateFin>=@d) ORDER BY TrancheMin', { d: dateIso });
  const tr = await run('SELECT SalaireMin, SalaireMax, Montant FROM paie.BaremeTRIMF WHERE DateDebut<=@d AND (DateFin IS NULL OR DateFin>=@d) ORDER BY SalaireMin', { d: dateIso });
  return calc.makeParams(rows, ir, tr);
}

async function unverifiedCount(db) {
  const r = await db.query(`SELECT (SELECT COUNT(*) FROM paie.ParametreLegal WHERE Verifie=0 AND DateFin IS NULL)
    + (SELECT COUNT(*) FROM paie.BaremeIR WHERE Verifie=0 AND DateFin IS NULL) AS n`);
  return r[0].n;
}

async function calculerPeriode(db, periodeId, user) {
  const nonVerifies = await unverifiedCount(db);
  const count = await db.tx(async (run) => {
    const per = (await run('SELECT Id, Annee, Mois, Cloturee FROM paie.PeriodePaie WHERE Id=@id', { id: periodeId }))[0];
    if (!per) throw new Error('Période introuvable.');
    if (per.Cloturee) throw new Error('Cette période est clôturée : recalcul impossible.');
    const { debut, fin } = monthBounds(per.Annee, per.Mois);
    const p = await loadParams(run, debut);
    const rub = Object.fromEntries((await run('SELECT Id, Code, Libelle, Ordre FROM paie.Rubrique')).map((r) => [r.Code, r]));

    const employes = await run(`
      SELECT e.Id, e.EstCadre, e.NombreParts, e.SituationFamiliale, e.ConjointTravaille, e.DateSortie, k.SalaireBase
      FROM paie.Employe e
      CROSS APPLY (SELECT TOP 1 SalaireBase FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1
                   AND c.DateDebut <= @fin AND (c.DateFin IS NULL OR c.DateFin >= @debut) ORDER BY c.DateDebut DESC) k
      WHERE e.Actif = 1 AND e.DateEmbauche <= @fin AND (e.DateSortie IS NULL OR e.DateSortie >= @debut)`, { debut, fin });

    // Cumuls de l'année (bulletins des mois précédents) : base de la retenue d'IR et de TRIMF en cumul annuel
    const cumuls = new Map((await run(`
      SELECT b.EmployeId, COUNT(*) AS Nb, SUM(ISNULL(b.BrutImposable, b.Brut)) AS BrutImposable,
             SUM(ISNULL(b.BrutCfceTrimf, ISNULL(b.BrutImposable, b.Brut))) AS BrutCfceTrimf,
             SUM(b.ImpotRevenu) AS Ir, SUM(b.TRIMF) AS Trimf
      FROM paie.BulletinPaie b JOIN paie.PeriodePaie pp ON pp.Id = b.PeriodeId
      WHERE pp.Annee = @annee AND pp.Mois < @mois GROUP BY b.EmployeId`, { annee: per.Annee, mois: per.Mois }))
      .map((x) => [x.EmployeId, { nb: Number(x.Nb), brutImposable: Number(x.BrutImposable), brutCfceTrimf: Number(x.BrutCfceTrimf), ir: Number(x.Ir), trimf: Number(x.Trimf) }]));

    // Jours travaillés du mois par employé (absent = mois complet, aucune proratisation)
    const presences = new Map((await run('SELECT EmployeId, JoursTravailles FROM paie.PresencePeriode WHERE PeriodeId = @per', { per: periodeId })).map((x) => [x.EmployeId, Number(x.JoursTravailles)]));

    for (const e of employes) {
      let lignes = await run(`
        SELECT r.Id AS RubriqueId, r.Code, r.Libelle, r.Type, r.ModeCalcul, r.Imposable, r.SoumisCotisation, r.SoumisCfceTrimf, r.PlafondExoneration, r.Ordre, r.ProrataJours,
               r.BaseRetenue, er.Montant, er.Taux, er.MontantPret, er.DureeMois, er.DateDebut, 0 AS EstVariable
        FROM paie.EmployeRubrique er JOIN paie.Rubrique r ON r.Id = er.RubriqueId
        WHERE er.EmployeId=@id AND er.Actif=1 AND er.DateDebut<=@fin AND (er.DateFin IS NULL OR er.DateFin>=@debut)
        UNION ALL
        SELECT r.Id, r.Code, r.Libelle, r.Type, r.ModeCalcul, r.Imposable, r.SoumisCotisation, r.SoumisCfceTrimf, r.PlafondExoneration, r.Ordre, r.ProrataJours,
               r.BaseRetenue, ISNULL(v.Montant,0) AS Montant, NULL AS Taux, NULL AS MontantPret, NULL AS DureeMois, NULL AS DateDebut, 1 AS EstVariable
        FROM paie.VariablePaie v JOIN paie.Rubrique r ON r.Id = v.RubriqueId
        WHERE v.EmployeId=@id AND v.PeriodeId=@per`, { id: e.Id, debut, fin, per: periodeId });

      // Une rubrique n'apparaît qu'une fois par mois : la variable du mois remplace le montant affecté
      lignes = rubriques.fusionnerVariables(lignes);

      // Prêts : la mensualité du mois (n/durée) remplace le montant ; hors durée du prêt, aucune retenue
      for (let i = lignes.length - 1; i >= 0; i--) {
        const l = lignes[i];
        if (!(Number(l.MontantPret) > 0)) continue;
        const dd = isoDate(l.DateDebut instanceof Date ? l.DateDebut.toISOString() : l.DateDebut);
        const idx = (per.Annee * 12 + per.Mois) - (Number(dd.slice(0, 4)) * 12 + Number(dd.slice(5, 7)));
        const mens = rubriques.mensualitePret(l.MontantPret, l.DureeMois, idx);
        if (mens <= 0) { lignes.splice(i, 1); continue; }
        l.Montant = mens; l.Libelle = `${l.Libelle} (${idx + 1}/${l.DureeMois})`;
      }
      const sb = rub.SALBASE;
      lignes.unshift({ RubriqueId: sb.Id, Code: sb.Code, Libelle: sb.Libelle, Type: 'GAIN', ModeCalcul: 'AUTO', Imposable: true, SoumisCotisation: true, SoumisCfceTrimf: true, PlafondExoneration: 0, ProrataJours: true, Ordre: sb.Ordre, Montant: Number(e.SalaireBase), Taux: null });
      // Absences non rémunérées approuvées : retenue = salaire de base / diviseur x jours, qui réduit le brut
      const absences = await run(`SELECT c.DateDebut, c.DateFin, c.NombreJours FROM paie.Conge c
        JOIN paie.TypeConge t ON t.Id = c.TypeCongeId
        WHERE c.EmployeId = @id AND t.Remunere = 0 AND c.Statut IN (N'APPROUVE', N'PRIS') AND c.DateDebut <= @fin AND c.DateFin >= @debut`, { id: e.Id, debut, fin });
      const joursAbs = Math.round(absences.reduce((n, c) => n + conges.joursDansPeriode({ debut: c.DateDebut, fin: c.DateFin, nombreJours: c.NombreJours }, debut, fin), 0) * 10) / 10;
      if (joursAbs > 0) {
        if (!rub.ABS_NR) throw new Error("Rubrique « Absences non rémunérées » introuvable : relancez l'application.");
        const montantAbs = Math.min(Number(e.SalaireBase), Math.round(Number(e.SalaireBase) / p.get('ABSENCE_DIVISEUR') * joursAbs));
        lignes.splice(1, 0, { RubriqueId: rub.ABS_NR.Id, Code: 'ABS_NR', Libelle: `Absences non rémunérées (${joursAbs} j)`, Type: 'GAIN', ModeCalcul: 'AUTO', Imposable: true, SoumisCotisation: true, SoumisCfceTrimf: true, PlafondExoneration: 0, Ordre: rub.ABS_NR.Ordre, Montant: -montantAbs, Taux: null });
      }
      const dSortie = isoDate(e.DateSortie instanceof Date ? e.DateSortie.toISOString() : e.DateSortie);
      const sortieMois = dSortie && dSortie >= debut && dSortie <= fin;
      const ass = rubriques.calculerAssiettes(lignes, Number(e.SalaireBase), p, { jours: presences.has(e.Id) ? presences.get(e.Id) : null });
      const { gains, retenues } = ass;
      const r = calc.calculer({
        brut: ass.brut, brutCotisable: ass.brutCotisable, brutImposable: ass.brutImposable, brutCfceTrimf: ass.brutCfceTrimf,
        estCadre: !!e.EstCadre, parts: Number(e.NombreParts),
        partsTrimf: calcPartsTrimf({ situation: e.SituationFamiliale, conjointTravaille: !!e.ConjointTravaille }), autresRetenues: ass.autresRetenues,
        cumul: cumuls.get(e.Id) || null,
        // Départ dans le mois (solde de tout compte) ou décembre : régularisation de l'IR et de la TRIMF de l'année
        sortie: !!sortieMois, regularisation: !!sortieMois || per.Mois === 12,
      }, p);

      await run('DELETE FROM paie.BulletinPaie WHERE EmployeId=@id AND PeriodeId=@per', { id: e.Id, per: periodeId });
      const bid = (await run(`INSERT INTO paie.BulletinPaie (EmployeId, PeriodeId, SalaireBase, Brut, BaseImposable, BaseIPRES,
          TotalCotisSalariales, TotalCotisPatronales, ImpotRevenu, TRIMF, AutresRetenues, Net, CoutEmployeur, NombreParts, BrutImposable, BrutCfceTrimf)
        OUTPUT INSERTED.Id VALUES (@e,@per,@sb,@brut,@bi,@bip,@ts,@tp,@ir,@trimf,@ar,@net,@cout,@parts,@bimp,@bcf)`, {
        e: e.Id, per: periodeId, sb: Number(e.SalaireBase), brut: r.brut, bi: r.baseImposable, bip: r.baseIPRES,
        ts: r.totalCotisSal, tp: r.totalCotisPat, ir: r.ir, trimf: r.trimf, ar: r.autresRetenues, net: r.net, cout: r.coutEmployeur, parts: Number(e.NombreParts), bimp: r.brutImposable, bcf: r.brutCfceTrimf,
      }))[0].Id;

      const ins = (rubId, lib, ordre, base, taux, gain, ret, pat) => run(
        `INSERT INTO paie.LigneBulletin (BulletinId, RubriqueId, Libelle, Base, Taux, MontantGain, MontantRetenue, MontantPatronal, Ordre)
         VALUES (@b,@r,@l,@base,@taux,@g,@ret,@pat,@o)`, { b: bid, r: rubId, l: lib, base, taux, g: gain, ret, pat, o: ordre });
      const cot = (code, base, paramTaux, sal, pat) => {
        if (!sal && !pat) return null;
        const ri = rub[code];
        return ins(ri.Id, ri.Libelle, ri.Ordre, base, p.get(paramTaux), 0, sal, pat);
      };
      for (const g of gains) await ins(g.RubriqueId, g.Libelle, g.Ordre, g.BaseCalculee, g.TauxCalcule, Number(g.Montant), 0, 0);
      await cot('IPRES_RG_SAL', r.baseIPRES, 'IPRES_RG_SAL', r.rgSal, 0);
      await cot('IPRES_RCC_SAL', null, 'IPRES_RCC_SAL', r.rccSal, 0);
      await cot('IPM_SAL', r.baseIPM, 'IPM_SAL', r.ipmSal, 0);
      const suffixe = sortieMois ? ' - régularisation de fin de contrat' : (per.Mois === 12 ? ' - régularisation annuelle' : '');
      if (r.ir !== 0) await ins(rub.IR.Id, rub.IR.Libelle + suffixe, rub.IR.Ordre, r.baseImposable, null, 0, r.ir, 0);
      if (r.trimf !== 0) await ins(rub.TRIMF.Id, rub.TRIMF.Libelle + suffixe, rub.TRIMF.Ordre, null, null, 0, r.trimf, 0);
      for (const t of retenues) await ins(t.RubriqueId, t.Libelle, t.Ordre, null, null, 0, Number(t.Montant), 0);
      await cot('IPRES_RG_PAT', r.baseIPRES, 'IPRES_RG_PAT', 0, r.rgPat);
      await cot('IPRES_RCC_PAT', null, 'IPRES_RCC_PAT', 0, r.rccPat);
      await cot('IPM_PAT', r.baseIPM, 'IPM_PAT', 0, r.ipmPat);
      await cot('CSS_PF_PAT', null, 'CSS_PF_PAT', 0, r.cssPf);
      await cot('CSS_ATMP_PAT', null, 'CSS_ATMP_PAT', 0, r.cssAtmp);
      await cot('CFCE_PAT', r.baseCfceTrimf, 'CFCE_PAT', 0, r.cfce);
    }
    return employes.length;
  });
  await audit(db, user, 'CALCUL', 'PeriodePaie', periodeId, `${count} bulletins`);
  return { count, nonVerifies };
}

const journal = (db, periodeId) => db.query(`
  SELECT b.Id, b.EmployeId, e.Matricule, e.Nom, e.Prenom, b.Brut, b.TotalCotisSalariales, b.ImpotRevenu, b.TRIMF,
         b.AutresRetenues, b.Net, b.TotalCotisPatronales, b.CoutEmployeur
  FROM paie.BulletinPaie b JOIN paie.Employe e ON e.Id = b.EmployeId
  WHERE b.PeriodeId = @p ORDER BY e.Nom, e.Prenom`, { p: periodeId });

/** Détail complet des bulletins d'une période (ou d'un seul bulletin) : sert au PDF et à l'écran de détail. */
async function getBulletins(db, periodeId, bulletinId) {
  const per = (await db.query('SELECT Id, Annee, Mois, Cloturee FROM paie.PeriodePaie WHERE Id=@id', { id: periodeId }))[0];
  if (!per) throw new Error('Période introuvable.');
  const entreprise = (await db.query('SELECT * FROM paie.Entreprise WHERE Id = 1'))[0] || { Nom: '' };
  const bulletins = await db.query(`
    SELECT b.*, e.Matricule, e.Nom, e.Prenom, e.DateEmbauche, e.SituationFamiliale, e.NombreEnfants, e.EstCadre,
           e.NumeroIPRES, e.NumeroCSS, e.ModePaiement, e.Banque, e.NumeroCompte, p.Libelle AS Poste, d.Libelle AS Departement,
           k.Categorie, k.Echelon, cat.Libelle AS CategorieLibelle, cl.Libelle AS ClasseLibelle
    FROM paie.BulletinPaie b JOIN paie.Employe e ON e.Id = b.EmployeId
    LEFT JOIN paie.Poste p ON p.Id = e.PosteId LEFT JOIN paie.Departement d ON d.Id = e.DepartementId
    OUTER APPLY (SELECT TOP 1 c.Categorie, c.Echelon FROM paie.Contrat c WHERE c.EmployeId = e.Id AND c.EstActif = 1 ORDER BY c.DateDebut DESC) k
    LEFT JOIN paie.Categorie cat ON cat.Code = k.Categorie
    LEFT JOIN paie.ClasseProfessionnelle cl ON cl.Code = k.Echelon
    WHERE b.PeriodeId = @p AND (@b IS NULL OR b.Id = @b) ORDER BY e.Nom, e.Prenom`, { p: periodeId, b: bulletinId || null });
  const lignes = await db.query(`
    SELECT l.BulletinId, l.Libelle, l.Base, l.Taux, l.MontantGain, l.MontantRetenue, l.MontantPatronal,
           -- le « taux » d'une rubrique proratisée est un nombre de JOURS travaillés (affiché « 15 j » et non « 15 % »)
           CASE WHEN l.Taux IS NOT NULL AND l.MontantGain <> 0 AND (r.ProrataJours = 1 OR r.Code = N'SALBASE')
                 AND pr.JoursTravailles IS NOT NULL AND l.Taux = pr.JoursTravailles THEN 1 ELSE 0 END AS TauxEnJours
    FROM paie.LigneBulletin l JOIN paie.BulletinPaie b ON b.Id = l.BulletinId
    LEFT JOIN paie.Rubrique r ON r.Id = l.RubriqueId
    LEFT JOIN paie.PresencePeriode pr ON pr.EmployeId = b.EmployeId AND pr.PeriodeId = b.PeriodeId
    WHERE b.PeriodeId = @p AND (@b IS NULL OR b.Id = @b) ORDER BY l.BulletinId, l.Ordre, l.Id`, { p: periodeId, b: bulletinId || null });
  const soldes = new Map((await soldesAt(db, monthBounds(per.Annee, per.Mois).fin)).map((x) => [x.EmployeId, x]));
  for (const b of bulletins) { b.lignes = lignes.filter((l) => l.BulletinId === b.Id); b.conge = soldes.get(b.EmployeId) || null; }
  return { periode: per, entreprise, bulletins };
}

// ───────────────────────── Paramètres légaux ─────────────────────────
const TABLES = {
  param: { table: 'ParametreLegal', cols: { Code: 'str50', Libelle: 'str200', Valeur: 'num', DateDebut: 'date', DateFin: 'date', Source: 'str200', Verifie: 'bit' }, order: 'Code, DateDebut' },
  ir: { table: 'BaremeIR', cols: { TrancheMin: 'num', TrancheMax: 'numnull', Taux: 'num', DateDebut: 'date', DateFin: 'date', Verifie: 'bit' }, order: 'DateDebut, TrancheMin' },
  trimf: { table: 'BaremeTRIMF', cols: { SalaireMin: 'num', SalaireMax: 'numnull', Montant: 'num', DateDebut: 'date', DateFin: 'date', Verifie: 'bit' }, order: 'DateDebut, SalaireMin' },
};

async function listParams(db) {
  return {
    param: await db.query(`SELECT * FROM paie.ParametreLegal ORDER BY ${TABLES.param.order}`),
    ir: await db.query(`SELECT * FROM paie.BaremeIR ORDER BY ${TABLES.ir.order}`),
    trimf: await db.query(`SELECT * FROM paie.BaremeTRIMF ORDER BY ${TABLES.trimf.order}`),
  };
}

function coerce(kind, v) {
  switch (kind) {
    case 'num': { const n = Number(v); if (!Number.isFinite(n)) throw new Error('Valeur numérique invalide.'); return n; }
    case 'numnull': return v === '' || v == null ? null : coerce('num', v);
    case 'date': return v ? (isoDate(v) || (() => { throw new Error('Date invalide (AAAA-MM-JJ).'); })()) : null;
    case 'bit': return v ? 1 : 0;
    case 'str50': return str(v, 50);
    default: return str(v, 200);
  }
}

async function saveRow(db, kind, d, user) {
  const def = TABLES[kind];
  if (!def) throw new Error('Table inconnue.');   // jamais de SQL construit depuis une entrée libre
  const names = Object.keys(def.cols);
  const vals = {};
  for (const n of names) vals[n] = coerce(def.cols[n], d[n]);
  if (!vals.DateDebut) throw new Error('La date de début est obligatoire.');
  if (kind === 'param' && !vals.Code) throw new Error('Le code est obligatoire.');
  if (d.Id) {
    await db.query(`UPDATE paie.${def.table} SET ${names.map((n) => `${n}=@${n}`).join(', ')} WHERE Id=@Id`, { ...vals, Id: Number(d.Id) });
  } else {
    await db.query(`INSERT INTO paie.${def.table} (${names.join(',')}) VALUES (${names.map((n) => '@' + n).join(',')})`, vals);
  }
  await audit(db, user, d.Id ? 'MODIFICATION' : 'CREATION', def.table, d.Id || null, JSON.stringify(vals));
}

async function deleteRow(db, kind, id, user) {
  const def = TABLES[kind];
  if (!def) throw new Error('Table inconnue.');
  await db.query(`DELETE FROM paie.${def.table} WHERE Id=@id`, { id: Number(id) });
  await audit(db, user, 'SUPPRESSION', def.table, id, null);
}

// ───────────────────────── Entreprise ─────────────────────────
const getEntreprise = async (db) => (await db.query('SELECT * FROM paie.Entreprise WHERE Id = 1'))[0];
async function saveEntreprise(db, d, user) {
  const nom = str(d.Nom, 150);
  if (!nom) throw new Error("Le nom de l'entreprise est obligatoire.");
  await db.query(`UPDATE paie.Entreprise SET Nom=@n, Adresse=@a, Ville=@v, Telephone=@t, NINEA=@ni, NumeroIPRES=@i, NumeroCSS=@c WHERE Id=1`,
    { n: nom, a: str(d.Adresse, 200), v: str(d.Ville, 100), t: str(d.Telephone, 50), ni: str(d.NINEA, 50), i: str(d.NumeroIPRES, 50), c: str(d.NumeroCSS, 50) });
  await audit(db, user, 'MODIFICATION', 'Entreprise', 1, nom);
}

// ───────────────────────── Utilisateurs ─────────────────────────
const ROLES = ['ADMIN', 'GESTIONNAIRE', 'COMPTABLE', 'LECTEUR'];
const needsAdmin = async (db) => (await db.query('SELECT COUNT(*) AS n FROM paie.Utilisateur'))[0].n === 0;
const listUsers = (db) => db.query(`SELECT u.Id, u.Login, u.NomComplet, r.Code AS Role, u.Actif, u.DernierLogin
  FROM paie.Utilisateur u JOIN paie.Role r ON r.Id = u.RoleId ORDER BY u.Login`);

function checkNewUser(d) {
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(String(d.Login || ''))) throw new Error('Identifiant : 3 à 50 caractères (lettres, chiffres, . _ -).');
  if (!str(d.NomComplet, 150)) throw new Error('Le nom complet est obligatoire.');
  if (String(d.Password || '').length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
}

async function createUser(db, d, user, { firstAdmin = false } = {}) {
  checkNewUser(d);
  const role = firstAdmin ? 'ADMIN' : d.Role;
  if (!ROLES.includes(role)) throw new Error('Rôle invalide.');
  const { hash, salt } = hashPassword(d.Password);
  try {
    await db.query(`INSERT INTO paie.Utilisateur (Login, NomComplet, MotDePasseHash, Sel, RoleId)
      VALUES (@l, @n, @h, @s, (SELECT Id FROM paie.Role WHERE Code = @r))`,
      { l: d.Login.trim(), n: str(d.NomComplet, 150), h: hash, s: salt, r: role });
  } catch (err) {
    if (err && (err.number === 2627 || err.number === 2601)) throw new Error('Cet identifiant existe déjà.');
    throw err;
  }
  await audit(db, user, 'CREATION', 'Utilisateur', null, `${d.Login} (${role})`);
}

async function setUserActive(db, id, actif, user) {
  if (!actif) {
    const admins = (await db.query(`SELECT COUNT(*) AS n FROM paie.Utilisateur u JOIN paie.Role r ON r.Id=u.RoleId
      WHERE r.Code='ADMIN' AND u.Actif=1 AND u.Id<>@id`, { id }))[0].n;
    const target = (await db.query('SELECT r.Code FROM paie.Utilisateur u JOIN paie.Role r ON r.Id=u.RoleId WHERE u.Id=@id', { id }))[0];
    if (target && target.Code === 'ADMIN' && admins === 0) throw new Error('Impossible de désactiver le dernier administrateur.');
  }
  await db.query('UPDATE paie.Utilisateur SET Actif=@a WHERE Id=@id', { a: actif ? 1 : 0, id });
  await audit(db, user, actif ? 'ACTIVATION' : 'DESACTIVATION', 'Utilisateur', id, null);
}

async function resetPassword(db, id, password, user) {
  if (String(password || '').length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  const { hash, salt } = hashPassword(password);
  await db.query('UPDATE paie.Utilisateur SET MotDePasseHash=@h, Sel=@s WHERE Id=@id', { h: hash, s: salt, id });
  await audit(db, user, 'REINIT_MDP', 'Utilisateur', id, null);
}


// ───────────────────────── Catégories et classes professionnelles ─────────────────────────
const listCategories = async (db) => ({
  categories: await db.query('SELECT Id, Code, Libelle, SalaireMinimum, Actif FROM paie.Categorie ORDER BY Code'),
  classes: await db.query('SELECT Id, Code, Libelle, Actif FROM paie.ClasseProfessionnelle ORDER BY Code'),
});

async function saveCategorie(db, kind, d, user) {
  if (!['categorie', 'classe'].includes(kind)) throw new Error('Type inconnu.');
  const table = kind === 'categorie' ? 'Categorie' : 'ClasseProfessionnelle';
  const libelle = str(d.Libelle, 100);
  if (!libelle) throw new Error('Le libellé est obligatoire.');
  const min = kind === 'categorie' && d.SalaireMinimum !== '' && d.SalaireMinimum != null ? num(d.SalaireMinimum, NaN) : null;
  if (min !== null && (!Number.isFinite(min) || min < 0)) throw new Error('Le salaire minimum doit être un montant positif (ou vide).');
  if (d.Id) {
    if (kind === 'categorie') await db.query('UPDATE paie.Categorie SET Libelle=@l, SalaireMinimum=@m, Actif=@a WHERE Id=@id', { l: libelle, m: min, a: d.Actif ? 1 : 0, id: Number(d.Id) });
    else await db.query('UPDATE paie.ClasseProfessionnelle SET Libelle=@l, Actif=@a WHERE Id=@id', { l: libelle, a: d.Actif ? 1 : 0, id: Number(d.Id) });
  } else {
    const code = String(d.Code || '').trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,20}$/.test(code)) throw new Error('Code : 1 à 20 caractères (lettres, chiffres, . _ -).');
    try {
      if (kind === 'categorie') await db.query('INSERT INTO paie.Categorie (Code, Libelle, SalaireMinimum) VALUES (@c, @l, @m)', { c: code, l: libelle, m: min });
      else await db.query('INSERT INTO paie.ClasseProfessionnelle (Code, Libelle) VALUES (@c, @l)', { c: code, l: libelle });
    } catch (err) {
      if (err && (err.number === 2627 || err.number === 2601)) throw new Error('Ce code existe déjà.');
      throw err;
    }
  }
  await audit(db, user, d.Id ? 'MODIFICATION' : 'CREATION', table, d.Id || null, libelle);
}

// ───────────────────────── Congés et absences ─────────────────────────
const listTypesConge = (db) => db.query('SELECT Id, Code, Libelle, Remunere FROM paie.TypeConge ORDER BY Id');

async function saveTypeConge(db, d, user) {
  const libelle = str(d.Libelle, 100);
  if (!libelle) throw new Error('Le libellé est obligatoire.');
  if (d.Id) {
    await db.query('UPDATE paie.TypeConge SET Libelle=@l, Remunere=@r WHERE Id=@id', { l: libelle, r: d.Remunere ? 1 : 0, id: Number(d.Id) });
  } else {
    const code = String(d.Code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new Error('Code : 2 à 20 caractères (lettres majuscules, chiffres, _).');
    try { await db.query('INSERT INTO paie.TypeConge (Code, Libelle, Remunere) VALUES (@c,@l,@r)', { c: code, l: libelle, r: d.Remunere ? 1 : 0 }); }
    catch (err) { if (err && (err.number === 2627 || err.number === 2601)) throw new Error('Ce code existe déjà.'); throw err; }
  }
  await audit(db, user, d.Id ? 'MODIFICATION' : 'CREATION', 'TypeConge', d.Id || null, libelle);
}

const listConges = (db, f = {}) => db.query(`
  SELECT c.Id, c.EmployeId, e.Matricule, e.Nom, e.Prenom, t.Code AS TypeCode, t.Libelle AS Type, t.Remunere,
         c.DateDebut, c.DateFin, c.NombreJours, c.Statut
  FROM paie.Conge c JOIN paie.Employe e ON e.Id = c.EmployeId JOIN paie.TypeConge t ON t.Id = c.TypeCongeId
  WHERE (@annee IS NULL OR YEAR(c.DateDebut) = @annee) AND (@statut IS NULL OR c.Statut = @statut) AND (@emp IS NULL OR c.EmployeId = @emp)
  ORDER BY c.DateDebut DESC, c.Id DESC`,
  { annee: f.annee ? Number(f.annee) : null, statut: str(f.statut, 20), emp: f.employeId ? Number(f.employeId) : null });

async function paramConge(db, dateIso) {
  const r = await db.query(`SELECT TOP 1 Valeur FROM paie.ParametreLegal WHERE Code = N'CONGE_JOURS_PAR_MOIS'
    AND DateDebut <= @d AND (DateFin IS NULL OR DateFin >= @d) ORDER BY DateDebut DESC`, { d: dateIso });
  if (!r[0]) throw new Error('Paramètre manquant : CONGE_JOURS_PAR_MOIS (Paramètres > Paramètres légaux).');
  return Number(r[0].Valeur);
}

/** Soldes de congés payés de tous les employés actifs à une date. */
async function soldesAt(db, dateIso) {
  const rate = await paramConge(db, dateIso);
  const rows = await db.query(`
    SELECT e.Id AS EmployeId, e.Matricule, e.Nom, e.Prenom, e.DateEmbauche, e.SoldeCongesInitial, e.DateSoldeConges,
      ISNULL((SELECT SUM(c.NombreJours) FROM paie.Conge c JOIN paie.TypeConge t ON t.Id = c.TypeCongeId
              WHERE c.EmployeId = e.Id AND t.Code = N'ANNUEL' AND c.Statut IN (N'APPROUVE', N'PRIS')
                AND c.DateDebut >= ISNULL(e.DateSoldeConges, e.DateEmbauche) AND c.DateDebut <= @d), 0) AS Pris
    FROM paie.Employe e WHERE e.Actif = 1 AND e.DateEmbauche <= @d ORDER BY e.Nom, e.Prenom`, { d: dateIso });
  return rows.map((e) => {
    const depuis = e.DateSoldeConges || e.DateEmbauche;
    return {
      EmployeId: e.EmployeId, Matricule: e.Matricule, Nom: e.Nom, Prenom: e.Prenom, Depuis: depuis, Initial: Number(e.SoldeCongesInitial),
      ...conges.calcSolde({ initial: e.SoldeCongesInitial, depuis, jusqu: dateIso, pris: e.Pris, joursParMois: rate })
    };
  });
}

async function setSoldeInitial(db, employeId, solde, dateIso, user) {
  const v = Number(solde);
  if (!Number.isFinite(v)) throw new Error('Solde invalide.');
  const dt = isoDate(dateIso);
  if (!dt) throw new Error('La date de reprise est obligatoire (AAAA-MM-JJ).');
  await db.query('UPDATE paie.Employe SET SoldeCongesInitial=@s, DateSoldeConges=@d WHERE Id=@id', { s: v, d: dt, id: Number(employeId) });
  await audit(db, user, 'REPRISE_SOLDE_CONGES', 'Employe', Number(employeId), `${v} j au ${dt}`);
}

async function saveConge(db, d, user) {
  const debut = isoDate(d.DateDebut); const fin = isoDate(d.DateFin);
  if (!debut || !fin) throw new Error('Les dates de début et de fin sont obligatoires.');
  if (fin < debut) throw new Error('La date de fin doit être postérieure ou égale à la date de début.');
  const emp = Number(d.EmployeId); const type = Number(d.TypeCongeId);
  if (!emp || !type) throw new Error("L'employé et le type sont obligatoires.");
  const jours = num(d.NombreJours) > 0 ? num(d.NombreJours) : conges.joursOuvrables(debut, fin);
  if (jours <= 0) throw new Error('Le nombre de jours doit être supérieur à 0.');
  const statut = d.Statut === 'APPROUVE' ? 'APPROUVE' : 'DEMANDE';
  const chevauche = await db.query(`SELECT TOP 1 Id FROM paie.Conge WHERE EmployeId = @e AND Statut IN (N'DEMANDE', N'APPROUVE', N'PRIS')
    AND DateDebut <= @fin AND DateFin >= @debut AND (@id IS NULL OR Id <> @id)`, { e: emp, debut, fin, id: d.Id ? Number(d.Id) : null });
  if (chevauche[0]) throw new Error("Cet employé a déjà un congé ou une absence qui chevauche ces dates.");
  let avertissement = null;
  const t = (await db.query('SELECT Code FROM paie.TypeConge WHERE Id = @id', { id: type }))[0];
  if (t && t.Code === 'ANNUEL') {
    const s = (await soldesAt(db, debut)).find((x) => x.EmployeId === emp);
    if (s && jours > s.solde) avertissement = `Solde de congés insuffisant au ${debut.split('-').reverse().join('/')} : ${s.solde} jour(s) disponible(s) pour ${jours} jour(s) demandé(s).`;
  }
  if (d.Id) {
    const cur = (await db.query('SELECT Statut FROM paie.Conge WHERE Id = @id', { id: Number(d.Id) }))[0];
    if (!cur) throw new Error('Demande introuvable.');
    if (cur.Statut !== 'DEMANDE') throw new Error('Seule une demande en attente peut être modifiée.');
    await db.query('UPDATE paie.Conge SET EmployeId=@e, TypeCongeId=@t, DateDebut=@debut, DateFin=@fin, NombreJours=@j, Statut=@s WHERE Id=@id',
      { e: emp, t: type, debut, fin, j: jours, s: statut, id: Number(d.Id) });
  } else {
    await db.query('INSERT INTO paie.Conge (EmployeId, TypeCongeId, DateDebut, DateFin, NombreJours, Statut) VALUES (@e,@t,@debut,@fin,@j,@s)',
      { e: emp, t: type, debut, fin, j: jours, s: statut });
  }
  await audit(db, user, d.Id ? 'MODIFICATION' : 'CREATION', 'Conge', d.Id || null, `emp ${emp} ${debut} → ${fin} (${jours} j, ${statut})`);
  return { avertissement };
}

async function setStatutConge(db, id, statut, user) {
  if (!['APPROUVE', 'REFUSE'].includes(statut)) throw new Error('Statut invalide.');
  await db.query('UPDATE paie.Conge SET Statut = @s WHERE Id = @id', { s: statut, id: Number(id) });
  await audit(db, user, statut === 'APPROUVE' ? 'APPROBATION' : 'REFUS', 'Conge', Number(id), null);
}

async function deleteConge(db, id, user) {
  const cur = (await db.query('SELECT Statut FROM paie.Conge WHERE Id = @id', { id: Number(id) }))[0];
  if (!cur) throw new Error('Demande introuvable.');
  if (!['DEMANDE', 'REFUSE'].includes(cur.Statut)) throw new Error('Une demande approuvée ne peut pas être supprimée : refusez-la (annulation) d\'abord.');
  await db.query('DELETE FROM paie.Conge WHERE Id = @id', { id: Number(id) });
  await audit(db, user, 'SUPPRESSION', 'Conge', Number(id), null);
}

// ───────────────────────── Comptabilité ─────────────────────────
const listPlan = (db) => db.query('SELECT Compte, Libelle, Actif FROM paie.PlanComptable ORDER BY Compte');

async function savePlanCompte(db, d, user) {
  const libelle = str(d.Libelle, 150);
  if (!libelle) throw new Error('Le libellé est obligatoire.');
  const compte = String(d.Compte || '').trim();
  if (!/^[0-9]{1,20}$/.test(compte)) throw new Error('Un numéro de compte ne contient que des chiffres (20 maximum).');
  const ex = (await db.query('SELECT Compte FROM paie.PlanComptable WHERE Compte = @c', { c: compte }))[0];
  if (d.Nouveau && ex) throw new Error('Ce compte existe déjà.');
  if (ex) await db.query('UPDATE paie.PlanComptable SET Libelle=@l, Actif=@a WHERE Compte=@c', { l: libelle, a: d.Actif === false ? 0 : 1, c: compte });
  else await db.query('INSERT INTO paie.PlanComptable (Compte, Libelle) VALUES (@c, @l)', { c: compte, l: libelle });
  await audit(db, user, ex ? 'MODIFICATION' : 'CREATION', 'PlanComptable', null, `${compte} ${libelle}`);
}

const listComptesRubriques = (db) => db.query(`
  SELECT r.Id, r.Code, r.Libelle, r.Type, cr.CompteDebit, cr.CompteCredit
  FROM paie.Rubrique r LEFT JOIN paie.CompteRubrique cr ON cr.RubriqueId = r.Id WHERE r.Actif = 1 ORDER BY r.Ordre, r.Id`);

async function saveCompteRubrique(db, d, user) {
  const deb = str(d.CompteDebit, 20); const cre = str(d.CompteCredit, 20);
  for (const c of [deb, cre]) {
    if (c && !(await db.query('SELECT Compte FROM paie.PlanComptable WHERE Compte = @c AND Actif = 1', { c }))[0]) throw new Error(`Compte inconnu ou inactif : ${c} (ajoutez-le au plan comptable).`);
  }
  const id = Number(d.RubriqueId);
  const ex = (await db.query('SELECT RubriqueId FROM paie.CompteRubrique WHERE RubriqueId = @id', { id }))[0];
  if (ex) await db.query('UPDATE paie.CompteRubrique SET CompteDebit=@d, CompteCredit=@c WHERE RubriqueId=@id', { d: deb, c: cre, id });
  else await db.query('INSERT INTO paie.CompteRubrique (RubriqueId, CompteDebit, CompteCredit) VALUES (@id,@d,@c)', { id, d: deb, c: cre });
  await db.query('UPDATE paie.Rubrique SET CompteComptable = @cc WHERE Id = @id', { cc: deb || cre || null, id });
  await audit(db, user, 'MODIFICATION', 'CompteRubrique', id, `${deb || '-'} / ${cre || '-'}`);
}

const PARAMS_COMPTA_CLES = ['COMPTE_REMUNERATION_DUE', 'CODE_JOURNAL', 'COMPTE_GAIN_DEFAUT', 'COMPTE_RETENUE_DEFAUT', 'COMPTE_COTIS_SAL_DEFAUT',
  'COMPTE_IMPOT_DEFAUT', 'COMPTE_CHARGE_PAT_DEFAUT', 'COMPTE_ORGANISME_PAT_DEFAUT'];
const listParamsCompta = (db) => db.query('SELECT Cle, Valeur FROM paie.ParametreCompta ORDER BY Cle');

async function saveParamCompta(db, cle, valeur, user) {
  if (!PARAMS_COMPTA_CLES.includes(cle)) throw new Error('Paramètre inconnu.');
  const v = str(valeur, 200);
  if (!v) throw new Error('La valeur est obligatoire.');
  if (cle !== 'CODE_JOURNAL' && !(await db.query('SELECT Compte FROM paie.PlanComptable WHERE Compte = @c AND Actif = 1', { c: v }))[0]) throw new Error(`Compte inconnu ou inactif : ${v}`);
  const ex = (await db.query('SELECT Cle FROM paie.ParametreCompta WHERE Cle = @k', { k: cle }))[0];
  if (ex) await db.query('UPDATE paie.ParametreCompta SET Valeur=@v WHERE Cle=@k', { v, k: cle });
  else await db.query('INSERT INTO paie.ParametreCompta (Cle, Valeur) VALUES (@k,@v)', { k: cle, v });
  await audit(db, user, 'MODIFICATION', 'ParametreCompta', null, `${cle} = ${v}`);
}

/** Écritures comptables de paie d'une période (une écriture globale équilibrée). */
async function ecrituresPeriode(db, periodeId) {
  const per = (await db.query('SELECT Id, Annee, Mois, Cloturee FROM paie.PeriodePaie WHERE Id = @id', { id: periodeId }))[0];
  if (!per) throw new Error('Période introuvable.');
  const rows = await db.query(`
    SELECT r.Code, r.Libelle, r.Type, cr.CompteDebit, cr.CompteCredit,
           SUM(l.MontantGain) AS Gain, SUM(l.MontantRetenue) AS Ret, SUM(l.MontantPatronal) AS Pat
    FROM paie.LigneBulletin l JOIN paie.BulletinPaie b ON b.Id = l.BulletinId JOIN paie.Rubrique r ON r.Id = l.RubriqueId
    LEFT JOIN paie.CompteRubrique cr ON cr.RubriqueId = r.Id
    WHERE b.PeriodeId = @p GROUP BY r.Code, r.Libelle, r.Type, r.Ordre, cr.CompteDebit, cr.CompteCredit ORDER BY r.Ordre`, { p: periodeId });
  if (!rows.length) return { periode: per, vide: true, lignes: [], totalDebit: 0, totalCredit: 0, equilibre: true, sansCompte: [] };
  const net = (await db.query('SELECT ISNULL(SUM(Net), 0) AS n FROM paie.BulletinPaie WHERE PeriodeId = @p', { p: periodeId }))[0].n;
  const params = Object.fromEntries((await listParamsCompta(db)).map((x) => [x.Cle, x.Valeur]));
  const plan = Object.fromEntries((await listPlan(db)).map((x) => [x.Compte, x.Libelle]));
  const e = compta.buildEcritures({ rows, netTotal: Number(net), params, plan });
  const { fin } = monthBounds(per.Annee, per.Mois);
  return { periode: per, date: fin, journal: params.CODE_JOURNAL || 'OD', piece: `PAIE-${per.Annee}-${String(per.Mois).padStart(2, '0')}`, ...e };
}

async function reversementsPeriode(db, periodeId) {
  const rows = await db.query(`SELECT r.Code, SUM(l.MontantRetenue) AS Ret, SUM(l.MontantPatronal) AS Pat
    FROM paie.LigneBulletin l JOIN paie.BulletinPaie b ON b.Id = l.BulletinId JOIN paie.Rubrique r ON r.Id = l.RubriqueId
    WHERE b.PeriodeId = @p GROUP BY r.Code`, { p: periodeId });
  return compta.regrouperReversements(rows);
}

const virementsPeriode = (db, periodeId) => db.query(`
  SELECT e.Matricule, e.Nom, e.Prenom, e.ModePaiement, e.Banque, e.NumeroCompte, b.Net
  FROM paie.BulletinPaie b JOIN paie.Employe e ON e.Id = b.EmployeId WHERE b.PeriodeId = @p ORDER BY e.Nom, e.Prenom`, { p: periodeId });

module.exports = {
  audit, monthBounds,
  listEmployes, getEmploye, saveEmploye, deactivateEmploye, listRubriquesSaisie,
  listRubriques, saveRubrique, listEmployeRubriques, saveEmployeRubrique, closeEmployeRubrique, deleteEmployeRubrique,
  listCategories, saveCategorie, listTypesConge, saveTypeConge, listConges, saveConge, setStatutConge, deleteConge, soldesAt, setSoldeInitial,
  listPlan, savePlanCompte, listComptesRubriques, saveCompteRubrique, listParamsCompta, saveParamCompta, ecrituresPeriode, reversementsPeriode, virementsPeriode, getOrCreatePeriode, findPeriode, cloturerPeriode, listVariables, saveVariable, deleteVariable, listPresences, savePresence, deletePresence,
  calculerPeriode, journal, getBulletins, unverifiedCount,
  listParams, saveRow, deleteRow, getEntreprise, saveEntreprise,
  ROLES, needsAdmin, listUsers, createUser, setUserActive, resetPassword,
};
