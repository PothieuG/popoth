# 22 — Routes debug Zod résiduelles (reset-all + reset-budgets)

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint Zod-Rollout v8 hors scope + dernière entrée v10 |
| **Type** | dette technique (cohérence Zod) |
| **Priorité** | Basse |
| **Effort estimé** | XS (<30min) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

CLAUDE.md §11 dernière entrée :

> ⏭️ **Hors scope Zod (séparé)** : Debug routes (3 survivantes — reset-all/reset-budgets/retrigger-recap) — `retrigger-recap` migré v2, **les 2 autres sans body**. OpenAPI / schema-to-docs (R10 audit) séparé.

**État actuel** :
- 3 routes debug survivantes (Sprint Dead-Code-Purge a supprimé 3 routes : `remaining-to-live`, `financial`, `group-financial`)
  - `app/api/debug/retrigger-recap/route.ts` — migré Zod Sprint Zod-Rollout v2 commit `6fa3d6c` (a body, validé via `retriggerRecapBodySchema` dans `lib/schemas/debug.ts`)
  - `app/api/debug/reset-all/route.ts` — **PAS migré, sans body** (POST sans payload)
  - `app/api/debug/reset-budgets/route.ts` — **PAS migré, sans body** (POST sans payload)

Toutes 3 routes gated `blockInProduction()` (404 prod). Donc le risque sécurité est nul.

## Question de scope

Migrer 2 routes "sans body" via Zod = créer 2 schemas vides + 2 `parseBody` calls qui ne valident rien d'autre que "le body est un objet vide ou absent". Effort marginal, valeur marginale. Acceptable de laisser tel quel. **À arbitrer Phase 1 avec user.**

**Recommandation** : si user veut "100% Zod coverage" pour cohérence visuelle, faire en 30min. Sinon laisser DORMANT (pattern "design for hypothetical").

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Migrer les 2 routes debug `reset-all` + `reset-budgets` vers le pattern Zod parseBody + schema vide, pour cohérence visuelle avec les autres routes du repo. Ou décider de les laisser tel quel (Décision Phase 1).

### 2. Contexte technique

**Fichiers concernés** :
- `app/api/debug/reset-all/route.ts` (handler POST sans body)
- `app/api/debug/reset-budgets/route.ts` (handler POST sans body)
- `lib/schemas/debug.ts` (étendre avec 2 schemas vides ou objet vide)

**Pattern à reprendre** :
- Sprint Zod-Rollout v2 commit `6fa3d6c` — `retriggerRecapBodySchema` dans `lib/schemas/debug.ts` :
  ```typescript
  export const retriggerRecapBodySchema = z.object({}).passthrough()
  ```

### 3. Critères d'acceptation

- [ ] 2 schemas vides ajoutés dans `lib/schemas/debug.ts` : `resetAllBodySchema` + `resetBudgetsBodySchema`
- [ ] 2 routes utilisent `parseBody(req, schema)` au top du try
- [ ] `pnpm verify` exit 0
- [ ] Smoke : POST `/api/debug/reset-all` en dev fonctionne identique pré-migration

### 4. Étapes (compactes)

```powershell
# 1. Pré-flight
pnpm verify

# 2. Edit lib/schemas/debug.ts (ajouter 2 schemas)
# 3. Edit 2 routes (parseBody + handleBadRequest pattern)
# 4. Verify
pnpm typecheck && pnpm lint:check && pnpm test:run

# 5. Smoke (dev only)
pnpm dev
# curl -X POST http://localhost:3000/api/debug/reset-all
```

## Pièges

- Routes blockInProduction → invisibles en prod, donc même si on les migre c'est pour la dev quality of life uniquement
- Pas de cleanup-attempt CRITIQUE (routes atomiques)

## Découpage (XS → 1 commit)

1. **Sub-1** — Migration 2 routes + schemas. Commit `feat(debug): zod validate 2 remaining debug routes`.

## Recovery

- `git revert`. Pas de migration DB.

---

**Estimation totale** : <30min. Score ~99.999 stable. Décision optionnelle Phase 1.
