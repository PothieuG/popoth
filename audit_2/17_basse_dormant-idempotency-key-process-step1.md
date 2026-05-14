# 17 — ⏰ DORMANT : Idempotency key process-step1

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §8 ❌](../CLAUDE.md) + Sprint Refactor-I5-followup-v2 Axe 3 (documented only) |
| **Type** | décision en attente (architecture) |
| **Priorité** | Basse |
| **Effort estimé** | M (demi-journée) |
| **Statut** | **⏰ DORMANT — déclencher si incident concurrence prod surface** |
| **Dépendances** | Aucune (déclenché par trigger externe : incident) |
| **Bloque** | — |

## Contexte

CLAUDE.md §8 ❌ :

> **Ne pas retry automatiquement** un POST `/api/monthly-recap/process-step1` qui retourne une 5xx — la route n'est pas idempotente et peut laisser la DB partiellement appliquée (pipeline `loadSnapshot → decideStep1Allocation → applyDecision` non-transactionnel ; les RPC atomiques garantissent `>= 0` invariants mais une seconde invocation concurrente lève une exception sans rollback des RPC/inserts déjà commit par la première). Le frontend doit disable le bouton pendant la submission (pattern `isSubmitting` dans MonthlyRecapStep1.tsx). Si un futur incident montre des states cassés, prioritiser l'implémentation d'une idempotency key serveur-side (header `Idempotency-Key` + cache table) ou un `pg_try_advisory_xact_lock(hashtext(user_id))` plutôt que d'ajouter du retry côté client.

**État actuel** :
- Pipeline `processStep1()` (`lib/recap/step1-persist.ts`, Sprint Refactor-I5) est **non-transactionnel** (3 phases : load + decide + apply, chacune touche la DB séparément)
- Chaque RPC individuelle EST atomique (Sprint Refactor-I5-followup-v2 + Atomicity-Expenses + Atomicity-Savings)
- Mais le pipeline complet ne l'est PAS — double invocation concurrente peut laisser DB partiellement appliquée
- **Protection actuelle** : `isSubmitting` flag côté frontend + JSDoc warning (Sprint Refactor-I5-followup)
- **Protection future si incident** : 2 options documentées :
  - **Option A** : header `Idempotency-Key` + cache table SQL (pattern Stripe)
  - **Option B** : `pg_try_advisory_xact_lock(hashtext(user_id))` (pattern Postgres natif, plus light-weight)

## Trigger d'activation

**Activer ce chantier SI** :
- Un incident concurrent prod survient (DB state inconsistant après double POST process-step1 simultané)
- L'utilisateur signale "j'ai cliqué 2 fois et maintenant tout est bizarre"
- Logs Vercel/Supabase montrent erreur récurrente sur process-step1 dans une fenêtre <1s
- Audit DB montre rows orphelins ou contradictoires post-récap

**NE PAS activer prématurément** : pattern "design for hypothetical" (CLAUDE.md system prompt). Attendre un trigger concret.

## Prompt prêt à l'emploi pour Claude Code (à utiliser le jour J)

> Copier-coller dans une nouvelle session Claude Code SI le trigger arrive.

### 1. Objectif

Implémenter l'option A (Idempotency-Key + cache) OU B (advisory lock) pour rendre `POST /api/monthly-recap/process-step1` idempotent face aux invocations concurrentes, sans casser les contracts existants (response shape + DB byte-identique pour le 1er call).

### 2. Contexte technique

**Fichiers concernés (Option A — Idempotency-Key)** :
- `app/api/monthly-recap/process-step1/route.ts` (handler — vérifier cache table avant `processStep1`)
- Nouvelle table `idempotency_cache` : `{ key UUID PK, user_id UUID, response JSONB, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ }`
- Migration SQL : `supabase/migrations/YYYYMMDDHHMMSS_create_idempotency_cache.sql`
- Helper `lib/api/idempotency.ts` : `checkIdempotency(key, userId)` + `storeIdempotency(key, userId, response)`

**Fichiers concernés (Option B — Advisory lock)** :
- Modif `lib/recap/step1-persist.ts` `processStep1()` : wrap dans `await supabase.rpc('try_xact_lock', { user_id })` + retry/fail
- Nouvelle RPC SQL `try_xact_lock(user_id)` qui appelle `pg_try_advisory_xact_lock(hashtext(user_id::text))`

**Tests existants pertinents** :
- 6 cas gated `process-step1` caractérisation (Sprint Refactor-I5)
- 8 cas mocked `step1-persist` (Sprint Refactor-I5-followup-v2)

**Précédents codebase** :
- Sprint Refactor-I5-followup-v2 (CLAUDE.md §11) — JSDoc concurrent-invocation edge case documenté

### 3. Décision Phase 1 : Option A vs B

| Critère | Option A (Idempotency-Key) | Option B (Advisory lock) |
|---------|---------------------------|--------------------------|
| Complexité | M (table + helper + cleanup cron) | S (1 RPC + wrap) |
| Performance | Slow (DB roundtrip cache) | Fast (in-memory lock) |
| Cleanup | Manuel (cron drop expired) | Auto (transaction-scoped) |
| Pattern industry | Stripe, AWS, ... | Postgres native |
| Side effects | Cache stale possible | None |

**Recommandation par défaut** : Option B (advisory lock), simpler.

### 4. Critères d'acceptation

- [ ] Test gated nouveau : `SUPABASE_RPC_CONCURRENCY_TESTS=1` 100× concurrent POST process-step1 → 1 succeed + 99 fail-fast (avec retry-after header) → DB state final cohérent
- [ ] Tests caractérisation byte-identique pour 1 call (pas de regression)
- [ ] CLAUDE.md §8 ❌ retire le warning "Ne pas retry automatiquement" + ajoute "process-step1 est désormais idempotent via X"

### 5. Étapes (compactes — détailler le jour J selon Option choisie)

```powershell
# Phase 1 : reproduire l'incident en local
# Phase 2 : décider Option A vs B
# Phase 3 : implémentation + migration DB
# Phase 4 : tests gated 100× concurrent
# Phase 5 : déploiement + monitoring 48h
# Phase 6 : closeout doc CLAUDE.md
```

## Pièges connus (le jour J)

- **Option A cache stale** : nécessite cleanup cron sinon table grandit indéfiniment
- **Option B retry semantics** : si le lock fail, faut-il retry côté server ou retourner 409 + Retry-After header ?
- **Idempotency key generation** : si Option A, le client doit générer un UUID unique par submit (frontend modif requise)

---

**Estimation totale** : demi-journée (Option B) à 1 jour (Option A). Score métier inchangé. **Ne pas activer sans trigger concret** — pattern "design for hypothetical" refused per CLAUDE.md system prompt + précédents Audit-Closeout C2/C3/C4 (30+ items refusés au triage). DORMANT par design.
