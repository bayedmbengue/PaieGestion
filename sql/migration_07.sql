/* PaieGestion — migration 07 : rubriques proratisées selon les jours travaillés (jours / 26).
   - Colonne paie.Rubrique.ProrataJours (1 = le montant est multiplié par jours travaillés / 26) ;
     activée sur tous les gains SAUF logement, congé, retraite, prime incitative, prime de performance ;
   - Table paie.PresencePeriode : jours travaillés par employé et par période (vide = mois complet) ;
   - Paramètre JOURS_REFERENCE_MOIS = 26.
   À exécuter UNE SEULE FOIS dans SSMS (base PaieGestion sélectionnée). Sans danger si relancé.
   L'application l'exécute aussi toute seule au démarrage si elle en a le droit. */

IF OBJECT_ID(N'paie.Rubrique', N'U') IS NULL
BEGIN
  RAISERROR(N'Sélectionnez la base PaieGestion (barre d''outils de SSMS) avant d''exécuter ce script.', 16, 1);
  RETURN;
END;

IF COL_LENGTH(N'paie.Rubrique', N'ProrataJours') IS NULL
BEGIN
  EXEC (N'ALTER TABLE paie.Rubrique ADD ProrataJours BIT NOT NULL CONSTRAINT DF_Rubrique_ProrataJours DEFAULT 0');
  EXEC (N'UPDATE paie.Rubrique SET ProrataJours = 1
          WHERE Type = N''GAIN'' AND EstSysteme = 0 AND Code <> N''SALBASE''
            AND Libelle COLLATE Latin1_General_100_CI_AI NOT LIKE N''%logement%''
            AND Libelle COLLATE Latin1_General_100_CI_AI NOT LIKE N''%conge%''
            AND Libelle COLLATE Latin1_General_100_CI_AI NOT LIKE N''%retraite%''
            AND Libelle COLLATE Latin1_General_100_CI_AI NOT LIKE N''%incitative%''
            AND Libelle COLLATE Latin1_General_100_CI_AI NOT LIKE N''%performance%''');
END;

IF OBJECT_ID(N'paie.PresencePeriode', N'U') IS NULL
  CREATE TABLE paie.PresencePeriode (
    EmployeId INT NOT NULL REFERENCES paie.Employe(Id),
    PeriodeId INT NOT NULL REFERENCES paie.PeriodePaie(Id),
    JoursTravailles DECIMAL(5,1) NOT NULL,
    CONSTRAINT PK_PresencePeriode PRIMARY KEY (EmployeId, PeriodeId)
  );

IF NOT EXISTS (SELECT 1 FROM paie.ParametreLegal WHERE Code = N'JOURS_REFERENCE_MOIS')
  INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie)
  VALUES (N'JOURS_REFERENCE_MOIS', N'Nombre de jours de référence d''un mois complet (proratisation des rubriques selon les jours travaillés)',
          26, '2026-01-01', N'Pratique de l''entreprise (bulletin type : 122 959 x 18 / 26 = 85 125)', 1);
