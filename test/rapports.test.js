'use strict';
// Tests du module « Rapports » : calculs/agrégations purs, CSV, HTML PDF, lecture seule/paramétrage SQL, rôles & preload.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { buildReport, reportToCsv, reportToHtml, REPORT_TYPES } = require('../src/main/rapports');
const rapportsRepo = require('../src/main/rapportsRepo');
const { createWebHost } = require('../src/web/webhost');

const BULLETINS = [
  {
    Annee: 2026, Mois: 1, Id: 1, EmployeId: 10, Matricule: 'M001', Nom: 'DIOP', Prenom: 'Awa', Categorie: 'HC',
    SalaireBase: 500000, Brut: 600000, BaseImposable: 574000, BaseIPRES: 432000,
    TotalCotisSalariales: 50468, ImpotRevenu: 95000, TRIMF: 1000, AutresRetenues: 0,
    Net: 453532, TotalCotisPatronales: 95220, CoutEmployeur: 695220, NombreParts: 2,
  },
  {
    Annee: 2026, Mois: 1, Id: 2, EmployeId: 11, Matricule: 'M002', Nom: 'NDIAYE', Prenom: 'Moussa', Categorie: '5',
    SalaireBase: 250000, Brut: 276000, BaseImposable: 250000, BaseIPRES: 250000,
    TotalCotisSalariales: 26500, ImpotRevenu: 18000, TRIMF: 400, AutresRetenues: 10000,
    Net: 221100, TotalCotisPatronales: 48540, CoutEmployeur: 324540, NombreParts: 1,
  },
  {
    Annee: 2026, Mois: 2, Id: 3, EmployeId: 10, Matricule: 'M001', Nom: 'DIOP', Prenom: 'Awa', Categorie: 'HC',
    SalaireBase: 500000, Brut: 620000, BaseImposable: 594000, BaseIPRES: 432000,
    TotalCotisSalariales: 50948, ImpotRevenu: 101000, TRIMF: 1000, AutresRetenues: 5000,
    Net: 462052, TotalCotisPatronales: 96540, CoutEmployeur: 716540, NombreParts: 2,
  },
];

// ───────────── 1. Fonctions pures (buildReport, CSV, HTML) ─────────────

test('journal de paie mensuel : totaux, CSV (BOM, ;) et HTML A4 paysage', () => {
  const rep = buildReport('journal', BULLETINS.slice(0, 2), { annee: 2026, mois: 1 }, { categorieLabel: 'Toutes' });
  assert.equal(rep.rows.length, 2);
  assert.equal(rep.totals.Brut, 876000);
  assert.equal(rep.totals.Net, 674632);
  assert.equal(rep.totals.CoutEmployeur, 1019760);
  assert.equal(rep.filenameBase, 'Journal_paie_2026-01');

  const csv = reportToCsv(rep);
  assert.ok(csv.startsWith('\uFEFF"Matricule";"Nom";"Prénom"'));
  assert.match(csv, /"M001";"DIOP";"Awa";"HC";"500000";"600000"/);
  assert.match(csv, /"Total \(2\)";"";"";"";"750000";"876000"/);

  const html = reportToHtml(rep, { Nom: 'Société <Test> & Co', NINEA: '123456' }, '2026-11-24');
  assert.match(html, /@page \{ size: A4 landscape;/);
  assert.match(html, /Société &lt;Test&gt; &amp; Co/);        // échappement XSS
  assert.match(html, /<title>Journal de paie mensuel<\/title>/);
  assert.match(html, /24\/11\/2026/);
});

test('récapitulatif annuel : regroupement par mois + détail employé, et vue par employé', () => {
  const repMois = buildReport('annuel', BULLETINS, { annee: 2026, moisDebut: 1, moisFin: 12, vue: 'mois' });
  assert.equal(repMois.rows.length, 2);                       // Janvier et Février
  assert.equal(repMois.rows[0].Effectif, 2);
  assert.equal(repMois.rows[0].Brut, 876000);
  assert.equal(repMois.rows[1].Effectif, 1);
  assert.equal(repMois.rows[1].Brut, 620000);
  assert.equal(repMois.totals.Brut, 1496000);
  assert.equal(repMois.totals.Effectif, 3);
  assert.ok(repMois.secondaryTable);
  assert.equal(repMois.secondaryTable.rows.length, 2);        // DIOP (2 mois) et NDIAYE (1 mois)
  const diop = repMois.secondaryTable.rows.find((r) => r.Matricule === 'M001');
  assert.equal(diop.NbMois, 2);
  assert.equal(diop.Brut, 1220000);

  const repEmp = buildReport('annuel', BULLETINS, { annee: 2026, moisDebut: 1, moisFin: 6, vue: 'employe' });
  assert.equal(repEmp.rows.length, 2);
  assert.equal(repEmp.secondaryTable, null);
  assert.equal(repEmp.totals.Net, 1136684);
  assert.equal(repEmp.filenameBase, 'Recapitulatif_annuel_2026-01_06_employe');
});

test('états IPRES / CSS / IPM : calculs nominatifs, filtres organisme et synthèse cohérente', () => {
  const raw = [
    {
      EmployeId: 10, Matricule: 'M001', Nom: 'DIOP', Prenom: 'Awa', EstCadre: 1, NumeroIPRES: 'IP-1', NumeroCSS: 'CS-1', Categorie: 'HC',
      Brut: 894500, BaseImposable: 868500, BaseIPRES: 432000,
      IpresRgSal: 24192, IpresRgPat: 36288, IpresRccSal: 20844, IpresRccPat: 31266,
      CssPfPat: 4410, CssAtmpPat: 630, IpmSal: 12500, IpmPat: 15000,
    },
  ];
  const repTous = buildReport('cotisations', raw, { annee: 2026, moisDebut: 10, moisFin: 10, organisme: 'TOUS' });
  assert.equal(repTous.rows[0].TotalIpres, 24192 + 36288 + 20844 + 31266);
  assert.equal(repTous.rows[0].TotalCss, 4410 + 630);
  assert.equal(repTous.rows[0].TotalIpm, 12500 + 15000);
  assert.equal(repTous.rows[0].TotalGeneral, 145130);
  assert.equal(repTous.secondaryTable.totals.Total, 145130);  // synthèse = total nominatif

  const repIpres = buildReport('cotisations', raw, { annee: 2026, moisDebut: 10, moisFin: 10, organisme: 'IPRES' });
  assert.equal(repIpres.secondaryTable.rows.length, 2);       // RG + RCC uniquement
  assert.equal(repIpres.secondaryTable.totals.Total, 112590);
  assert.equal(repIpres.filenameBase, 'Etat_IPRES_2026-10');

  const repCss = buildReport('cotisations', raw, { annee: 2026, moisDebut: 10, moisFin: 10, organisme: 'CSS' });
  assert.equal(repCss.secondaryTable.totals.Total, 5040);

  const repIpm = buildReport('cotisations', raw, { annee: 2026, moisDebut: 10, moisFin: 10, organisme: 'IPM' });
  assert.equal(repIpm.secondaryTable.totals.Total, 27500);
});

test('état IR / TRIMF / CFCE, historique employé, liste employés et congés/soldes', () => {
  const imp = buildReport('impots', [
    { EmployeId: 10, Matricule: 'M001', Nom: 'DIOP', Prenom: 'Awa', SituationFamiliale: 'M', NombreParts: 2.5, Categorie: 'HC', NbMois: 1, Brut: 894500, BaseImposable: 868500, ImpotRevenu: 180446, TRIMF: 3000, CfcePat: 26055 },
  ], { annee: 2026, moisDebut: 10, moisFin: 10 });
  assert.equal(imp.rows[0].Situation, 'Marié(e)');
  assert.equal(imp.rows[0].TotalImpots, 209501);
  assert.equal(imp.totals.TotalImpots, 209501);

  const hist = buildReport('historique', BULLETINS.filter((b) => b.EmployeId === 10), { annee: 2026, moisDebut: 1, moisFin: 12 });
  assert.equal(hist.rows.length, 2);
  assert.equal(hist.rows[0].Periode, 'Janvier 2026');
  assert.equal(hist.totals.Brut, 1220000);

  const emps = buildReport('employes', [
    { Matricule: 'M001', Nom: 'DIOP', Prenom: 'Awa', Sexe: 'F', Poste: 'Directrice', Departement: 'DG', Categorie: 'HC', Echelon: 'A', EstCadre: 1, TypeContrat: 'CDI', DateEmbauche: '2024-01-15', DateSortie: null, SituationFamiliale: 'M', NombreEnfants: 2, NombreParts: 2.5, NumeroIPRES: 'IP1', NumeroCSS: 'CS1', ModePaiement: 'VIREMENT', SalaireBase: 500000, Actif: 1 },
    { Matricule: 'M002', Nom: 'SOW', Prenom: 'Ibra', Sexe: 'M', Poste: 'Agent', Departement: 'Ops', Categorie: '4', Echelon: null, EstCadre: 0, TypeContrat: 'CDD', DateEmbauche: '2025-03-01', DateSortie: null, SituationFamiliale: 'C', NombreEnfants: 0, NombreParts: 1, NumeroIPRES: null, NumeroCSS: null, ModePaiement: 'ESPECES', SalaireBase: 150000, Actif: 1 },
  ], { actif: '1' });
  assert.equal(emps.totals.SalaireBase, 650000);
  assert.equal(emps.kpis[1].value, '1');                      // 1 cadre

  const cgDem = buildReport('conges', {
    demandes: [
      { Matricule: 'M001', Nom: 'DIOP', Prenom: 'Awa', Categorie: 'HC', Type: 'Congé annuel', Remunere: 1, DateDebut: '2026-08-03', DateFin: '2026-08-08', NombreJours: 6, Statut: 'APPROUVE' },
      { Matricule: 'M002', Nom: 'SOW', Prenom: 'Ibra', Categorie: '4', Type: 'Sans solde', Remunere: 0, DateDebut: '2026-09-01', DateFin: '2026-09-02', NombreJours: 2, Statut: 'APPROUVE' },
    ],
  }, { dateDebut: '2026-01-01', dateFin: '2026-12-31', vue: 'demandes' });
  assert.equal(cgDem.totals.NombreJours, 8);
  assert.equal(cgDem.kpis[1].value, '6 j');
  assert.equal(cgDem.kpis[2].value, '2 j');

  const cgSol = buildReport('conges', {
    soldes: [{ Matricule: 'M001', Nom: 'DIOP', Prenom: 'Awa', Categorie: 'HC', Depuis: '2026-01-01', Initial: 5, acquis: 20, pris: 6, solde: 19 }],
  }, { dateFin: '2026-10-31', vue: 'soldes' });
  assert.equal(cgSol.totals.solde, 19);

  assert.throws(() => buildReport('inconnu', []), /inconnu/);
});

// ───────────── 2. Requêtes SQL : strictement lecture seule et paramétrées ─────────────

test('rapportsRepo.js ne contient aucune instruction SQL d\'écriture ni DDL', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'rapportsRepo.js'), 'utf8');
  assert.doesNotMatch(src, /\b(INSERT\s+INTO|UPDATE\s+paie\.|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE|TRUNCATE\s+TABLE|EXEC\s*\()/i);
});

test('tous les rapports exécutent uniquement des SELECT paramétrés et normalisent les bornes', async () => {
  const calls = [];
  const fakeDb = {
    query: async (sql, params) => {
      calls.push({ sql: sql.trim(), params });
      if (/FROM paie\.ParametreLegal/.test(sql)) return [{ Valeur: 2 }];
      if (/FROM paie\.Employe WHERE Id = @id/.test(sql)) return [{ Matricule: 'M1', Nom: 'DIOP', Prenom: 'Awa' }];
      if (/FROM paie\.Categorie WHERE Code = @c/.test(sql)) return [{ Code: 'HC', Libelle: 'Hors catégorie' }];
      return [];
    },
  };

  // Vérification inversion de bornes + injection tentative dans categorie/statut
  const inj = "HC'; DROP TABLE paie.Employe; --";
  const norm = rapportsRepo.normalizeFilters('annuel', { annee: 2026, moisDebut: 10, moisFin: 3, dateDebut: '2026-12-01', dateFin: '2026-02-01', categorie: inj, statut: "APPROUVE' OR 1=1" });
  assert.equal(norm.moisDebut, 3);
  assert.equal(norm.moisFin, 10);
  assert.equal(norm.dateDebut, '2026-02-01');
  assert.equal(norm.dateFin, '2026-12-01');
  assert.equal(norm.statut, null);                            // liste blanche stricte

  await rapportsRepo.getFilterOptions(fakeDb);
  for (const t of REPORT_TYPES) {
    await rapportsRepo.runReport(fakeDb, t, { annee: 2026, mois: 5, moisDebut: 1, moisFin: 12, employeId: 7, categorie: inj, dateDebut: '2026-01-01', dateFin: '2026-12-31' });
  }
  await rapportsRepo.runReport(fakeDb, 'conges', { dateFin: '2026-10-31', vue: 'soldes', categorie: 'HC' });

  assert.ok(calls.length >= 10);
  for (const c of calls) {
    assert.match(c.sql, /^SELECT\b/i, `Requête non-SELECT détectée : ${c.sql.slice(0, 60)}`);
    assert.doesNotMatch(c.sql, /DROP TABLE/i, 'Injection trouvée dans le SQL !');
  }
});

// ───────────── 3. Préload, rôles et exports via WebHost ─────────────

test('preload.js expose les 4 canaux rapport:* dans sa liste blanche', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const ch of ['rapport:filters', 'rapport:data', 'rapport:csv', 'rapport:pdf']) {
    assert.ok(preload.includes(`'${ch}'`), `Canal absent de preload.js : ${ch}`);
  }
});

test('rôles et exports rapport:* via createWebHost (LECTEUR vs COMPTABLE)', async () => {
  const fakeDb = {
    cfg: { server: 'x', port: 1433, database: 'PaieGestion' },
    query: async (sql) => {
      if (/FROM paie\.Entreprise/.test(sql)) return [{ Nom: 'Atelier Dakar', NINEA: '999' }];
      if (/FROM paie\.BulletinPaie b/.test(sql)) return BULLETINS.slice(0, 1);
      return [];
    },
    close: async () => {},
  };
  const fakeConfig = { loadConfig: () => ({ cfg: { server: 'x', database: 'PaieGestion' } }), saveConfig: () => ({ encrypted: true }), publicView: (c) => c };
  const host = createWebHost({ config: fakeConfig, Database: { test: async () => ({ ok: true }) }, openDatabase: async () => fakeDb, cleanCfg: (i) => i });
  await host.init();
  const port = await host.listen();

  const call = (channel, args = []) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ channel, args });
    const r = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/call',
      headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json', Cookie: `paie=${host.token}` },
    }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    r.on('error', reject); r.write(body); r.end();
  });

  try {
    // Non connecté : refusé
    assert.match((await call('rapport:data', ['journal', { annee: 2026, mois: 1 }])).error, /Session expirée/);

    // LECTEUR : lecture autorisée, exports CSV et PDF refusés
    host.setUserForTests({ id: 2, login: 'lect', nom: 'Lecteur', role: 'LECTEUR' });
    const dataLect = await call('rapport:data', ['journal', { annee: 2026, mois: 1 }]);
    assert.equal(dataLect.ok, true);
    assert.equal(dataLect.data.rows.length, 1);
    assert.match((await call('rapport:csv', ['journal', { annee: 2026, mois: 1 }])).error, /Droits insuffisants/);
    assert.match((await call('rapport:pdf', ['journal', { annee: 2026, mois: 1 }])).error, /Droits insuffisants/);

    // COMPTABLE : exports CSV et PDF (printHtml) autorisés
    host.setUserForTests({ id: 3, login: 'compta', nom: 'Comptable', role: 'COMPTABLE' });
    const csvRes = await call('rapport:csv', ['journal', { annee: 2026, mois: 1 }]);
    assert.equal(csvRes.ok, true);
    assert.equal(csvRes.data.download.name, 'Journal_paie_2026-01.csv');
    const csvText = Buffer.from(csvRes.data.download.base64, 'base64').toString('utf8');
    assert.ok(csvText.startsWith('\uFEFF"Matricule";"Nom"'));

    const pdfRes = await call('rapport:pdf', ['journal', { annee: 2026, mois: 1 }]);
    assert.equal(pdfRes.ok, true);
    assert.equal(pdfRes.data.name, 'Journal_paie_2026-01.pdf');
    assert.match(pdfRes.data.printHtml, /Atelier Dakar/);
    assert.match(pdfRes.data.printHtml, /Journal de paie mensuel/);

    // Rapport vide → erreur explicite à l'export
    const emptyRes = await call('rapport:csv', ['employes', {}]);
    assert.equal(emptyRes.ok, false);
    assert.match(emptyRes.error, /Aucune donnée à exporter/);
  } finally {
    await host.close();
  }
});
