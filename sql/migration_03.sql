/* PaieGestion — migration 03 : module autonome « Rubriques de paie » et affectations employé-rubrique datées.
   À exécuter UNE SEULE FOIS dans SSMS, après avoir sélectionné la base PaieGestion dans la barre d'outils.
   100 % idempotent : sans danger si relancé ; conserve intégralement les primes fixes existantes. */

IF OBJECT_ID(N'paie.Rubrique', N'U') IS NULL OR OBJECT_ID(N'paie.EmployeRubrique', N'U') IS NULL
BEGIN
  RAISERROR(N'Sélectionnez la base PaieGestion (barre d''outils de SSMS) avant d''exécuter ce script.', 16, 1);
  RETURN;
END;

-- 1. Évolution de paie.Rubrique (chaque reprise initiale ne s'exécute que lors de la création de la colonne)
IF COL_LENGTH(N'paie.Rubrique', N'EstSysteme') IS NULL
BEGIN
  EXEC (N'ALTER TABLE paie.Rubrique ADD EstSysteme BIT NOT NULL CONSTRAINT DF_Rubrique_EstSysteme DEFAULT 0');
  EXEC (N'UPDATE paie.Rubrique SET EstSysteme = 1
          WHERE Type IN (N''COTIS_SAL'', N''COTIS_PAT'', N''IMPOT'') OR Code IN (N''SALBASE'', N''ABS_NR'')');
END;

IF COL_LENGTH(N'paie.Rubrique', N'ModeCalcul') IS NULL
BEGIN
  EXEC (N'ALTER TABLE paie.Rubrique ADD ModeCalcul NVARCHAR(20) NOT NULL CONSTRAINT DF_Rubrique_ModeCalcul DEFAULT N''FIXE''');
  EXEC (N'UPDATE paie.Rubrique SET ModeCalcul = N''AUTO''
          WHERE EstSysteme = 1 OR Type IN (N''COTIS_SAL'', N''COTIS_PAT'', N''IMPOT'') OR Code IN (N''SALBASE'', N''ABS_NR'')');
  EXEC (N'UPDATE paie.Rubrique SET ModeCalcul = N''VARIABLE''
          WHERE EstSysteme = 0 AND Code IN (N''HEURES_SUP'', N''PRIME_EXC'', N''AVANCE'', N''PRET'', N''ABSENCE'')');
END;

IF OBJECT_ID(N'paie.CK_Rubrique_ModeCalcul', N'C') IS NULL
  EXEC (N'ALTER TABLE paie.Rubrique ADD CONSTRAINT CK_Rubrique_ModeCalcul CHECK (ModeCalcul IN (N''FIXE'', N''POURCENTAGE'', N''VARIABLE'', N''AUTO''))');

IF COL_LENGTH(N'paie.Rubrique', N'SoumisCfceTrimf') IS NULL
BEGIN
  EXEC (N'ALTER TABLE paie.Rubrique ADD SoumisCfceTrimf BIT NOT NULL CONSTRAINT DF_Rubrique_SoumisCfceTrimf DEFAULT 1');
  EXEC (N'UPDATE paie.Rubrique SET SoumisCfceTrimf = CASE WHEN Type = N''GAIN'' THEN Imposable ELSE 0 END');
END;

IF COL_LENGTH(N'paie.Rubrique', N'PlafondExoneration') IS NULL
BEGIN
  EXEC (N'ALTER TABLE paie.Rubrique ADD PlafondExoneration DECIMAL(18,2) NULL');
  EXEC (N'UPDATE r SET PlafondExoneration = p.Valeur
          FROM paie.Rubrique r
          CROSS APPLY (
            SELECT TOP 1 Valeur FROM paie.ParametreLegal
            WHERE Code = N''EXO_'' + r.Code AND DateFin IS NULL AND Valeur > 0
            ORDER BY DateDebut DESC
          ) p
          WHERE r.Type = N''GAIN''');
END;

IF COL_LENGTH(N'paie.Rubrique', N'CompteComptable') IS NULL
BEGIN
  EXEC (N'ALTER TABLE paie.Rubrique ADD CompteComptable NVARCHAR(20) NULL');
  IF OBJECT_ID(N'paie.CompteRubrique', N'U') IS NOT NULL
    EXEC (N'UPDATE r SET CompteComptable = COALESCE(cr.CompteDebit, cr.CompteCredit)
            FROM paie.Rubrique r
            JOIN paie.CompteRubrique cr ON cr.RubriqueId = r.Id');
END;

-- Garantir le marquage système même si une rubrique système a été insérée après coup
EXEC (N'UPDATE paie.Rubrique SET EstSysteme = 1, ModeCalcul = N''AUTO''
        WHERE Type IN (N''COTIS_SAL'', N''COTIS_PAT'', N''IMPOT'') OR Code IN (N''SALBASE'', N''ABS_NR'')');

-- 2. Table d'affectation employé-rubrique (paie.EmployeRubrique) : conservation & enrichissement des primes fixes existantes
IF COL_LENGTH(N'paie.EmployeRubrique', N'Actif') IS NULL
  EXEC (N'ALTER TABLE paie.EmployeRubrique ADD Actif BIT NOT NULL CONSTRAINT DF_EmpRub_Actif DEFAULT 1');

IF COL_LENGTH(N'paie.EmployeRubrique', N'Commentaire') IS NULL
  EXEC (N'ALTER TABLE paie.EmployeRubrique ADD Commentaire NVARCHAR(200) NULL');

-- Normalisation défensive des primes fixes existantes (sans doublon ni suppression)
EXEC (N'UPDATE er SET DateFin = er.DateDebut
        FROM paie.EmployeRubrique er
        WHERE er.DateFin IS NOT NULL AND er.DateFin < er.DateDebut');

IF OBJECT_ID(N'paie.CK_EmpRub_Dates', N'C') IS NULL
  EXEC (N'ALTER TABLE paie.EmployeRubrique ADD CONSTRAINT CK_EmpRub_Dates CHECK (DateFin IS NULL OR DateFin >= DateDebut)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_EmpRub_Periode' AND object_id = OBJECT_ID(N'paie.EmployeRubrique'))
  EXEC (N'CREATE INDEX IX_EmpRub_Periode ON paie.EmployeRubrique(EmployeId, Actif, DateDebut, DateFin)');

PRINT N'Migration 03 terminée.';
