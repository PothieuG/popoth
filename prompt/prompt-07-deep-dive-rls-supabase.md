# Fix C4 — Audit et versionnement des RLS Supabase

> ⚠️ **STALE — Prompt triagé 2026-05-13.** Le scope C4 a été livré entre Sprint 0 (C4 audit initial) + Sprint DB / D1–D11 (RLS activée, policies versionnées, tests gated) + Sprint Refactor / R6 (drop recursive profiles policy). Bilan Phase 1 audit : 7/10 items déjà livrés, 3/10 refusés au triage (current_user_groups helper sans consumer browser-client / audit trail columns optional cargo cult / ADR refusé per CLAUDE.md §7+§8 source-of-truth). Ne PAS exécuter ce prompt. Voir CLAUDE.md §11 entrée « Sprint Audit-Closeout C4 ». Pattern miroir Sprint Audit-Closeout C2 (2026-05-10) / C3 (2026-05-11) / Dead-Code-Purge (2026-05-13).

## Contexte

L'application Popoth est multi-tenant (utilisateurs personnels + groupes partagés) et stocke des données financières sensibles. **La seule barrière** entre les données de `userA` et `userB` côté client (clé `anon`) est la **Row Level Security (RLS) PostgreSQL**.

État actuel constaté lors de l'audit :

- ❌ **Aucune policy RLS versionnée** dans le repo.
- ❌ `supabase/migrations/` n'existe pas.
- ⚠️ Les `.sql` historiques étaient à la racine et sont en cours de **suppression** sur la branche `cleanup`.
- ✅ Le `service_role` (qui bypass la RLS) est correctement isolé côté serveur dans [lib/supabase-server.ts](lib/supabase-server.ts).
- ❓ Les routes `/api/finances/*` filtrent par `userId` côté serveur, mais **on ignore** ce qui se passe pour les requêtes client direct (s'il en existe).

L'objectif est de **récupérer le schéma actuel** depuis Supabase, **auditer** chaque table sensible, **versionner** les policies et **tester** l'isolation entre utilisateurs.

## Fichiers à analyser en priorité

- [lib/supabase-server.ts](lib/supabase-server.ts) — confirmer que le `service_role` n'est utilisé qu'ici
- [lib/supabase-client.ts](lib/supabase-client.ts) — client browser, utilise `anon` (sera soumis à la RLS)
- [docs/audit/07-deep-dive-rls-supabase.md](docs/audit/07-deep-dive-rls-supabase.md) — playbook complet, checklist par table
- Tous les `components/`, `hooks/`, `contexts/` — pour vérifier les éventuelles mutations Supabase directes : `grep -rn "supabase\.from\(" components/ hooks/ contexts/`
- Le repo doit avoir Supabase CLI installable : `pnpm add -D supabase`

## Objectifs précis

1. **Pull du schéma** :
   - Installer Supabase CLI : `pnpm add -D supabase`.
   - `pnpm dlx supabase login` (interactif — si non possible, utiliser un PAT via env).
   - `pnpm dlx supabase init` (si pas déjà fait).
   - `pnpm dlx supabase link --project-ref <project-ref>` (le project-ref se trouve dans le dashboard).
   - `pnpm dlx supabase db pull` → crée `supabase/migrations/<timestamp>_remote_schema.sql`.
   - **Sanitiser** le résultat : retirer toute clé/credential potentiellement leakée.
   - Commiter dans `supabase/migrations/`.
2. **Inventaire des policies** :
   - Sur le pull, lister toutes les `CREATE POLICY` et grouper par table.
   - Stocker dans `docs/audit/RLS-FINDINGS.md` avec colonnes : Table | RLS activée ? | SELECT policy | INSERT policy | UPDATE policy | DELETE policy | Verdict.
3. **Audit table par table** (cf. checklist détaillée du deep dive) :
   - `profiles`, `groups`, `group_members`.
   - `estimated_budgets`, `estimated_incomes`.
   - `real_expenses`, `real_incomes`.
   - `bank_balance`, `piggy_bank`.
   - `monthly_recaps`.
   - Tables de jointure (`expense_breakdowns`, `contributions`, etc.) — adaptées selon ce que le pull révèle.
   - Pour chaque table, vérifier : RLS activée, policies SELECT/INSERT/UPDATE/DELETE présentes, restrictives (pas de `USING (true)`), cohérence profile vs group.
4. **Erreurs courantes à grep** :
   - `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` — repérer les tables sans RLS.
   - `SELECT policyname, qual FROM pg_policies WHERE qual = 'true'` — policies trop ouvertes.
   - `grep -rn "SUPABASE_SERVICE_ROLE_KEY" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules | grep -v "lib/supabase-server.ts"` — leak de la service_role.
   - `grep -rn "supabase\.from\(.*\.\(insert\|update\|delete\)" components/ hooks/ contexts/` — mutations client direct sur tables sensibles.
5. **Corrections SQL** :
   - Pour chaque manque, créer une migration `supabase/migrations/<timestamp>_fix_<table>_rls.sql`.
   - Utiliser le pattern recommandé du deep dive (SELECT/INSERT/UPDATE/DELETE séparés, `auth.uid() = user_id` ou `group_id IN (SELECT current_user_groups())`).
6. **Helper SQL `current_user_groups()`** :
   - Créer la fonction PostgreSQL :
     ```sql
     CREATE OR REPLACE FUNCTION current_user_groups()
     RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path = public AS $$
       SELECT group_id FROM group_members WHERE user_id = auth.uid();
     $$;
     GRANT EXECUTE ON FUNCTION current_user_groups TO authenticated;
     ```
   - Utiliser dans les policies pour réduire la duplication.
7. **Audit trail (optionnel mais recommandé)** :
   - Ajouter `created_by`, `updated_by` (uuid REFERENCES auth.users) sur les tables mutables sensibles.
   - Trigger `fill_created_by` qui auto-rempli ces colonnes.
8. **Tests d'isolation** :
   - Créer `scripts/test-rls-isolation.ts` qui :
     - Crée 2 users de test via Supabase Auth Admin API.
     - Pour chaque table sensible, fait un test SELECT/UPDATE/DELETE avec userB sur les données de userA → doit échouer.
     - Cleanup en fin.
   - Intégrer dans la CI une fois Sprint 2 stabilisé.
9. **Documentation** :
   - Mettre à jour `CLAUDE.md` section "Sécurité financière" avec un paragraphe RLS et un lien vers `RLS-FINDINGS.md`.
   - Créer `docs/adr/0002-rls-supabase-conventions.md` documentant le pattern adopté.

## Contraintes techniques

- **PostgreSQL 15+** (Supabase managed).
- **`SECURITY DEFINER`** sur les fonctions helpers — auditer pour éviter les abus.
- Migrations **idempotentes** (`CREATE OR REPLACE`, `IF NOT EXISTS`).
- Pas de modification du schéma applicatif (pas d'ajout de colonnes business) — uniquement les colonnes d'audit (`created_by`, etc.) si validées.
- Les routes API serveur doivent continuer à fonctionner (elles utilisent `service_role` qui bypass RLS) — vérifier qu'aucune route ne casse.
- Le client browser, lui, sera soumis aux nouvelles policies — risque de régression si une UI fait des requêtes Supabase direct.
- **Ne pas committer** de credentials. Vérifier que le pull SQL ne contient pas de mots de passe ou de connection strings.
- **Réversibilité** : pour chaque migration, prévoir un rollback dans un commentaire.

## Critères de validation

- `ls supabase/migrations/` contient au moins le pull initial + les fixes de policies.
- `docs/audit/RLS-FINDINGS.md` est complet (toutes les tables sensibles couvertes).
- `grep -rn "SUPABASE_SERVICE_ROLE_KEY" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules | grep -v "lib/supabase-server.ts"` ne renvoie rien.
- `bash scripts/test-rls-isolation.ts` exit 0 et logge "✅ Toutes les tables sont isolées".
- Test manuel : 2 comptes browser distincts, créer un budget en compte A, ouvrir le compte B → le budget de A n'apparaît pas.
- `SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity = false` ne renvoie que les tables explicitement publiques (lookup tables type `categories`).
- `pnpm typecheck && pnpm lint:check && pnpm build` passent.
- ADR `0002-rls-supabase-conventions.md` créé.
- `CLAUDE.md` mis à jour.

## Instructions pour Claude Code

- **Lire** [docs/audit/07-deep-dive-rls-supabase.md](docs/audit/07-deep-dive-rls-supabase.md) intégralement.
- **Confirmer avec l'utilisateur** :
  - Le `<project-ref>` Supabase à linker.
  - L'autorisation de `pnpm dlx supabase login` (interactif).
  - L'autorisation d'appliquer les migrations en staging (et en prod, séparément).
- Découper en **5 commits** :
  1. `chore(supabase): add CLI deps and pull initial schema`
  2. `docs(audit): document RLS findings per table`
  3. `feat(supabase): add current_user_groups helper and audit columns`
  4. `fix(supabase): tighten RLS policies for finance tables`
  5. `test(security): add RLS isolation script + ADR`
- **Sanitiser** chaque fichier avant commit : `grep -E "(eyJ|sk_|sb_|service_role|password)" supabase/migrations/` doit renvoyer vide.
- **Ne pas appliquer** en prod sans :
  - Un `pg_dump` préalable.
  - Validation en staging.
  - Confirmation utilisateur.
- En cas de doute sur une policy (ex: business rule unclear), **stopper** et demander à l'utilisateur.
- Si une mutation client direct est trouvée sur une table financière (`grep` étape 4), **alerter** l'utilisateur — c'est un risque sécurité immédiat à traiter dans un autre PR.
