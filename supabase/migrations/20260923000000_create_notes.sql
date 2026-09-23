-- Sprint Notes-Pense-Betes (2026-09-23) — table des notes / pense-bêtes.
--
-- Une note appartient soit à un profil (notes privées, dashboard perso), soit
-- à un groupe (notes partagées entre tous les membres, dashboard groupe) —
-- jamais les deux, jamais aucun. Même forme que savings_projects /
-- estimated_budgets : CHECK d'exclusivité du propriétaire + index partiels.
--
-- created_by_profile_id : l'auteur, affiché en avatar devant chaque note.
-- ON DELETE SET NULL (miroir real_expenses.created_by_profile_id) : si un
-- membre supprime son compte, ses notes de groupe restent pour les autres.
--
-- Table server-only : lue et écrite uniquement par les routes /api/notes via
-- le client service_role. RLS activée SANS policy = deny-all anon/authenticated
-- (convention git-workflow.md §12, précédent monthly_recaps).
--
-- Aucune RPC : chaque écriture touche une seule ligne, sans colonne sensible.
-- EXPECTED_RPCS reste à 28.

CREATE TABLE IF NOT EXISTS "notes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid,
  "group_id" uuid,
  "created_by_profile_id" uuid,
  "content" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_pkey" PRIMARY KEY (id);

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_profile_id_fkey"
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_group_id_fkey"
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_created_by_profile_id_fkey"
  FOREIGN KEY (created_by_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_content_not_empty_check"
  CHECK ((TRIM(BOTH FROM content) <> ''::text));

-- Miroir de NOTE_CONTENT_MAX_CHARS (lib/constants/notes.ts).
ALTER TABLE "notes"
  ADD CONSTRAINT "notes_content_max_len_check"
  CHECK ((char_length(content) <= 1000));

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_owner_exclusive_check"
  CHECK ((((profile_id IS NOT NULL) AND (group_id IS NULL)) OR ((profile_id IS NULL) AND (group_id IS NOT NULL))));

CREATE INDEX IF NOT EXISTS idx_notes_profile_id
  ON public.notes USING btree (profile_id)
  WHERE (profile_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_notes_group_id
  ON public.notes USING btree (group_id)
  WHERE (group_id IS NOT NULL);

CREATE TRIGGER update_notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
