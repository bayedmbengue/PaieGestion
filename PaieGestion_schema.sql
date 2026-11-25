/* =====================================================================
   PaieGestion - Application de gestion de la paie (Sénégal)
   Serveur : DELL-PMBENGUE   |   Base : PaieGestion
   Exécuter dans SSMS / Azure Data Studio / extension mssql de VS Code
   ATTENTION : toutes les valeurs légales insérées plus bas sont
   INDICATIVES (Verifie = 0). Les confirmer auprès de la DGID, de
   l'IPRES et de la CSS avant toute utilisation en production.
   ===================================================================== */

USE PaieGestion;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'paie')
    EXEC('CREATE SCHEMA paie');
GO

/* ---------------------------------------------------------------------
   1. ORGANISATION
   --------------------------------------------------------------------- */
CREATE TABLE paie.Departement (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_Departement PRIMARY KEY,
    Code        NVARCHAR(20)  NOT NULL CONSTRAINT UQ_Departement_Code UNIQUE,
    Libelle     NVARCHAR(100) NOT NULL
);

CREATE TABLE paie.Poste (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_Poste PRIMARY KEY,
    Libelle     NVARCHAR(100) NOT NULL CONSTRAINT UQ_Poste_Libelle UNIQUE
);
GO

/* ---------------------------------------------------------------------
   2. EMPLOYÉS ET CONTRATS
   --------------------------------------------------------------------- */
CREATE TABLE paie.Employe (
    Id                  INT IDENTITY(1,1) CONSTRAINT PK_Employe PRIMARY KEY,
    Matricule           NVARCHAR(20)  NOT NULL CONSTRAINT UQ_Employe_Matricule UNIQUE,
    Nom                 NVARCHAR(100) NOT NULL,
    Prenom              NVARCHAR(100) NOT NULL,
    Sexe                CHAR(1)       NULL CONSTRAINT CK_Employe_Sexe CHECK (Sexe IN ('M','F')),
    DateNaissance       DATE          NULL,
    LieuNaissance       NVARCHAR(100) NULL,
    Nationalite         NVARCHAR(50)  NULL DEFAULT N'Sénégalaise',
    NumeroCNI           NVARCHAR(30)  NULL,
    Telephone           NVARCHAR(30)  NULL,
    Adresse             NVARCHAR(200) NULL,
    SituationFamiliale  CHAR(1)       NOT NULL DEFAULT 'C'
                        CONSTRAINT CK_Employe_SitFam CHECK (SituationFamiliale IN ('C','M','D','V')), -- Célibataire, Marié, Divorcé, Veuf
    NombreEnfants       TINYINT       NOT NULL DEFAULT 0,
    NombreParts         DECIMAL(3,1)  NOT NULL DEFAULT 1.0,   -- quotient familial (IR)
    EstCadre            BIT           NOT NULL DEFAULT 0,     -- cotisation IPRES régime complémentaire
    NumeroIPRES         NVARCHAR(30)  NULL,
    NumeroCSS           NVARCHAR(30)  NULL,
    ModePaiement        NVARCHAR(20)  NOT NULL DEFAULT N'VIREMENT'
                        CONSTRAINT CK_Employe_ModePaiement CHECK (ModePaiement IN (N'VIREMENT', N'ESPECES', N'CHEQUE', N'MOBILE')),
    Banque              NVARCHAR(100) NULL,
    NumeroCompte        NVARCHAR(40)  NULL,
    DepartementId       INT           NULL CONSTRAINT FK_Employe_Departement REFERENCES paie.Departement(Id),
    PosteId             INT           NULL CONSTRAINT FK_Employe_Poste REFERENCES paie.Poste(Id),
    DateEmbauche        DATE          NOT NULL,
    DateSortie          DATE          NULL,
    Actif               BIT           NOT NULL DEFAULT 1,
    DateCreation        DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

CREATE TABLE paie.Contrat (
    Id                  INT IDENTITY(1,1) CONSTRAINT PK_Contrat PRIMARY KEY,
    EmployeId           INT           NOT NULL CONSTRAINT FK_Contrat_Employe REFERENCES paie.Employe(Id),
    TypeContrat         NVARCHAR(20)  NOT NULL
                        CONSTRAINT CK_Contrat_Type CHECK (TypeContrat IN (N'CDI', N'CDD', N'STAGE', N'JOURNALIER', N'CONSULTANT')),
    DateDebut           DATE          NOT NULL,
    DateFin             DATE          NULL,
    SalaireBase         DECIMAL(18,2) NOT NULL CONSTRAINT CK_Contrat_Salaire CHECK (SalaireBase >= 0),
    Categorie           NVARCHAR(20)  NULL,
    Echelon             NVARCHAR(20)  NULL,
    HeuresMensuelles    DECIMAL(6,2)  NOT NULL DEFAULT 173.33,
    EstActif            BIT           NOT NULL DEFAULT 1
);
CREATE INDEX IX_Contrat_Employe ON paie.Contrat(EmployeId, EstActif);
GO

/* ---------------------------------------------------------------------
   3. PARAMÈTRES LÉGAUX (jamais codés en dur dans l'application)
   --------------------------------------------------------------------- */
CREATE TABLE paie.ParametreLegal (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_ParametreLegal PRIMARY KEY,
    Code        NVARCHAR(50)  NOT NULL,
    Libelle     NVARCHAR(200) NOT NULL,
    Valeur      DECIMAL(18,4) NOT NULL,
    DateDebut   DATE          NOT NULL,
    DateFin     DATE          NULL,
    Source      NVARCHAR(200) NULL,
    Verifie     BIT           NOT NULL DEFAULT 0,   -- passer à 1 après contrôle officiel
    CONSTRAINT CK_ParametreLegal_Dates CHECK (DateFin IS NULL OR DateFin >= DateDebut)
);
CREATE UNIQUE INDEX UX_ParametreLegal ON paie.ParametreLegal(Code, DateDebut);

/* Barème annuel de l'impôt sur le revenu (par tranches) */
CREATE TABLE paie.BaremeIR (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_BaremeIR PRIMARY KEY,
    TrancheMin  DECIMAL(18,2) NOT NULL,
    TrancheMax  DECIMAL(18,2) NULL,                 -- NULL = sans limite
    Taux        DECIMAL(5,2)  NOT NULL,             -- en %
    DateDebut   DATE          NOT NULL,
    DateFin     DATE          NULL,
    Verifie     BIT           NOT NULL DEFAULT 0
);

/* Barème TRIMF (contribution forfaitaire) : à renseigner selon le CGI en vigueur */
CREATE TABLE paie.BaremeTRIMF (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_BaremeTRIMF PRIMARY KEY,
    SalaireMin  DECIMAL(18,2) NOT NULL,
    SalaireMax  DECIMAL(18,2) NULL,
    Montant     DECIMAL(18,2) NOT NULL,
    DateDebut   DATE          NOT NULL,
    DateFin     DATE          NULL,
    Verifie     BIT           NOT NULL DEFAULT 0
);
GO

/* ---------------------------------------------------------------------
   4. RUBRIQUES DE PAIE
   --------------------------------------------------------------------- */
CREATE TABLE paie.Rubrique (
    Id                INT IDENTITY(1,1) CONSTRAINT PK_Rubrique PRIMARY KEY,
    Code              NVARCHAR(30)  NOT NULL CONSTRAINT UQ_Rubrique_Code UNIQUE,
    Libelle           NVARCHAR(100) NOT NULL,
    Type              NVARCHAR(20)  NOT NULL
                      CONSTRAINT CK_Rubrique_Type CHECK (Type IN (N'GAIN', N'RETENUE', N'COTIS_SAL', N'COTIS_PAT', N'IMPOT')),
    Imposable         BIT           NOT NULL DEFAULT 1,   -- entre dans l'assiette de l'IR
    SoumisCotisation  BIT           NOT NULL DEFAULT 1,   -- entre dans l'assiette IPRES/CSS
    Ordre             INT           NOT NULL DEFAULT 100, -- ordre d'affichage sur le bulletin
    Actif             BIT           NOT NULL DEFAULT 1
);

/* Éléments récurrents attribués à un employé (primes fixes, indemnités...) */
CREATE TABLE paie.EmployeRubrique (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_EmployeRubrique PRIMARY KEY,
    EmployeId   INT NOT NULL CONSTRAINT FK_EmpRub_Employe REFERENCES paie.Employe(Id),
    RubriqueId  INT NOT NULL CONSTRAINT FK_EmpRub_Rubrique REFERENCES paie.Rubrique(Id),
    Montant     DECIMAL(18,2) NULL,
    Taux        DECIMAL(9,4)  NULL,
    DateDebut   DATE NOT NULL,
    DateFin     DATE NULL
);
CREATE INDEX IX_EmpRub_Employe ON paie.EmployeRubrique(EmployeId);
GO

/* ---------------------------------------------------------------------
   5. PÉRIODES, VARIABLES ET BULLETINS
   --------------------------------------------------------------------- */
CREATE TABLE paie.PeriodePaie (
    Id            INT IDENTITY(1,1) CONSTRAINT PK_PeriodePaie PRIMARY KEY,
    Annee         SMALLINT NOT NULL,
    Mois          TINYINT  NOT NULL CONSTRAINT CK_Periode_Mois CHECK (Mois BETWEEN 1 AND 12),
    Cloturee      BIT      NOT NULL DEFAULT 0,
    DateCloture   DATETIME2 NULL,
    CONSTRAINT UQ_Periode UNIQUE (Annee, Mois)
);

/* Variables du mois : heures sup, absences, primes exceptionnelles... */
CREATE TABLE paie.VariablePaie (
    Id          INT IDENTITY(1,1) CONSTRAINT PK_VariablePaie PRIMARY KEY,
    EmployeId   INT NOT NULL CONSTRAINT FK_Var_Employe REFERENCES paie.Employe(Id),
    PeriodeId   INT NOT NULL CONSTRAINT FK_Var_Periode REFERENCES paie.PeriodePaie(Id),
    RubriqueId  INT NOT NULL CONSTRAINT FK_Var_Rubrique REFERENCES paie.Rubrique(Id),
    Quantite    DECIMAL(9,2)  NULL,
    Montant     DECIMAL(18,2) NULL,
    Commentaire NVARCHAR(200) NULL
);
CREATE INDEX IX_Var_EmpPeriode ON paie.VariablePaie(EmployeId, PeriodeId);

CREATE TABLE paie.BulletinPaie (
    Id                      INT IDENTITY(1,1) CONSTRAINT PK_BulletinPaie PRIMARY KEY,
    EmployeId               INT NOT NULL CONSTRAINT FK_Bulletin_Employe REFERENCES paie.Employe(Id),
    PeriodeId               INT NOT NULL CONSTRAINT FK_Bulletin_Periode REFERENCES paie.PeriodePaie(Id),
    SalaireBase             DECIMAL(18,2) NOT NULL,
    Brut                    DECIMAL(18,2) NOT NULL,
    BaseImposable           DECIMAL(18,2) NOT NULL DEFAULT 0,
    BaseIPRES               DECIMAL(18,2) NOT NULL DEFAULT 0,
    TotalCotisSalariales    DECIMAL(18,2) NOT NULL DEFAULT 0,
    TotalCotisPatronales    DECIMAL(18,2) NOT NULL DEFAULT 0,
    ImpotRevenu             DECIMAL(18,2) NOT NULL DEFAULT 0,
    TRIMF                   DECIMAL(18,2) NOT NULL DEFAULT 0,
    AutresRetenues          DECIMAL(18,2) NOT NULL DEFAULT 0,
    Net                     DECIMAL(18,2) NOT NULL,
    CoutEmployeur           DECIMAL(18,2) NOT NULL DEFAULT 0,
    NombreParts             DECIMAL(3,1)  NOT NULL DEFAULT 1.0,
    DateCalcul              DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_Bulletin UNIQUE (EmployeId, PeriodeId)
);

/* Chaque ligne conserve le taux utilisé au moment du calcul (historique intangible) */
CREATE TABLE paie.LigneBulletin (
    Id               INT IDENTITY(1,1) CONSTRAINT PK_LigneBulletin PRIMARY KEY,
    BulletinId       INT NOT NULL CONSTRAINT FK_Ligne_Bulletin REFERENCES paie.BulletinPaie(Id) ON DELETE CASCADE,
    RubriqueId       INT NULL CONSTRAINT FK_Ligne_Rubrique REFERENCES paie.Rubrique(Id),
    Libelle          NVARCHAR(100) NOT NULL,
    Base             DECIMAL(18,2) NULL,
    Taux             DECIMAL(9,4)  NULL,
    MontantGain      DECIMAL(18,2) NOT NULL DEFAULT 0,
    MontantRetenue   DECIMAL(18,2) NOT NULL DEFAULT 0,
    MontantPatronal  DECIMAL(18,2) NOT NULL DEFAULT 0,
    Ordre            INT NOT NULL DEFAULT 100
);
CREATE INDEX IX_Ligne_Bulletin ON paie.LigneBulletin(BulletinId);
GO

/* ---------------------------------------------------------------------
   6. PRÊTS / AVANCES ET CONGÉS
   --------------------------------------------------------------------- */
CREATE TABLE paie.Pret (
    Id               INT IDENTITY(1,1) CONSTRAINT PK_Pret PRIMARY KEY,
    EmployeId        INT NOT NULL CONSTRAINT FK_Pret_Employe REFERENCES paie.Employe(Id),
    TypePret         NVARCHAR(20) NOT NULL CONSTRAINT CK_Pret_Type CHECK (TypePret IN (N'AVANCE', N'PRET')),
    MontantTotal     DECIMAL(18,2) NOT NULL CONSTRAINT CK_Pret_Montant CHECK (MontantTotal > 0),
    NombreEcheances  SMALLINT NOT NULL CONSTRAINT CK_Pret_Ech CHECK (NombreEcheances > 0),
    DateOctroi       DATE NOT NULL,
    Solde            DECIMAL(18,2) NOT NULL,
    Actif            BIT NOT NULL DEFAULT 1
);

CREATE TABLE paie.EcheancePret (
    Id            INT IDENTITY(1,1) CONSTRAINT PK_EcheancePret PRIMARY KEY,
    PretId        INT NOT NULL CONSTRAINT FK_Ech_Pret REFERENCES paie.Pret(Id) ON DELETE CASCADE,
    PeriodeId     INT NULL CONSTRAINT FK_Ech_Periode REFERENCES paie.PeriodePaie(Id),
    DateEcheance  DATE NOT NULL,
    Montant       DECIMAL(18,2) NOT NULL,
    Payee         BIT NOT NULL DEFAULT 0
);

CREATE TABLE paie.TypeConge (
    Id        INT IDENTITY(1,1) CONSTRAINT PK_TypeConge PRIMARY KEY,
    Code      NVARCHAR(20)  NOT NULL CONSTRAINT UQ_TypeConge_Code UNIQUE,
    Libelle   NVARCHAR(100) NOT NULL,
    Remunere  BIT NOT NULL DEFAULT 1
);

CREATE TABLE paie.Conge (
    Id            INT IDENTITY(1,1) CONSTRAINT PK_Conge PRIMARY KEY,
    EmployeId     INT NOT NULL CONSTRAINT FK_Conge_Employe REFERENCES paie.Employe(Id),
    TypeCongeId   INT NOT NULL CONSTRAINT FK_Conge_Type REFERENCES paie.TypeConge(Id),
    DateDebut     DATE NOT NULL,
    DateFin       DATE NOT NULL,
    NombreJours   DECIMAL(5,1) NOT NULL,
    Statut        NVARCHAR(20) NOT NULL DEFAULT N'DEMANDE'
                  CONSTRAINT CK_Conge_Statut CHECK (Statut IN (N'DEMANDE', N'APPROUVE', N'REFUSE', N'PRIS')),
    CONSTRAINT CK_Conge_Dates CHECK (DateFin >= DateDebut)
);
GO

/* ---------------------------------------------------------------------
   7. SÉCURITÉ ET AUDIT
   --------------------------------------------------------------------- */
CREATE TABLE paie.Role (
    Id        INT IDENTITY(1,1) CONSTRAINT PK_Role PRIMARY KEY,
    Code      NVARCHAR(30)  NOT NULL CONSTRAINT UQ_Role_Code UNIQUE,
    Libelle   NVARCHAR(100) NOT NULL
);

/* Le mot de passe n'est JAMAIS stocké en clair : hash + sel générés par l'application
   (ex. PBKDF2 / Argon2). */
CREATE TABLE paie.Utilisateur (
    Id               INT IDENTITY(1,1) CONSTRAINT PK_Utilisateur PRIMARY KEY,
    Login            NVARCHAR(50)  NOT NULL CONSTRAINT UQ_Utilisateur_Login UNIQUE,
    NomComplet       NVARCHAR(150) NOT NULL,
    MotDePasseHash   VARBINARY(128) NOT NULL,
    Sel              VARBINARY(32)  NOT NULL,
    RoleId           INT NOT NULL CONSTRAINT FK_Utilisateur_Role REFERENCES paie.Role(Id),
    Actif            BIT NOT NULL DEFAULT 1,
    DernierLogin     DATETIME2 NULL
);

CREATE TABLE paie.JournalAudit (
    Id            BIGINT IDENTITY(1,1) CONSTRAINT PK_JournalAudit PRIMARY KEY,
    DateAction    DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UtilisateurId INT NULL CONSTRAINT FK_Audit_Utilisateur REFERENCES paie.Utilisateur(Id),
    Action        NVARCHAR(50)  NOT NULL,     -- ex. CREATION, MODIFICATION, CLOTURE
    Entite        NVARCHAR(50)  NOT NULL,     -- ex. Employe, BulletinPaie
    EntiteId      INT NULL,
    Details       NVARCHAR(MAX) NULL
);
CREATE INDEX IX_Audit_Date ON paie.JournalAudit(DateAction);
GO

/* ---------------------------------------------------------------------
   8. DONNÉES INITIALES
   --------------------------------------------------------------------- */

-- Rôles
INSERT INTO paie.Role (Code, Libelle) VALUES
 (N'ADMIN',      N'Administrateur'),
 (N'GESTIONNAIRE', N'Gestionnaire de paie'),
 (N'COMPTABLE',  N'Comptable (lecture et états)'),
 (N'LECTEUR',    N'Lecture seule');

-- Types de congé
INSERT INTO paie.TypeConge (Code, Libelle, Remunere) VALUES
 (N'ANNUEL',    N'Congé annuel', 1),
 (N'MALADIE',   N'Congé maladie', 1),
 (N'MATERNITE', N'Congé de maternité', 1),
 (N'SANSSOLDE', N'Congé sans solde', 0),
 (N'EXCEPT',    N'Permission exceptionnelle', 1);

-- Paramètres légaux INDICATIFS (à vérifier avant production)
INSERT INTO paie.ParametreLegal (Code, Libelle, Valeur, DateDebut, Source, Verifie) VALUES
 (N'IPRES_RG_SAL',      N'IPRES régime général - part salariale (%)',   5.6,      '2026-01-01', N'Source secondaire - à vérifier IPRES', 0),
 (N'IPRES_RG_PAT',      N'IPRES régime général - part patronale (%)',   8.4,      '2026-01-01', N'Source secondaire - à vérifier IPRES', 0),
 (N'IPRES_RG_PLAFOND',  N'IPRES régime général - plafond mensuel',      432000,   '2026-01-01', N'Source secondaire - à vérifier IPRES', 0),
 (N'IPRES_RCC_SAL',     N'IPRES régime complémentaire cadre - salarié (%)',  2.4, '2026-01-01', N'Source secondaire - à vérifier IPRES', 0),
 (N'IPM_SAL',  N'IPM (salarié)', N'COTIS_SAL', 0, 0, 215),
 (N'IPRES_RCC_PAT',     N'IPRES régime complémentaire cadre - employeur (%)',3.6, '2026-01-01', N'Source secondaire - à vérifier IPRES', 0),
 (N'IPM_PAT',  N'IPM (employeur)', N'COTIS_PAT', 0, 0, 515),
 (N'IPRES_RCC_PLAFOND', N'IPRES régime complémentaire cadre - plafond mensuel', 1296000, '2026-01-01', N'Source secondaire - à vérifier IPRES', 0),
 (N'CSS_PF_PAT',        N'CSS prestations familiales - employeur (%)',  7.0,      '2026-01-01', N'Source secondaire - à vérifier CSS', 0),
 (N'CSS_ATMP_PAT',      N'CSS accidents du travail - employeur (%) (1 à 5 selon secteur)', 1.0, '2026-01-01', N'Taux dépend du secteur - à vérifier CSS', 0),
 (N'CSS_PLAFOND',       N'CSS - plafond mensuel',                       63000,    '2026-01-01', N'Source secondaire - à vérifier CSS', 0),
 (N'CFCE_PAT',          N'CFCE - employeur (%)',                        3.0,      '2026-01-01', N'Source secondaire - à vérifier DGID', 0),
 (N'SMIG_MENSUEL',      N'SMIG mensuel',                                76827,    '2026-01-01', N'Source secondaire - à vérifier', 0),
 (N'ABATTEMENT_IR',     N'Abattement forfaitaire sur la base IR (%)',   30,       '2026-01-01', N'Source secondaire - à vérifier CGI', 0);

-- Barème IR annuel INDICATIF (à vérifier dans le CGI en vigueur)
INSERT INTO paie.BaremeIR (TrancheMin, TrancheMax, Taux, DateDebut, Verifie) VALUES
 (0,        630000,   0,  '2026-01-01', 1),
 (630000,   1500000,  20, '2026-01-01', 1),
 (1500000,  4000000,  30, '2026-01-01', 1),
 (4000000,  8000000,  35, '2026-01-01', 1),
 (8000000,  13500000, 37, '2026-01-01', 1),
 (13500000, 50000000, 40, '2026-01-01', 1),
 (50000000, NULL,     43, '2026-01-01', 1);

-- Barème TRIMF : volontairement vide, à renseigner depuis le CGI en vigueur.

-- Rubriques standard
INSERT INTO paie.Rubrique (Code, Libelle, Type, Imposable, SoumisCotisation, Ordre) VALUES
 (N'SALBASE',   N'Salaire de base',                  N'GAIN',      1, 1, 10),
 (N'PRIME_ANC', N'Prime d''ancienneté',              N'GAIN',      1, 1, 20),
 (N'PRIME_TRANS', N'Indemnité de transport',         N'GAIN',      1, 1, 30),
 (N'PRIME_LOG', N'Indemnité de logement',            N'GAIN',      1, 1, 40),
 (N'HEURES_SUP', N'Heures supplémentaires',          N'GAIN',      1, 1, 50),
 (N'PRIME_EXC', N'Prime exceptionnelle',             N'GAIN',      1, 1, 60),
 (N'AVANTAGE_NAT', N'Avantages en nature',           N'GAIN',      1, 1, 70),
 (N'IPRES_RG_SAL',  N'IPRES régime général (salarié)', N'COTIS_SAL', 0, 0, 200),
 (N'IPRES_RCC_SAL', N'IPRES régime cadre (salarié)',   N'COTIS_SAL', 0, 0, 210),
 (N'IR',        N'Impôt sur le revenu',              N'IMPOT',     0, 0, 300),
 (N'TRIMF',     N'TRIMF',                            N'IMPOT',     0, 0, 310),
 (N'AVANCE',    N'Remboursement avance',             N'RETENUE',   0, 0, 400),
 (N'PRET',      N'Remboursement prêt',               N'RETENUE',   0, 0, 410),
 (N'ABSENCE',   N'Retenue pour absence',             N'RETENUE',   0, 0, 420),
 (N'IPRES_RG_PAT',  N'IPRES régime général (employeur)', N'COTIS_PAT', 0, 0, 500),
 (N'IPRES_RCC_PAT', N'IPRES régime cadre (employeur)',   N'COTIS_PAT', 0, 0, 510),
 (N'CSS_PF_PAT',    N'CSS prestations familiales',       N'COTIS_PAT', 0, 0, 520),
 (N'CSS_ATMP_PAT',  N'CSS accidents du travail',         N'COTIS_PAT', 0, 0, 530),
 (N'CFCE_PAT',      N'CFCE',                             N'COTIS_PAT', 0, 0, 540);
GO

/* ---------------------------------------------------------------------
   9. VUE UTILE : journal de paie d'une période
   --------------------------------------------------------------------- */
CREATE VIEW paie.vw_JournalPaie AS
SELECT  p.Annee, p.Mois,
        e.Matricule, e.Nom, e.Prenom,
        b.Brut, b.TotalCotisSalariales, b.ImpotRevenu, b.TRIMF,
        b.AutresRetenues, b.Net, b.TotalCotisPatronales, b.CoutEmployeur
FROM    paie.BulletinPaie b
JOIN    paie.Employe      e ON e.Id = b.EmployeId
JOIN    paie.PeriodePaie  p ON p.Id = b.PeriodeId;
GO

PRINT 'Base PaieGestion initialisée avec succès.';
GO
