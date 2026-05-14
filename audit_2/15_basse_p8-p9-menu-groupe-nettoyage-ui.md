# 15 — P8+P9 : Menu groupe — nettoyage UI

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P8](../next-steps.md) + [P9](../next-steps.md) (backlog produit, couplés UI) |
| **Type** | feature (cleanup UI menu groupe) |
| **Priorité** | Basse |
| **Effort estimé** | S (1-2h) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

next-steps.md P8 + P9 :

> ## P8 — Menu groupe : nettoyage UI
>
> **Domaine** : groups / settings
>
> Dans le menu du groupe (settings) :
>
> - Enlever la pastille "créateur".
> - Enlever l'option de suppression.
> - Enlever la box du bas.
>
> ## P9 — Menu "Mon groupe" : retirer "Se déconnecter"
>
> **Domaine** : groups / settings
>
> Enlever l'entrée "Se déconnecter" dans les options "Mon groupe" — la déconnexion n'a rien à faire ici, elle est dans le menu utilisateur global.

**Compréhension** : 5 sous-items UI cleanup dans le menu groupe (path probablement `/groups` ou `/settings` ou drawer dédié) :
- P8.1 : retirer la pastille "Créateur" visuelle
- P8.2 : retirer l'option "Supprimer le groupe"
- P8.3 : retirer "la box du bas" (à clarifier Phase 1 — probablement section info ou CTA secondaire)
- P9.1 : retirer "Se déconnecter" du menu groupe

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Nettoyer le menu/settings groupe en retirant 4 éléments UI spécifiés P8+P9 sans casser les fonctionnalités sous-jacentes (e.g. la suppression de groupe peut rester accessible ailleurs si besoin produit, mais pas dans ce menu spécifique).

### 2. Contexte technique

**Fichiers concernés (à confirmer Phase 1)** :
- `components/groups/UserGroupsList.tsx` (probablement contient pastille "Créateur" L77-79) — déjà investigué chantier 03
- `app/groups/page.tsx` ou `app/settings/page.tsx` — page parent
- Composants children : `GroupSettingsMenu.tsx` ou similaire si existe
- `components/groups/DeleteGroupModal.tsx` — modal suppression (à conserver, juste retirer l'entry point UI)

**État actuel à confirmer Phase 1** :
- Read `app/groups/page.tsx` ou wherever le menu groupe est rendu
- Identifier les 4 éléments à retirer
- Confirmer que la fonctionnalité "Supprimer le groupe" reste accessible ailleurs si nécessaire (ou est retirée totalement)

### 3. Spécifications fonctionnelles attendues

**Cas nominal** :
- User va sur menu/settings groupe (path à confirmer Phase 1)
- Ne voit plus : pastille "Créateur" + bouton "Supprimer" + box bottom + entrée "Se déconnecter"
- Voit toujours : nom du groupe, infos basiques, "Voir membres" (si applicable), "Quitter" (si non-creator)

**Cas edge** :
- Si le créateur veut supprimer son groupe, l'UI doit indiquer une autre voie (e.g. depuis `/dashboard` ou ne plus permettre du tout)
- Logout reste accessible via le menu utilisateur global (probablement avatar dropdown en header)

### 4. Contraintes techniques

- **Style** : conventions CLAUDE.md §6
- **A11y** : ne pas casser les autres entrées du menu
- **Pre-existing tests** : si un test RTL teste la présence de la pastille "Créateur" ou du bouton "Supprimer" dans ce menu, l'adapter

### 5. Critères d'acceptation vérifiables

- [ ] **4 éléments retirés** : grep confirme absence (e.g. `Grep "Créateur" components/groups/<menu-file>.tsx` retourne 0 hit)
- [ ] **Suppression alternative** : si nécessaire, accessible ailleurs (à valider UX avec user)
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0
- [ ] **tests** : adaptation des cas RTL existants si nécessaire
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** : menu groupe visuellement nettoyé

### 6. Tests à écrire ou à mettre à jour

- Adapter les tests RTL existants (si présents) qui assertent la présence des éléments retirés
- Pas de nouveau test requis (cleanup UI mécanique)

### 7. Documentation à mettre à jour

- **CLAUDE.md** : §11 Roadmap entrée `✅ **Sprint P8-P9-Menu-Groupe-Cleanup**`
- **next-steps.md** : retirer P8 + P9

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify

# 2. Phase 1 audit
# Read app/groups/page.tsx + composants children
# Identifier les 4 éléments

# 3. Implementation : remove 4 UI bits

# 4. Validation totale
pnpm typecheck && pnpm lint:check && pnpm format:check && pnpm test:run && pnpm build

# 5. Smoke browser
pnpm dev
# Visiter le menu groupe, vérifier nettoyage
```

## Pièges connus / points d'attention

- **"La box du bas"** : ambigu, à clarifier Phase 1 avec user (capture d'écran annoté de l'avant-après idéal)
- **Suppression de l'option "Supprimer"** : si totalement retirée, le créateur n'a plus moyen de supprimer son groupe → décision produit. Recommandé : confirmer Phase 1 si on retire totalement OU on déplace.
- **Pre-existing dirty working tree** : exclure

## Découpage en sous-tâches (S → 2 commits)

1. **Sub-1 (Effort : S)** — Cleanup UI 4 éléments. Commit `feat(groups): clean group menu UI (P8 + P9)`.
2. **Sub-2 (Effort : XS)** — Closeout doc.

## Recovery path

- `git revert`. Pas de migration DB.

## Précédents codebase

- Sprint Zod-Rollout v8 — DeleteGroupModal migré Radix Dialog (composant à conserver, juste détacher du menu)

---

**Estimation totale** : 1-2h. Ferme P8 + P9. Score ~99.999 stable.
