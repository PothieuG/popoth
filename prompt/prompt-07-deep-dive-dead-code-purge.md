# Prompt — Sprint Dead-Code-Purge : suppression systématique des exports/handlers orphelins

> **Statut** : prompt rédigé en clôture du Sprint Atomicity-Savings v2 (2026-05-12, closed-by-deletion). Le succès de v2 (suppression de `handlePiggyBankAction` ~108 LOC après confirmation 0 consumer cross-codebase) a démontré la valeur du pattern Path B (Phase 1 audit → AskUserQuestion → DELETE) sur du dead code. **3 candidats sont déjà documentés dans CLAUDE.md** comme déférés à un sprint dead-code-purge ; ce prompt les groupe + ajoute un audit systématique pour découvrir d'autres dead exports.
>
> **Effort estimé** : ~4-6 commits, ~2-3h. Scope dominé par l'audit (1h) + 3-4 deletions ciblées (1-2h) + closeout (30min). 0 nouvelle infra, 0 migration DB, 0 nouveau test (sauf si une suppression casse un test existant, à reformuler).

---

## Contexte

Au fil des sprints récents (Audit-Closeout, Lot 5b, Lot 5c, Lot 5d, Atomicity-Savings v2), plusieurs candidats dead code ont été surfacés et **explicitement déférés** à un sprint dédié, plutôt que mélangés au scope du sprint en cours :

1. **`lib/auth.ts` exports orphelins** (surfacé Lot 5c, 2026-05-10) — les exports `signUp` / `resetPassword` / `updatePassword` n'ont **0 consumer** dans `app/` ou `components/` (vérifié grep). Les flows auth de l'app utilisent `supabase.auth.signUp` direct dans `app/inscription/page.tsx` et les reset-password / forgot-password pages utilisent `supabase.auth.resetPasswordForEmail` direct. Les wrappers `lib/auth.ts` étaient probablement une indirection d'origine puis remplacés par des appels directs.

2. **`app/api/debug/remaining-to-live/route.ts`** (surfacé Lot 5d, 2026-05-10) — 254 LOC pour seul 3 sites console, candidat "orphelin cross-codebase" noté. Toutes les routes `app/api/debug/**` sont gated `blockInProduction()` (404 prod), donc consommables uniquement en dev. Mais 0 consumer dev applicatif n'a été identifié (pas dans `components/` qui appellerait `/api/debug/...`).

3. **`app/api/debug/financial/route.ts` + `app/api/debug/group-financial/route.ts`** (surfacé Lot 5d, 2026-05-10) — quasi-dupliqués (148/152 LOC, structure identique sauf scope user vs groupe). Candidat refactor consolidation OU deletion si 0 consumer dev applicatif.

4. **`handlePiggyBankAction` 3 action types** — fermé par Sprint Atomicity-Savings v2 ce sprint. Pattern de référence pour la démarche audit-then-delete.

**Trouvaille collatérale** confirmée par Sprint v2 Phase 1 : un audit cross-codebase `grep` est rapide (~5 min) + révèle exactement les consumers réels. Si zéro, deletion bat refactor.

Le scope du sprint Dead-Code-Purge est de :

- (a) **Confirmer** ou infirmer chacun des 3 candidats déjà documentés via Phase 1 audit Explore.
- (b) **Élargir** l'audit à d'autres surfaces orphelines : exports inutilisés, handlers de route sans frontend, helpers TypeScript jamais importés.
- (c) **Triager avec l'utilisateur** chaque candidat surfacé via AskUserQuestion (Path B DELETE vs Path D Keep avec raison).
- (d) **Supprimer** les candidats validés DELETE, mirror du pattern v2 (commits par domaine + ESLint glob mise à jour si applicable + CLAUDE.md §11 entrée).

---

## Outcome attendu

- Audit Phase 1 cross-codebase qui produit un tableau **{nom export/handler, file:line, consumer count, sites de référence}**.
- Pour chaque candidat à 0 consumer : décision user (DELETE / KEEP avec raison documentée).
- 3-5 commits de deletion ciblés selon nombre de candidats validés (1 commit par domaine si possible).
- 1 commit closeout : CLAUDE.md §11 nouvelle entrée Sprint Dead-Code-Purge + retrait des "trouvailles collatérales" qui pointaient ces candidats.
- Net LOC delta estimé : **−400 à −800 LOC** selon ce qui est validé DELETE.
- Score CLAUDE.md §1 : stable (deletion ≠ gap closure métier).

---

## Phase 1 — Investigation (Explore agent, 1-2 passes selon volume)

```
Tâches d'audit cross-codebase (1 Explore agent, ~600 mots de rapport) :

1. CANDIDATS DÉJÀ DOCUMENTÉS — confirmer 0 consumer pour chacun :

   1a. lib/auth.ts exports orphelins
       - Lire lib/auth.ts en entier, identifier tous les `export function` /
         `export const` / `export async function`.
       - Pour chaque export : grep cross-codebase (`app/`, `components/`,
         `hooks/`, `contexts/`, `lib/`, `middleware.ts`) pour son nom.
       - Reporter file:line + consumer count + sites trouvés.
       - Hypothèse à confirmer : signUp / resetPassword / updatePassword
         ont 0 consumer applicatif. signInWithPassword + signOut +
         refreshSession + getCurrentUser sont probablement encore utilisés
         par AuthContext.

   1b. app/api/debug/remaining-to-live/route.ts
       - Grep pour `/api/debug/remaining-to-live` dans tout le codebase
         (incl. components, hooks, contexts, tests, scripts).
       - Si 0 hit applicatif → candidat DELETE.
       - Si hit en script/test/dev tool → noter le consumer.

   1c. app/api/debug/financial/route.ts + group-financial/route.ts
       - Même méthode que 1b pour chacune.
       - Si les 2 sont dead → DELETE les 2. Si 1 est utilisée et l'autre
         non, considérer refactor consolidation.

2. AUDIT SYSTÉMATIQUE — ouvrir le filet plus large :

   2a. Routes API sans consumer frontend
       - Lister tous les `app/api/**/route.ts` (Glob).
       - Pour chacune : grep pour son path (ex: '/api/foo/bar') dans
         `components/`, `hooks/`, `contexts/`, `app/` (excluant la route
         elle-même), `middleware.ts`.
       - Reporter celles avec 0 consumer frontend.
       - Exclure : `/api/auth/**` (utilisé par middleware/login flow),
         `/api/finance/**` (couvert v3), `/api/debug/**` (déjà audité 1b/1c).

   2b. Exports de modules `lib/`
       - Glob `lib/**/*.ts` (excluant `__tests__`).
       - Pour chaque module top-level : grep pour les exports nommés dans
         tout le codebase.
       - Reporter ceux avec 0 consumer hors le fichier lui-même.
       - LIMITE : audit ~5 modules max pour ne pas exploser le scope ;
         prioriser ceux modifés récemment (cf. git log --since='2 weeks').
       - Exclure les modules suivants (déjà audités/curated) :
         lib/finance/**, lib/recap/**, lib/api/with-auth.ts, lib/logger.ts,
         lib/database.types.ts (auto-gen), lib/expense-allocation.ts.

   2c. Helpers utilitaires
       - Lire les exports de lib/utils.ts (s'il existe), lib/constants/**,
         lib/api/parse-body.ts.
       - Reporter les exports à 0 consumer.

3. SANITY CHECK — verifier les non-faux-positifs :

   3a. Re-vérifier les candidats DELETE proposés via grep variant :
       - Si export `signUp` : grep aussi pour `auth.signUp` et `from '@/lib/auth'`.
       - Si route `/api/debug/financial` : grep aussi pour la string brute
         dans des commentaires/docs (pour catch dev workflow notes).
       - Si module helper : grep pour `import * as` (namespace imports
         peuvent masquer un consumer).

   3b. Confirmer que les tests ne consument PAS les candidats DELETE :
       - Grep dans `__tests__/**` et `**/*.test.ts` pour chaque candidat.
       - Si test existe : noter (le test devra être supprimé en même temps).

Rapport <= 600 mots avec tableau récapitulatif {candidat, file:line, 
consumer count, recommandation DELETE/KEEP/REFACTOR}.
```

---

## Phase 2 — Arbitrage user (AskUserQuestion)

Une question multi-select avec une option par candidat surfacé Phase 1, plus une question sur le découpage commits.

**Q1 — Sélection des candidats à supprimer** :

Présenter chaque candidat surfacé Phase 1 comme option. Format type :
- `lib/auth.ts:signUp/resetPassword/updatePassword (0 consumer)` — DELETE
- `app/api/debug/remaining-to-live (0 consumer)` — DELETE
- `app/api/debug/financial + group-financial (consolidation OR delete)` — DELETE both / Keep both / Refactor merger
- Autres surfacés Phase 1 — Per-item DELETE / KEEP

User peut multi-select. Items unselected = Keep (et la raison sera notée en CLAUDE.md §11 pour future référence si besoin).

**Q2 — Découpage commits** :
- (A) 1 commit par candidat (granularité fine, plus de PR overhead)
- (B) 1 commit par domaine (auth / debug routes / lib helpers)
- (C) 1 mega-commit de cleanup (suit la convention Lot 5b/5c precedent)
- **Recommandé** : (B) 1 commit par domaine + 1 closeout = 3-4 commits totaux.

**Q3 — ESLint per-file overrides** :

Pour chaque domaine touché, vérifier si `eslint.config.mjs` a un glob `no-console: 'error'` pointant vers un path qui sera supprimé (ex: si on supprime `app/api/debug/remaining-to-live/route.ts`, le glob `app/api/debug/**` reste valide pour les autres routes, mais si on supprime toute la dir `app/api/debug/financial/`, le glob couvre désormais 0 fichier — décider si on laisse comme future-proof ou si on nettoie).

---

## Phase 3 — Implémentation (3-5 commits selon Q1/Q2)

### Commit 1 — Suppression candidats domaine 1 (e.g. auth helpers)

Si `lib/auth.ts` validé DELETE : supprimer les exports `signUp` / `resetPassword` / `updatePassword` (et leurs dépendances locales privées si elles existent et deviennent unused).

**Attention** : ne pas supprimer tout `lib/auth.ts` — les exports `signInWithPassword` / `signOut` / `refreshSession` / `getCurrentUser` sont consommés par `AuthContext`.

Net LOC delta estimé : ~−60 LOC (3 fonctions ~20 LOC chacune).

### Commit 2 — Suppression candidats domaine 2 (e.g. debug routes)

Si `app/api/debug/remaining-to-live/route.ts` validé DELETE : `git rm` du fichier.
Si `app/api/debug/{financial,group-financial}/route.ts` validés DELETE : `git rm` des 2.
Si refactor consolidation préféré : créer un nouveau handler unique paramétré.

Net LOC delta estimé : ~−250 à −550 LOC selon ce qui est validé.

### Commit 3 — Suppression candidats domaine 3 (e.g. lib helpers)

Si des exports lib/ orphelins validés : suppression ciblée des fonctions/types.

Net LOC delta variable selon Phase 1 audit.

### Commit 4 — ESLint config cleanup (si applicable)

Si des paths ESLint deviennent invalides post-deletion, soit :
- Garder le glob (future-proof, pattern Lot 5c)
- Retirer si stricte conviction qu'aucun futur fichier ne renaîtra dans ce path

### Commit 5 — Closeout

CLAUDE.md :
- §1 score paragraph : ajouter step "stable après Sprint Dead-Code-Purge"
  avec recap scope (X LOC supprimés, Y candidats validés, Z déférés KEEP).
- §4 inventory : retirer/ajuster les références aux fichiers supprimés
  (notamment si `lib/auth.ts` voit ses exports réduits — la doc §6
  TypeScript usage doit refléter ce qui reste).
- §11 Roadmap : nouvelle entrée ✅ **Sprint Dead-Code-Purge** détaillant
  les candidats validés DELETE + ceux KEEP (avec raison user) + le pattern
  audit utilisé. Mention "lessons learned" : (a) le grep cross-codebase
  est rapide, (b) sauter la phase audit risque de supprimer du code
  utilisé via path indirect (import * as, dynamic import, etc.).

---

## Critères de succès

- Phase 1 audit produit un tableau récapitulatif clair {candidat, consumer count, recommandation}.
- Chaque DELETE est validé par grep cross-codebase confirmant 0 consumer (pas seulement "j'ai cherché et pas trouvé" — preuve concrète via commande grep reproductible).
- `pnpm verify` exit 0 après chaque commit.
- Lint baseline stable (ou diminue si des sites `no-console` warn-counted étaient dans le code supprimé).
- Tests : 0 régression. Si un test consommait un candidat DELETE → le test est supprimé avec, pas adapté.
- `pnpm build` 55/55 routes ou ajusté si des routes ont été supprimées.
- Net LOC delta négatif (−400 à −800 LOC selon scope user-validé).

---

## Hors scope (à séparer dans un sprint dédié si surfacé)

- **God file `app/api/monthly-recap/complete/route.ts`** (~730 LOC + 4 globals carryover) — chantier I6 déjà roadmappé, refactor pas deletion.
- **`app/api/monthly-recap/{balance,auto-balance,process-step1}` cleanup console.log** — couplé I5/I6, déjà roadmappé Lot 6.
- **Refactor consolidation de `app/api/debug/financial` + `group-financial` en un seul handler paramétré** — si user choisit Refactor au lieu de DELETE pour ces 2 routes, c'est out-of-scope (nouveau commit séparé avec test).
- **Audit prompts/ + docs/ orphelins** — beaucoup de prompts versionnés (v2/v3/...) dont la plupart sont déjà "STALE" taggés ou superseded. Plutôt cargo-cult d'auditer ce répertoire — laisser comme mémoire historique.

---

## Notes opérationnelles

- **Pattern miroir** du Sprint Atomicity-Savings v2 (commits `66b2d3d` → `6b2eea9`). Phase 1 audit Explore + AskUserQuestion + Path B DELETE est le template éprouvé.
- **Apply via Edit/Write/git rm**, jamais `db push` (aucune migration DB attendue).
- **Si une suppression casse un test** : supprimer le test aussi (le test verrouillait du dead code, donc inutile). Ne PAS adapter le test à pointer ailleurs.
- **Si une suppression casse `pnpm typecheck`** (e.g. un type importé dans un autre module) : investiguer si le type est utilisé ailleurs. Si oui, déplacer le type dans le module consumer. Si non, supprimer aussi.
- **Pre-commit hook** (lint-staged) reformatera les fichiers modifiés via Prettier. Pas d'intervention manuelle nécessaire.
- **Smoke browser non requis** sauf si on touche une route consommée par UI (e.g. si v2 had touched `transferSavingsBetweenBudgets` — ce qui n'est pas le cas ici).
- **Ne pas commit "WIP" pré-existants** : le git status au début de session montre souvent des `M` files non liés au sprint (cf. v2 Phase 3 : `app/api/debug/remaining-to-live/route.ts` et autres `M` files étaient WIP user, pas mon scope). `git add` uniquement les fichiers que ce sprint touche.

---

## Pourquoi ce sprint, maintenant

- **Le pattern fonctionne** : v2 a livré ~108 LOC de deletion en 2 commits ~30 min de travail effectif. L'audit Phase 1 a pris ~5 min.
- **Le coût d'attendre** : à chaque sprint qui passe, le code mort grossit subtilement (ex: Lot 5c surfacé `testSupabaseConnection`, Lot 5d surfacé 3 candidats supplémentaires). Sans sprint dédié, ces trouvailles s'accumulent et finissent par être déprioritisées.
- **Le coût d'agir** : ~2-3h, ~−400 à −800 LOC, 0 risque métier (le code supprimé n'a pas de consumer).
- **Signal cohérent** : Audit-Closeout C2/C3 ont déjà refusé "design for hypothetical" / "ENABLE_DEBUG_ROUTES flag" / "smoke test for routes that retrécit". Le repo a un policy clair : pas de code défensif sans use case. Ce sprint applique le même filtre rétrospectivement aux 3 candidats déjà documentés.
