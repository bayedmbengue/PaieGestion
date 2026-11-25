'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bulletinsDocument } = require('../src/main/bulletin');

test('le bulletin contient les montants et échappe le HTML', () => {
  const data = {
    periode: { Annee: 2026, Mois: 11 }, entreprise: { Nom: 'ACME <SARL>' },
    bulletins: [{
      Nom: 'DIOP', Prenom: 'Awa', Matricule: 'M001', DateEmbauche: '2024-03-01', SituationFamiliale: 'M', NombreEnfants: 2, NombreParts: 2.5, EstCadre: 0,
      ModePaiement: 'VIREMENT', Brut: 300000, TotalCotisSalariales: 16800, ImpotRevenu: 36472, TRIMF: 0, AutresRetenues: 0, Net: 246728,
      TotalCotisPatronales: 39240, CoutEmployeur: 339240,
      lignes: [
        { Libelle: 'Salaire de base', Base: null, Taux: null, MontantGain: 300000, MontantRetenue: 0, MontantPatronal: 0 },
        { Libelle: 'IPRES', Base: 300000, Taux: 5.6, MontantGain: 0, MontantRetenue: 16800, MontantPatronal: 0 },
      ],
    }],
  };
  const html = bulletinsDocument(data);
  assert.match(html, /novembre 2026/);
  assert.match(html, /246 728 FCFA/);
  assert.match(html, /ACME &lt;SARL&gt;/);
  assert.doesNotMatch(html, /<SARL>/);
  assert.match(html, /5,6 %/);
});
