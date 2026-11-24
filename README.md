# PaieGestion Desktop — gestion de la paie (Sénégal)

Application Windows hors ligne : **Electron + SQL Server**, même technologie que ImmoGestion.
Aucun logiciel supplémentaire à installer si ImmoGestion fonctionne déjà chez vous (Node.js).

## 1. Préparer SQL Server (une seule fois)
1. Le script `PaieGestion_schema.sql` doit avoir été exécuté sur la base `PaieGestion` (c'est fait chez vous).
2. L'application n'utilise **pas** l'authentification Windows de SSMS. Il faut un compte SQL :
   * SSMS → clic droit sur le serveur → Propriétés → Sécurité → **« Mode d'authentification SQL Server et Windows »** → redémarrer le service SQL Server.
   * Gestionnaire de configuration SQL Server → Protocoles → **TCP/IP activé** (port 1433).
   * Modifiez le mot de passe dans `Creer_compte_SQL.sql`, puis exécutez-le dans SSMS : il crée le compte `paie_app`.

## 2. Lancer
```
npm install      # si le dossier node_modules n'est pas présent (ou copiez celui d'ImmoGestion)
npm start
```
1er lancement : écran de connexion SQL (serveur `DELL-PMBENGUE` ou `localhost`, base `PaieGestion`, compte `paie_app`) ;
puis création du compte administrateur de l'application.

## 2 bis. Lancer SANS Electron (si Windows bloque electron.exe)
Certains postes (Smart App Control, AppLocker, stratégie d'entreprise) empêchent de lancer `electron.exe`. Dans ce cas :
```
npm run web            # ou double-clic sur Lancer_PaieGestion_Web.bat
```
Un petit serveur local démarre et l'application s'ouvre dans une fenêtre Edge/Chrome « application » (sans barre d'adresse). Aucun réglage de sécurité de Windows n'est modifié : seuls `node.exe` et Microsoft Edge sont utilisés.
* Le serveur n'écoute que sur 127.0.0.1, avec un jeton secret différent à chaque lancement (cookie HttpOnly, SameSite=Strict) ; il s'arrête tout seul quand la fenêtre est fermée.
* **Bulletins** : bouton PDF → fenêtre d'impression du navigateur → choisir « Enregistrer au format PDF ». **Exports CSV** : fichiers placés dans le dossier Téléchargements.
* Le mot de passe SQL est protégé par Windows (DPAPI, lié à votre session) ; s'il ne peut pas l'être, il est redemandé à chaque lancement (jamais écrit en clair).

## 3. Utiliser
* **Employés** : fiche complète, contrat, primes fixes.
* **Paie mensuelle** : choisir le mois → *Variables du mois* (heures sup., absences…) → *Calculer la paie* → *Détail* / *PDF* par employé ou tous → *Clôturer*.
* **Paramètres** : taux et plafonds IPRES/CSS/CFCE, barème IR, barème TRIMF, entreprise, utilisateurs (admin).
  Toute valeur marquée « non vérifiée » déclenche un avertissement au calcul.

Rôles : Administrateur (tout) · Gestionnaire de paie (employés, paie) · Comptable (lecture + exports) · Lecture seule.

## 4. Installeur Windows
```
npm run dist     # → dist/PaieGestion Setup 1.0.0.exe (fonctionne sans internet)
```

## 5. Mise à jour du 22/11 : parts IR/TRIMF et IPM
* Une colonne `ConjointTravaille` est ajoutée à la table des employés. Si l'application n'a pas le droit de la créer, elle affiche la ligne SQL à exécuter dans SSMS :
  `ALTER TABLE paie.Employe ADD ConjointTravaille BIT NOT NULL CONSTRAINT DF_Employe_ConjointTravaille DEFAULT 0;`
* IPM : 5 % salarié (plafonné à 12 500 FCFA/mois) / 6 % employeur (plafonné à 15 000), paramètres `IPM_*`.
* Calcul recoupé avec un bulletin de référence (octobre 2026, cadre marié, 2 enfants, conjoint sans revenus) : tous les montants sont retrouvés au franc près (test automatique). Règles confirmées : IPRES cadre sur tout le salaire jusqu'à 1 296 000 ; IR calculé sur le brut imposable annualisé, sans déduction des cotisations ; TRIMF doublée si le conjoint ne travaille pas ; CFCE sur le brut imposable.
* Base de toutes les retenues (IPRES, IPM, CSS), de la CFCE et de la TRIMF = **brut imposable** (salaire total − exonérations). Transport exonéré jusqu'à 26 000 FCFA/mois (paramètre `EXO_PRIME_TRANS`), l'excédent est imposable.
* Onglet **Paramètres > Rubriques de paie** : créer vos primes (sursalaire, prime de responsabilité…), dire si elles sont imposables, et fixer un plafond d'exonération mensuel.

## 6. Modules congés/absences, comptabilité, catégories (mise à jour du 23/11)
**Avant de relancer** : exécutez UNE FOIS `sql/migration_02.sql` dans SSMS (base PaieGestion sélectionnée). Il ajoute les tables et colonnes nécessaires ; sans danger si relancé.
* **Congés et absences** : demandes (en attente / approuvé / refusé), soldes de congés payés (acquis par mois de service, reprise de solde), types de congé (rémunéré ou non). Une absence **non rémunérée approuvée** est retenue automatiquement sur la paie (salaire de base ÷ 30 × jours) et réduit le brut. Le solde de congés figure sur le bulletin.
* **Comptabilité** : écriture de paie du mois (équilibrée) exportable en CSV, montants à reverser par organisme (IPRES, CSS, IPM, IR, TRIMF, CFCE), ordre de virement CSV, plan comptable et compte de chaque rubrique modifiables. Comptes SYSCOHADA proposés : à faire valider par votre comptable.
* **Catégories et classes professionnelles** (Paramètres) : listes modifiables, choisies dans la fiche employé et imprimées sur le bulletin ; salaire minimum facultatif par catégorie (avertissement si dépassé par le bas).
* Paramètres à confirmer : `CONGE_JOURS_PAR_MOIS` (2 jours ouvrables par mois) et `ABSENCE_DIVISEUR` (30).

## 7. Points d'attention
* **Valeurs légales indicatives** (`Verifie = 0`) et **méthode de calcul de l'IR indicative** : à faire valider par un comptable / la DGID avant tout usage réel.
* **TRIMF** : barème annuel du support de cours IR/CFCE/TRIMF (900 → 36 000 FCFA/an) chargé automatiquement, retenu par douzième. La règle d'articulation avec l'IR est le paramètre `TRIMF_REGLE` (à confirmer). **CFCE** : 3 % des éléments imposables. **IR** : abattement 30 % plafonné à 900 000 FCFA/an, barème à 7 tranches, puis réduction d'impôt pour charges de famille (parts calculées automatiquement : tableau p. 31 du support de cours). Les pourcentages et minimum/maximum de cette réduction (paramètres `RED_FAM_*`) sont à CONFIRMER : seuls 2, 2,5 et 5 parts ont pu être recoupés.
* Pas encore géré : prêts/avances (tables prêtes), congés, soldes de tout compte, déclarations IPRES/CSS au format officiel.
* Cette application a été testée (`npm test`, 57 tests : calculs, mots de passe, bulletin, flux de calcul avec base simulée) mais **pas contre un vrai SQL Server ni dans la fenêtre Electron** : validez-la sur votre poste et signalez toute erreur.
