# 19 — ⏰ DORMANT : `withCompensatingRollback()` abstraction

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint Atomicity-Savings v2 + Sprint Atomicity-Expenses (Hors scope) |
| **Type** | refactor (abstraction utilitaire) |
| **Priorité** | Basse |
| **Effort estimé** | S (1-2h) post-I6 |
| **Statut** | **⏰ DORMANT — déclencher si ≥5 sites compensating-rollback cross-repo après chantier 01 (I6)** |
| **Dépendances** | Aucune (déclenché par trigger : seuil de 5+ sites identique pattern) |
| **Bloque** | — |

## Contexte

CLAUDE.md §11 entrée Sprint Atomicity-Expenses (Hors scope) :

> abstraction `withCompensatingRollback()` → prématurée tant que <5 sites cross-repo.

CLAUDE.md §11 entrée Sprint Atomicity-Savings v2 :

> abstraction `withCompensatingRollback()` → prématurée tant que <5 sites cross-repo (après ce sprint il en reste 1 = auto-balance).

**Contexte historique** :
- Sprint Refactor-Test-Coverage (CLAUDE.md §11) a regression-guardé 3 cleanup-attempts CRITIQUES dans `savings/transfer/route.ts`
- Sprint Atomicity-Expenses (CLAUDE.md §11) a fermé le gap atomicity du smart-allocation via composite RPC
- Sprint Atomicity-Savings (CLAUDE.md §11) a fermé les 3 cleanup-attempts L122/L321/L337 via 2 composite RPCs
- Sprint Atomicity-Savings v2 (CLAUDE.md §11) a supprimé `handlePiggyBankAction` (closed-by-deletion)
- **Reste 1 site** : `auto-balance/route.ts` reversed RPC→INSERT pattern (chantier 13)
- **Si chantier 01 (I6) extrait `complete/route.ts` et expose 4-5 nouveaux sites compensating-rollback** → seuil 5+ atteint, abstraction justifiée

**Pattern proposé** :

```typescript
// lib/api/compensating-rollback.ts
export async function withCompensatingRollback<T>(opts: {
  forward: () => Promise<T>
  rollback: () => Promise<void>
  onRollbackFail?: (err: unknown) => void
  context?: string
}): Promise<T> {
  try {
    return await opts.forward()
  } catch (forwardErr) {
    try {
      await opts.rollback()
    } catch (rollbackErr) {
      logger.error(`[${opts.context ?? 'compensating-rollback'}] Rollback impossible after forward failure`, { forwardErr, rollbackErr })
      opts.onRollbackFail?.(rollbackErr)
    }
    throw forwardErr
  }
}
```

**Bénéfice** :
- DRY : pattern dupliqué 5 fois → 1 site centralisé
- Testabilité : 1 cas pure-unit couvre tous les sites
- Cohérence : `logger.error` standardisé pour cleanup-attempts
- Documentation : 1 jsdoc explique le pattern

## Trigger d'activation

**Activer ce chantier SI** :
- Après chantier 01 (I6), grep cross-codebase identifie ≥ 5 sites avec pattern `try { forward } catch { try { rollback } catch { logger.error('Rollback impossible') } throw }`
- OU un nouveau site compensating-rollback est ajouté dans un futur sprint et le compteur passe ≥ 5

**NE PAS activer si <5 sites** : abstraction prématurée (CLAUDE.md system prompt "Three similar lines is better than premature abstraction").

## Prompt prêt à l'emploi (à utiliser le jour J)

> Copier-coller dans une nouvelle session Claude Code SI seuil 5+ atteint.

### 1. Objectif

Extraire le pattern compensating-rollback dans un helper `lib/api/compensating-rollback.ts` réutilisable, migrer les 5+ sites identifiés, ajouter tests pure-unit, et documenter dans CLAUDE.md §6 Conventions.

### 2. Contexte technique

**Fichier nouveau** : `lib/api/compensating-rollback.ts` (~30-50 LOC + JSDoc)

**Fichiers à migrer** : 5+ sites identifiés Phase 1 (probablement dans `lib/recap/{step1-persist,complete-persist,auto-balance-persist,balance-persist}.ts` + `lib/api/finance/expenses-add-with-logic.ts` historique)

**Tests existants** : Pin ATOMIC CONTRACT tests (Sprint Atomicity-Expenses + Atomicity-Savings) doivent rester verts post-migration.

### 3. Critères d'acceptation

- [ ] Helper créé + 5+ sites migrés
- [ ] Tests pure-unit `lib/api/__tests__/compensating-rollback.test.ts` : 4-6 cas (happy / forward fail / rollback fail / both fail / contextual logging)
- [ ] Tests gated atomicity régressifs passent
- [ ] CLAUDE.md §6 Conventions ajoute le pattern + bullet "À faire / Ne pas réintroduire de logique manuelle compensating-rollback"
- [ ] Lint baseline stable

### 4. Étapes (compactes)

```powershell
# Phase 1 : grep cross-codebase pattern compensating-rollback (confirmer ≥5 sites)
# Phase 2 : créer helper + tests pure-unit
# Phase 3 : migration site-by-site (1 commit par site ou bundlé selon scope)
# Phase 4 : closeout doc CLAUDE.md
```

## Pièges connus (le jour J)

- **Préservation des messages d'erreur exacts** : les tests Pin ATOMIC CONTRACT assertent des messages spécifiques. Le helper doit les préserver via `context` param.
- **Async + closure scope** : le pattern dans `lib/recap/step1-persist.ts` peut référencer des variables locales du flow. L'abstraction doit prendre des callbacks closures, pas modifier la sémantique.
- **`logger.error` vs `logger.warn`** : décision case-by-case. Le helper expose une option pour overrider.

---

**Estimation totale** : 1-2h. Score métier inchangé. **Ne pas activer si <5 sites** — pattern "design for hypothetical" refused. DORMANT par design.
