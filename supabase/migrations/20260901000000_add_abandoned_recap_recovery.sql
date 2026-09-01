-- Sprint Abandoned-Recap-Recovery (2026-09-01).
--
-- Problème corrigé : un bilan mensuel démarré, dans lequel l'utilisateur a
-- réellement puisé (tirelire et/ou économies cumulées) pour éponger un déficit,
-- puis jamais terminé, devient STRUCTURELLEMENT invisible au franchissement du
-- 1er du mois. Toutes les lectures serveur filtrent sur l'égalité stricte
-- (recap_month, recap_year) = getRecapPeriod() :
--   lib/recap/check-status.ts (profil + groupe), lib/recap/active-recap.ts,
--   app/api/monthly-recap/complete/route.ts, et start_monthly_recap elle-même.
-- La ligne reste donc `completed_at IS NULL` à vie, et l'argent débité par
-- executeRefloatFromPiggy / executeRefloatFromSavings est sorti du modèle sans
-- contrepartie (le budget_snapshot_data qui devait reporter la dette de
-- dépassement n'est jamais appliqué).
--
-- Décision produit (2026-09-01) : REMBOURSER puis repartir à neuf. Au prochain
-- `start_monthly_recap`, les lignes ouvertes de périodes strictement antérieures
-- sont balayées : `refloated_from_piggy + refloated_from_savings` est recrédité
-- EN TOTALITÉ SUR LA TIRELIRE (pot unique, exact au centime) et la ligne est
-- marquée `abandoned_at`. Le report de dépassement de l'ancien mois est perdu —
-- c'est le prix assumé de cette option.
--
-- Pourquoi tout dans la tirelire plutôt qu'une redistribution par budget : le
-- détail par budget du refloat savings n'est persisté NULLE PART (seul le total
-- scalaire `refloated_from_savings` existe ; cf. actions-negative.ts:249-262).
-- Le reconstruire serait circulaire — les pools `cumulated_savings` ont
-- justement été débités — et `distributeProportional` fait porter le résidu
-- d'arrondi au dernier budget par ordre d'UUID, donc non reproductible.
--
-- ⚠️ Vocabulaire : « orphelin » est DÉJÀ pris dans ce repo et désigne autre
-- chose (une ligne de la BONNE période dont `started_by_profile_id IS NULL`,
-- cf. check-status.ts:136 et start_monthly_recap). Le nouveau cas se dit
-- « abandonné » / `abandoned` partout — code, tests et docs.

ALTER TABLE monthly_recaps
  ADD COLUMN IF NOT EXISTS abandoned_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN monthly_recaps.abandoned_at IS
  'Sprint Abandoned-Recap-Recovery (2026-09-01). Horodatage du classement sans '
  'suite, posé par start_monthly_recap sur les lignes ouvertes de périodes '
  'STRICTEMENT antérieures à celle demandée, après remboursement de leurs '
  'refloats vers la tirelire. État terminal, alternatif à completed_at. NULL '
  'sur toute ligne vivante ou terminée normalement.';

COMMENT ON COLUMN monthly_recaps.recovery_data IS
  'Sprint Abandoned-Recap-Recovery (2026-09-01). Portée par la NOUVELLE ligne : '
  '{ "total": 150, "periods": [{ "month": 6, "year": 2026, "amount": 150 }] } — '
  'ce qui a été remis dans la tirelire en balayant les bilans abandonnés au '
  'moment de son ouverture. Alimente le bandeau du wizard (RecoveredFundsBanner). '
  '{} = rien à annoncer (aucun bilan abandonné, ou aucun n''avait coûté d''argent : '
  'décision produit = archivage silencieux dans ce cas).';

-- Pas de nouvel index : monthly_recaps porte au plus une ligne par propriétaire
-- et par mois, et `monthly_recaps_completed_lookup` (profile_id, group_id,
-- recap_month, recap_year, completed_at) couvre déjà le lookup owner + période
-- du balayage.

NOTIFY pgrst, 'reload schema';
