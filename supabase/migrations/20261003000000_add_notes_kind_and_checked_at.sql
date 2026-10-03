-- Sprint Notes-Tabs (2026-10-03) — le drawer Notes passe à 3 onglets :
-- Courses (liste à cocher), Note (texte libre, l'existant), Projet (liste simple).
--
-- Les 3 onglets partagent la table `notes` (mêmes propriétaires, même
-- partage en groupe, même contrôle d'accès) : une colonne `kind` les distingue.
-- Les notes existantes deviennent `kind = 'note'` via le DEFAULT.
--
-- checked_at : horodatage de la case cochée, réservé aux articles de courses.
-- NULL = à acheter. Un article coché depuis plus de 7 jours est supprimé par
-- GET /api/notes (SHOPPING_CHECKED_RETENTION_DAYS, lib/constants/notes.ts) —
-- pas de tâche planifiée.
--
-- Table hors snapshots (exclue de snapshots.restorable_tables(), migration
-- 20260928000000) : aucun impact sur la sauvegarde / restauration de fin de mois.
-- Aucune RPC : EXPECTED_RPCS inchangé.

ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'note';

ALTER TABLE "notes"
  ADD COLUMN IF NOT EXISTS "checked_at" timestamp with time zone;

-- Miroir de NOTE_KINDS (lib/constants/notes.ts).
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_kind_check"
  CHECK ((kind = ANY (ARRAY['note'::text, 'shopping'::text, 'project'::text])));

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_checked_at_shopping_only_check"
  CHECK (((checked_at IS NULL) OR (kind = 'shopping'::text)));

NOTIFY pgrst, 'reload schema';
