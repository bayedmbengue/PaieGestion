/* PaieGestion — migration 06 : plafonds de la réduction d'impôt pour charges de famille (barème fourni par le client).
   3 parts : 1 650 000 ; 3,5 parts : 2 030 000 ; 4 parts : 2 490 000 ; 4,5 parts : 2 755 000.
   À exécuter UNE SEULE FOIS dans SSMS (base PaieGestion sélectionnée). Sans danger si relancé.
   L'application l'exécute aussi toute seule au démarrage si elle en a le droit. */
UPDATE paie.ParametreLegal SET Valeur = 1650000, Verifie = 1, Source = N'Barème charges de famille fourni par le client' WHERE Code = N'RED_FAM_3_MAX'   AND DateFin IS NULL;
UPDATE paie.ParametreLegal SET Valeur = 2030000, Verifie = 1, Source = N'Barème charges de famille fourni par le client' WHERE Code = N'RED_FAM_3.5_MAX' AND DateFin IS NULL;
UPDATE paie.ParametreLegal SET Valeur = 2490000, Verifie = 1, Source = N'Barème charges de famille fourni par le client' WHERE Code = N'RED_FAM_4_MAX'   AND DateFin IS NULL;
UPDATE paie.ParametreLegal SET Valeur = 2755000, Verifie = 1, Source = N'Barème charges de famille fourni par le client' WHERE Code = N'RED_FAM_4.5_MAX' AND DateFin IS NULL;
