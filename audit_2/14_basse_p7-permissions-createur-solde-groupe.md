# 14 — P7 : Permissions créateur sur solde groupe

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P7](../next-steps.md) (backlog produit) |
| **Type** | feature (authz UI + API) |
| **Priorité** | Basse |
| **Effort estimé** | S (1-2h) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

next-steps.md P7 :

> ## P7 — Permissions créateur sur solde groupe
>
> **Domaine** : groups / permissions
>
> Seul le créateur d'un groupe peut changer le solde disponible du groupe dans les options. Les autres membres ne doivent pas voir cette action.

**Compréhension** : actuellement, n'importe quel membre du groupe peut probablement modifier `bank_balances` du groupe (à confirmer Phase 1). Le bouton "Modifier le solde" / `EditBalanceModal` doit être :
1. **UI** : caché si l'utilisateur n'est pas `is_creator: true` du groupe
2. **API** : protégé serveur-side (defense in depth) — `PATCH /api/bank-balance` (group context) doit refuser si `userId !== group.creator_id`

**Architecture pertinente** :
- `app/api/bank-balance/route.ts` (handler PATCH/POST/GET — ajouter check creator-only pour PATCH/POST en group context)
- `components/dashboard/EditBalanceModal.tsx` (UI modal)
- `components/dashboard/FinancialIndicators.tsx` ou parent — bouton "Modifier le solde" qui ouvre la modal
- `hooks/useGroups.ts` — exposer `isCreator(groupId)` ou similaire (probablement déjà via `groups.is_creator` field)

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Implémenter une protection authz à 2 niveaux pour la modification du solde groupe :
1. **UI** : masquer le bouton "Modifier le solde" sur `/group-dashboard` si `!isCreator(currentGroup)`
2. **API** : refuser PATCH/POST `/api/bank-balance` (group context) avec 403 si `userId !== group.creator_id`

Sans casser : le solde profile reste modifiable par le profile owner sur `/dashboard`.

### 2. Contexte technique

**Fichiers concernés** :
- `app/api/bank-balance/route.ts` (ajouter check creator-only en group context)
- `components/dashboard/FinancialIndicators.tsx` (ou parent) — bouton conditionnel
- `app/group-dashboard/page.tsx` — passer `isCreator` au composant indicator
- Tests : créer cas RTL + cas API

**État actuel à confirmer Phase 1** :
- Read `app/api/bank-balance/route.ts` : check actuel = juste `withAuth(AndProfile)` avec `profile.group_id`. Pas de filtrage creator vs member.
- Read `components/dashboard/FinancialIndicators.tsx` : bouton "Modifier" toujours visible
- Read `hooks/useGroups.ts` : `groups[].is_creator` field disponible

**Tests existants pertinents** :
- Pas de test direct authz bank-balance creator-only
- `lib/__tests__/api-regressions.test.ts` couvre bank-balance partiellement

**Précédents codebase** :
- Sprint DB / D2 — RLS policies (pour info, mais bank-balance est server-side route avec service_role bypass)

### 3. Spécifications fonctionnelles attendues

**Cas nominal — Creator** :
- User créateur du groupe G voit le bouton "Modifier le solde" sur `/group-dashboard`
- Click → EditBalanceModal s'ouvre, modify, submit → 200 + DB update
- Membres voient la nouvelle valeur après refetch (TanStack Query invalidation)

**Cas nominal — Non-creator** :
- User membre non-creator du groupe G ne voit PAS le bouton "Modifier le solde"
- Si essaie via curl/devtools direct sur API → 403 + `{ error: 'Action réservée au créateur du groupe' }`

**Cas edge** :
- Profile context (utilisateur sur `/dashboard`) → behavior inchangé, profile owner peut modifier son solde
- User pas dans aucun groupe → pas concerné

**Cas erreur** :
- 403 sur API → frontend affiche un toast/error inline

### 4. Contraintes techniques

- **Style** : conventions CLAUDE.md §6 strictes
- **Defense in depth** : UI ET API ; ne pas se fier à UI seule
- **Wrapper auth existant** : `withAuthAndProfile` extend déjà `profile.group_id` mais pas `group.creator_id`. Faire un fetch supplémentaire dans le handler ou utiliser une check function
- **A11y** : si bouton retiré, ne pas casser l'accessibilité du composant parent

### 5. Critères d'acceptation vérifiables

- [ ] **UI** : `/group-dashboard` membre non-creator : bouton "Modifier solde" absent
- [ ] **API** : curl PATCH `/api/bank-balance` avec session non-creator → 403
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0
- [ ] **tests** : +2 cas (1 RTL UI + 1 mocked API 403)
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** : compte test créateur + 1 membre dans le même groupe → tester les 2 vues

### 6. Tests à écrire ou à mettre à jour

#### RTL non-gated `components/dashboard/__tests__/FinancialIndicators.test.tsx` (ou nouveau)

```typescript
it('hides "Modifier solde" button for non-creator group members', () => {
  // Mock useGroups → currentGroup.is_creator = false
  render(<FinancialIndicators ... />)
  expect(screen.queryByText(/modifier le solde/i)).not.toBeInTheDocument()
})

it('shows button for creator', () => {
  // Mock useGroups → currentGroup.is_creator = true
  ...
  expect(screen.getByText(/modifier le solde/i)).toBeInTheDocument()
})
```

#### Mocked non-gated `app/api/bank-balance/__tests__/route.test.ts` (nouveau)

```typescript
it('returns 403 if non-creator tries to PATCH group bank-balance', async () => {
  // Mock withAuthAndProfile → profile.group_id = 'g1'
  // Mock supabase fetch group → creator_id = 'other-user'
  // ...
  expect(res.status).toBe(403)
})
```

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint P7-Authz-Solde-Groupe** : ...`
- **next-steps.md** : retirer P7

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify

# 2. Phase 1 audit
# Read app/api/bank-balance/route.ts
# Read components/dashboard/FinancialIndicators.tsx + parents
# Read hooks/useGroups.ts (is_creator field)

# 3. Implementation
# Edit app/api/bank-balance/route.ts : ajouter check creator si group context
# Edit FinancialIndicators.tsx : conditionnel sur isCreator

# 4. Tests
pnpm test:run

# 5. Validation totale
pnpm typecheck && pnpm lint:check && pnpm format:check && pnpm build

# 6. Smoke browser
pnpm dev
# Compte test créateur + non-créateur même groupe
```

## Pièges connus / points d'attention

- **`creator_id` field** : confirmer le nom exact dans `groups` table (peut être `created_by` ou `owner_id` selon historique)
- **Race condition** : si user perd son statut creator entre UI render et API call (improbable), API doit gate
- **Tests CRUD existants** : peuvent casser si `withAuthAndProfile` extend signature pour inclure creator info — adapter
- **Pre-existing dirty working tree** : exclure

## Découpage en sous-tâches (S → 2 commits)

1. **Sub-1 (Effort : S)** — Implementation API + UI + tests. Commit `feat(groups): restrict bank-balance edit to creator (P7)`.
2. **Sub-2 (Effort : XS)** — Closeout doc. Commit `docs: closeout P7`.

## Recovery path

- `git revert` du commit. Pas de migration DB.

## Précédents codebase

- Sprint DB / D2 — RLS policies (pas directement applicable — bank-balance route en service_role)

---

**Estimation totale** : 1-2h. Ferme P7. Score ~99.999 stable.
