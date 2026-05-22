-- Sprint Recap-V2-Ossature (2026-05-22)
--
-- Backfill data one-shot : pour chaque ligne `monthly_recaps` du mois
-- courant (complétée ou in-flight), on crée une ligne miroir dans
-- `monthly_recaps_v2` marquée `completed_at = now()`.
--
-- Justification métier : ce backfill évite que les users actifs en V1 ce
-- mois-ci soient redirigés vers `/monthly-recap` (placeholder V2) au
-- prochain accès post-swap (étape 4 du plan ossature). La V2 considère
-- "ce mois est clos" pour eux ; ils repartiront sur un cycle V2 frais au
-- mois suivant. La V1 reste intacte (tables monthly_recaps,
-- recap_snapshots) pour audit/référence.
--
-- Idempotent : `ON CONFLICT DO NOTHING` rend la migration re-runnable. Les
-- contraintes UNIQUE (profile_id, recap_month, recap_year) + UNIQUE
-- (group_id, recap_month, recap_year) sur monthly_recaps_v2 protègent
-- contre les doublons.
--
-- Volume attendu (mesuré 2026-05-22 pre-apply) : 3 rows (2 profile + 1
-- group). Faible volume, opération sûre.

INSERT INTO monthly_recaps_v2 (profile_id, group_id, recap_month, recap_year, completed_at, created_at)
SELECT
  profile_id,
  group_id,
  extract(month from now())::int,
  extract(year from now())::int,
  now(),
  now()
FROM monthly_recaps
WHERE recap_month = extract(month from now())::int
  AND recap_year = extract(year from now())::int
ON CONFLICT DO NOTHING;

-- Pas de NOTIFY pgrst : aucune modification DDL, pas besoin de reload du
-- cache PostgREST.
