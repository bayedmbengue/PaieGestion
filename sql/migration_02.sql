/* PaieGestion — migration 02 : congés et absences, catégories et classes professionnelles, comptabilité.
   À exécuter UNE SEULE FOIS dans SSMS, après avoir sélectionné la base PaieGestion dans la barre d'outils.
   Sans danger si relancé : tout ce qui existe déjà est conservé. */

IF OBJECT_ID(N'paie.Employe', N'U') IS NULL
BEGIN
  RAISERROR(N'Sélectionnez la base PaieGestion (barre d''outils de SSMS) avant d''exécuter ce script.', 16, 1);
  RETURN;
END;

-- Colonnes ajoutées à la table des employés
IF COL_LENGTH(N'paie.Employe', N'ConjointTravaille') IS NULL
  EXEC (N'ALTER TABLE paie.Employe ADD ConjointTravaille BIT NOT NULL CONSTRAINT DF_Employe_ConjointTravaille DEFAULT 0');
IF COL_LENGTH(N'paie.Employe', N'SoldeCongesInitial') IS NULL
  EXEC (N'ALTER TABLE paie.Employe ADD SoldeCongesInitial DECIMAL(6,1) NOT NULL CONSTRAINT DF_Employe_SoldeConges DEFAULT 0');
IF COL_LENGTH(N'paie.Employe', N'DateSoldeConges') IS NULL
  EXEC (N'ALTER TABLE paie.Employe ADD DateSoldeConges DATE NULL');

-- Catégories et classes professionnelles
IF OBJECT_ID(N'paie.Categorie', N'U') IS NULL
  CREATE TABLE paie.Categorie (
    Id INT IDENTITY(1,1) CONSTRAINT PK_Categorie PRIMARY KEY,
    Code NVARCHAR(20) NOT NULL CONSTRAINT UQ_Categorie_Code UNIQUE,
    Libelle NVARCHAR(100) NOT NULL,
    SalaireMinimum DECIMAL(18,2) NULL,
    Actif BIT NOT NULL CONSTRAINT DF_Categorie_Actif DEFAULT 1
  );
IF OBJECT_ID(N'paie.ClasseProfessionnelle', N'U') IS NULL
  CREATE TABLE paie.ClasseProfessionnelle (
    Id INT IDENTITY(1,1) CONSTRAINT PK_ClasseProfessionnelle PRIMARY KEY,
    Code NVARCHAR(20) NOT NULL CONSTRAINT UQ_Classe_Code UNIQUE,
    Libelle NVARCHAR(100) NOT NULL,
    Actif BIT NOT NULL CONSTRAINT DF_Classe_Actif DEFAULT 1
  );

-- Comptabilité
IF OBJECT_ID(N'paie.PlanComptable', N'U') IS NULL
  CREATE TABLE paie.PlanComptable (
    Compte NVARCHAR(20) NOT NULL CONSTRAINT PK_PlanComptable PRIMARY KEY,
    Libelle NVARCHAR(150) NOT NULL,
    Actif BIT NOT NULL CONSTRAINT DF_PlanComptable_Actif DEFAULT 1
  );
IF OBJECT_ID(N'paie.CompteRubrique', N'U') IS NULL
  CREATE TABLE paie.CompteRubrique (
    RubriqueId INT NOT NULL CONSTRAINT PK_CompteRubrique PRIMARY KEY
      CONSTRAINT FK_CompteRubrique_Rubrique REFERENCES paie.Rubrique(Id),
    CompteDebit NVARCHAR(20) NULL,
    CompteCredit NVARCHAR(20) NULL
  );
IF OBJECT_ID(N'paie.ParametreCompta', N'U') IS NULL
  CREATE TABLE paie.ParametreCompta (
    Cle NVARCHAR(50) NOT NULL CONSTRAINT PK_ParametreCompta PRIMARY KEY,
    Valeur NVARCHAR(200) NOT NULL
  );

PRINT N'Migration 02 terminée.';
