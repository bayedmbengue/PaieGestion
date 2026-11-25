/* PaieGestion — migration 04 : cumul annuel de l'IR et de la TRIMF, régularisation de départ (solde de tout compte).
   À exécuter UNE SEULE FOIS dans SSMS, après avoir sélectionné la base PaieGestion dans la barre d'outils.
   Sans danger si relancé. (L'application l'exécute aussi toute seule au démarrage si elle en a le droit.) */

IF OBJECT_ID(N'paie.BulletinPaie', N'U') IS NULL
BEGIN
  RAISERROR(N'Sélectionnez la base PaieGestion (barre d''outils de SSMS) avant d''exécuter ce script.', 16, 1);
  RETURN;
END;

IF COL_LENGTH(N'paie.BulletinPaie', N'BrutImposable') IS NULL
  EXEC (N'ALTER TABLE paie.BulletinPaie ADD BrutImposable DECIMAL(18,2) NULL');
IF COL_LENGTH(N'paie.BulletinPaie', N'BrutCfceTrimf') IS NULL
  EXEC (N'ALTER TABLE paie.BulletinPaie ADD BrutCfceTrimf DECIMAL(18,2) NULL');

IF NOT EXISTS (SELECT 1 FROM paie.ParametreLegal WHERE Code = N'IR_SORTIE_MODE')
  INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
  VALUES (N'IR_SORTIE_MODE', N'IR au départ en cours d''année : 1 = impôt sur le revenu réellement perçu ; 2 = revenu moyen annualisé au prorata des mois',
          1, '2026-01-01', N'Règle de régularisation à confirmer avec votre comptable / la DGID', 0);
