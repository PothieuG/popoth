# 12 — OpenAPI / schema-to-docs (R10 audit)

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint Zod-Rollout v3 + [doc2/audit/06-action-plan.md](../doc2/audit/06-action-plan.md) item R10 |
| **Type** | documentation (génération automatique) |
| **Priorité** | Moyenne |
| **Effort estimé** | M (demi-journée) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune (les schemas Zod sont en place depuis Sprint Zod-Rollout-Money-First → v8) |
| **Bloque** | — |

## Contexte

CLAUDE.md §11 entrée Sprint Zod-Rollout v3 :

> ⏭️ **Hors scope Zod (séparé)** : Debug routes (3 survivantes — reset-all/reset-budgets/retrigger-recap) — `retrigger-recap` migré v2, les 2 autres sans body. **OpenAPI / schema-to-docs (R10 audit) séparé**.

Audit historique 2026-04 ([doc2/audit/06-action-plan.md](../doc2/audit/06-action-plan.md) R10) : générer une documentation OpenAPI à partir des schemas Zod existants pour l'API REST de Popoth.

**Architecture pertinente** :
- Tous les bodies POST/PATCH/PUT ont des schemas Zod dans `lib/schemas/{common,recap,budget,income,expense,profile,bank-balance,savings,auth,groups,debug,transactions}.ts` (Sprint Zod-Rollout-Money-First → v3)
- Tous les query params GET ont des schemas via `parseQuery` (Sprint Zod-Rollout v2)
- Helper `parseBody`/`parseQuery` dans `lib/api/parse-body.ts` (Sprint Refactor-I5 + Zod-Rollout v2)
- Wrapper `withAuth(AndProfile)` dans `lib/api/with-auth.ts` (Sprint Refactor-Architecture-v3-v5)
- 50+ routes API typed strict avec ces helpers

**Outil candidat** : `zod-to-openapi` ou `@asteasolutions/zod-to-openapi` ou `next-zod-route` ou `tRPC` (mais tRPC = refactor majeur, hors scope). Le plus simple : `zod-to-openapi` qui prend les Zod schemas et génère un OpenAPI JSON/YAML, à servir via une route Next.js + Swagger UI.

**Bénéfice** :
- DX : nouveau dev voit l'API documentée + tester via Swagger UI playground
- Onboarding : éviter de fouiller manuellement dans les routes pour comprendre les payloads
- Cohérence : la doc ne peut pas drift (générée de la source de vérité = schemas Zod runtime)

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Générer une documentation OpenAPI 3.0 à partir des schemas Zod existants, l'exposer via une route Next.js (`/api/docs`) servant Swagger UI, sans modifier les schemas existants ni casser les contraintes runtime.

### 2. Contexte technique

**Fichiers concernés** :
- `lib/schemas/*.ts` (sources Zod — read-only)
- Nouveau fichier `lib/openapi/registry.ts` (registry central qui import tous les schemas + métadonnées path/method)
- Nouvelle route `app/api/docs/route.ts` (sert Swagger UI HTML ou JSON OpenAPI)
- Nouveau fichier `app/api/docs/openapi.json/route.ts` (sert le JSON OpenAPI brut)
- `package.json` (ajout deps : `@asteasolutions/zod-to-openapi` ou équivalent + `swagger-ui-react` ou `swagger-ui-dist`)

**État actuel** :
- ~50 routes API avec schemas Zod
- 0 doc OpenAPI existante
- 0 dep liée

**Tests existants pertinents** :
- Pas de test direct OpenAPI requis (la génération est mécanique de Zod)
- Optionnel : 1 cas e2e qui curl `/api/docs/openapi.json` et vérifie que le payload contient `paths`/`components`/etc.

**Précédents codebase** :
- Sprint Zod-Rollout-Money-First → v8 (CLAUDE.md §11) — ~50 routes migrées Zod, schemas dans `lib/schemas/`
- Sprint Refactor-I5 — `parseBody` helper installé

### 3. Spécifications fonctionnelles attendues

**Cas nominal — Visualiser la doc** :
- Hit `/api/docs` (browser ou Swagger client)
- Voir une page HTML avec Swagger UI affichant toutes les routes + schemas
- Pouvoir cliquer sur une route, voir le request body schema (JSON Schema dérivé de Zod), tester en playground (auth header requis)

**Cas nominal — JSON brut** :
- Hit `/api/docs/openapi.json`
- Voir le OpenAPI 3.0 JSON brut (consumable par n'importe quel client OpenAPI : Postman import, Insomnia, etc.)

**Cas edge** :
- Schema Zod custom validation (refine, custom error message) → mapper le mieux possible vers OpenAPI (limitations connues sur refines complexes)

**Cas erreur** :
- Si un schema casse la génération → graceful fail, log warning, continue sans cette route dans la doc

### 4. Contraintes techniques

- **Style** : conventions CLAUDE.md §6 strictes
- **Pas de modif des schemas** : `lib/schemas/*.ts` restent intacts. Le registry central importe et annote.
- **Pas de duplication** : ne PAS créer une 2e source de vérité (e.g. annotation manuelle des paths) — utiliser un mapping centralisé `{ path: '/api/finance/budgets', method: 'POST', schema: createBudgetBodySchema, ... }` dans `lib/openapi/registry.ts`
- **Auth header** : doc Swagger doit indiquer `cookie session` requis (pour les playground tests)
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Performance** : la génération OpenAPI est lazy (au premier hit) ou build-time (préféré pour éviter overhead runtime)
- **Sécurité** : route `/api/docs` doit-elle être prod-bloquée ? À arbitrer Phase 1. Recommandé : public (les schemas sont déjà inférables par grep le repo public, et Swagger UI est pratique en dev OU prod pour les API consumers).

### 5. Critères d'acceptation vérifiables

- [ ] **Route `/api/docs/openapi.json`** : retourne 200 + JSON OpenAPI 3.0 valide (validate via swagger-cli ou online validator)
- [ ] **Route `/api/docs`** : retourne 200 + HTML Swagger UI fonctionnel
- [ ] **Coverage** : au moins 80% des routes API listées dans la doc (les 20% manquants = routes débug/auth qui peuvent être skip)
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0
- [ ] **build** : `pnpm build` exit 0, +2 routes (docs)
- [ ] **smoke browser** : ouvrir `/api/docs` dans Chrome → Swagger UI rendered, click route → request schema visible

### 6. Tests à écrire ou à mettre à jour

#### Optionnel — Test e2e simple

```typescript
// app/api/docs/__tests__/route.test.ts (mocked)
it('returns valid OpenAPI 3.0 JSON', async () => {
  const res = await GET(new NextRequest('http://localhost/api/docs/openapi.json'))
  const body = await res.json()
  expect(body.openapi).toMatch(/^3\./)
  expect(body.paths).toBeDefined()
  expect(Object.keys(body.paths).length).toBeGreaterThan(20) // au moins 20 routes
})
```

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (DX gain)
  - **§4** : ajout entrée `lib/openapi/registry.ts` + `app/api/docs/`
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint OpenAPI-Schema-To-Docs** (R10) : ...`
- **README.md** : section "API documentation" avec lien `/api/docs`
- **next-steps.md** : pas concerné

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify

# 2. Phase 1 — choix outil
# Évaluer @asteasolutions/zod-to-openapi (most popular) vs zod-to-openapi vs next-zod-route
# Décision : @asteasolutions/zod-to-openapi (mature, maintenu, support OpenAPI 3.x)

# 3. Install deps
pnpm add @asteasolutions/zod-to-openapi swagger-ui-dist
# (swagger-ui-dist pour servir le HTML statique sans react peer-dep)

# 4. Implementation
# Write lib/openapi/registry.ts (registry central)
# Write app/api/docs/openapi.json/route.ts (génération JSON)
# Write app/api/docs/route.ts (HTML Swagger UI)

# 5. Tests + validation
pnpm typecheck
pnpm lint:check
pnpm test:run
pnpm build  # devrait montrer 57 routes (vs 55) — 2 nouvelles docs
pnpm dev
# curl http://localhost:3000/api/docs/openapi.json  # JSON valide
# Open http://localhost:3000/api/docs  # Swagger UI
```

## Pièges connus / points d'attention

- **Discriminated unions** : `@asteasolutions/zod-to-openapi` supporte les `z.discriminatedUnion` mais le mapping `oneOf` peut être verbose. Vérifier le rendu Swagger UI sur `transferSavingsBodySchema` (Sprint Zod-Rollout-Money-First) ou `completeBodySchema` (nested discriminator).
- **Refines custom** : les `.refine()` Zod ne se traduisent pas parfaitement en OpenAPI (peuvent devenir un description text seulement). Acceptable.
- **Path mapping** : Next.js App Router `[id]` segments → OpenAPI `{id}` path params. Mapping manuel dans le registry.
- **Schema ID** : tous les schemas exportés doivent avoir un `id` unique pour le registry (cela peut nécessiter un wrapper `registerSchema(z.object(...), { id: 'CreateBudget' })`).
- **Build-time vs runtime** : si la génération est runtime (au premier hit), overhead minimal mais cache nécessaire pour éviter regen à chaque requête. Si build-time, ajouter un script `pnpm openapi:gen` qui écrit `public/openapi.json` static.
- **Sécurité prod** : si la route est publique, les schemas sont visibles → audit info disclosure. Pour Popoth (PWA solo+groupe, pas de B2B), risk acceptable.
- **Pre-existing dirty working tree** : exclure des commits.

## Découpage en sous-tâches (M → 3-4 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 + install deps. Commit `chore(deps): add @asteasolutions/zod-to-openapi + swagger-ui-dist`.
2. **Sub-2 (Effort : S)** — Registry central + route JSON. Commit `feat(api): generate OpenAPI 3.0 from Zod schemas`.
3. **Sub-3 (Effort : XS)** — Route HTML Swagger UI. Commit `feat(api): serve Swagger UI at /api/docs`.
4. **Sub-4 (Effort : XS)** — Tests + closeout. Commit `test(api): smoke OpenAPI generation` + `docs: closeout R10 OpenAPI`.

## Recovery path

- `git revert` chacun des commits. Pas de migration DB. Aucun impact sur les routes existantes.

## Précédents codebase (références)

- Sprint Zod-Rollout-Money-First → v8 (CLAUDE.md §11) — schemas Zod source de vérité
- Sprint Refactor-I5 — `parseBody` helper

---

**Estimation totale** : demi-journée (4-6h). Ferme R10 audit. DX gain pour onboarding + API consumers. Score métier ~99.999 stable.
