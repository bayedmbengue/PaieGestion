/* PaieGestion — migration 05 : remboursement de prêt échelonné et base de la retenue (brut imposable / net après impôt).
   À exécuter UNE SEULE FOIS dans SSMS (base PaieGestion sélectionnée). Sans danger si relancé.
   L'application l'exécute aussi toute seule au démarrage si elle en a le droit. */

IF OBJECT_ID(N'paie.Rubrique', N'U') IS NULL
BEGIN
  RAISERROR(N'Sélectionnez la base PaieGestion (barre d''outils de SSMS) avant d''exécuter ce script.', 16, 1);
  RETURN;
END;

IF COL_LENGTH(N'paie.Rubrique', N'BaseRetenue') IS NULL
  EXEC (N'ALTER TABLE paie.Rubrique ADD BaseRetenue NVARCHAR(20) NOT NULL CONSTRAINT DF_Rubrique_BaseRetenue DEFAULT N''NET_APRES_IMPOT''');
IF OBJECT_ID(N'paie.CK_Rubrique_BaseRetenue', N'C') IS NULL
  EXEC (N'ALTER TABLE paie.Rubrique ADD CONSTRAINT CK_Rubrique_BaseRetenue CHECK (BaseRetenue IN (N''NET_APRES_IMPOT'', N''BRUT_IMPOSABLE''))');

IF COL_LENGTH(N'paie.Rubrique', N'Echelonne') IS NULL
BEGIN
  EXEC (N'ALTER TABLE paie.Rubrique ADD Echelonne BIT NOT NULL CONSTRAINT DF_Rubrique_Echelonne DEFAULT 0');
  EXEC (N'UPDATE paie.Rubrique SET Echelonne = 1 WHERE Code = N''PRET''');
END;

IF COL_LENGTH(N'paie.EmployeRubrique', N'MontantPret') IS NULL
  EXEC (N'ALTER TABLE paie.EmployeRubrique ADD MontantPret DECIMAL(18,2) NULL');
IF COL_LENGTH(N'paie.EmployeRubrique', N'DureeMois') IS NULL
  EXEC (N'ALTER TABLE paie.EmployeRubrique ADD DureeMois SMALLINT NULL');
