/* PaieGestion — compte SQL dédié pour l'application (à exécuter UNE fois dans SSMS, en administrateur).
   L'application Electron se connecte par TCP avec un compte SQL (login/mot de passe) :
   l'authentification Windows intégrée de SSMS n'est pas utilisable par ce type d'application.
   Changez le mot de passe ci-dessous avant d'exécuter ! */

USE master;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'paie_app')
    CREATE LOGIN paie_app WITH PASSWORD = N'Changez-Moi-1!', CHECK_POLICY = ON;
GO

USE PaieGestion;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'paie_app')
    CREATE USER paie_app FOR LOGIN paie_app;
ALTER ROLE db_datareader ADD MEMBER paie_app;
ALTER ROLE db_datawriter ADD MEMBER paie_app;
GO

/* Table complémentaire créée ici (en administrateur) pour que l'application n'ait besoin d'aucun droit de création. */
IF OBJECT_ID(N'paie.Entreprise', N'U') IS NULL
BEGIN
  CREATE TABLE paie.Entreprise (
    Id INT NOT NULL CONSTRAINT PK_Entreprise PRIMARY KEY CONSTRAINT CK_Entreprise_Id CHECK (Id = 1),
    Nom NVARCHAR(150) NOT NULL, Adresse NVARCHAR(200) NULL, Ville NVARCHAR(100) NULL,
    Telephone NVARCHAR(50) NULL, NINEA NVARCHAR(50) NULL,
    NumeroIPRES NVARCHAR(50) NULL, NumeroCSS NVARCHAR(50) NULL
  );
END;
IF NOT EXISTS (SELECT 1 FROM paie.Entreprise) INSERT INTO paie.Entreprise (Id, Nom) VALUES (1, N'Mon entreprise');
GO
PRINT 'Compte paie_app prêt.';
