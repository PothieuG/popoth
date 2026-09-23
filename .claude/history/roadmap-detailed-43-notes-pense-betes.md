# Part 43 — Notes / pense-bêtes perso et groupe (2026-09-23)

> 1 sprint. Première fonctionnalité non financière de l'app : un endroit pour
> noter des pense-bêtes, privés sur le dashboard perso, partagés entre tous les
> membres sur le dashboard groupe, avec l'avatar de l'auteur devant chaque note.

## 1. La demande

Suggestion d'une utilisatrice (groupe de 2 personnes) : « un onglet ou un endroit
Notes pour noter des penses-bêtes ». L'emplacement a été discuté avant de coder :

| Emplacement envisagé                            | Verdict | Raison                                                                                                         |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| 4e onglet du drawer Planification               | ❌      | 3 onglets déjà, 2 taps pour lire un rappel, sujet ≠ « budgets et revenus »                                     |
| 4e onglet de la BottomNav                       | ❌      | La nav sert à basculer perso ↔ groupe ; un écran Notes n'appartient à aucun des deux                           |
| Icône dans le header                            | ❌      | Header déjà dense (règle « texte qui pousse le navbar » = bug bloquant), rappel peu visible                    |
| Menu avatar (Settings)                          | ❌      | Ouvert rarement → notes oubliées                                                                               |
| **Ligne du dashboard, partagée avec Économies** | ✅      | Visible au premier coup d'œil, 0 px de hauteur prise à la liste des transactions (compromis choisi par l'user) |

Réponses user : notes **partagées au sein du groupe**, avatar de l'auteur devant
chaque note, ligne `Économies (montant)` | `Notes` à la place de l'ancienne ligne
« Montant total de vos économies ». Question « texte libre ou liste à cocher »
restée sans réponse → **texte libre** (le plus simple ; supprimer = « fait »).

## 2. Base — table `notes` (migration `20260923000000_create_notes.sql`)

- Colonnes : `id`, `profile_id` | `group_id` (CHECK d'exclusivité, miroir
  `savings_projects`), `created_by_profile_id`, `content`, `created_at`,
  `updated_at` (trigger `update_updated_at_column`).
- `content` : CHECK non vide après trim + `char_length ≤ 1000`, miroir de
  `NOTE_CONTENT_MAX_CHARS` ([lib/constants/notes.ts](../../lib/constants/notes.ts)).
- FK : `profile_id`/`group_id` → `ON DELETE CASCADE` ; `created_by_profile_id` →
  `ON DELETE SET NULL` (miroir `real_expenses`) — la note d'un membre qui supprime
  son compte reste visible pour les autres.
- **RLS activée sans policy** (table server-only, convention git-workflow §12,
  précédent `monthly_recaps`) : seul le client service_role des routes y accède.
- **Aucune RPC** : chaque écriture touche une ligne, aucune colonne sensible.
  `EXPECTED_RPCS` reste à 28.
- `lib/database.types.ts` complété **à la main** (bloc `notes` entre
  `monthly_recaps` et `piggy_bank`, ordre du générateur) : la migration n'était
  appliquée sur aucune base au moment du commit (cf. §6).

## 3. API — `lib/api/notes.ts` (+ `app/api/notes/route.ts`, `app/api/notes/[id]/route.ts`)

| Route                    | Rôle                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| `GET /api/notes`         | `?context=profile\|group`, plus récentes d'abord                   |
| `POST /api/notes`        | crée dans le contexte, `created_by_profile_id = userId` (set-once) |
| `PUT /api/notes/[id]`    | modifie le contenu seul                                            |
| `DELETE /api/notes/[id]` | supprime                                                           |

- `withAuthAndGroup` (0 lecture DB), `parseQuery(contextOnlyQuerySchema)`,
  `parseBody(createNoteBodySchema | updateNoteBodySchema)` ([lib/schemas/notes.ts](../../lib/schemas/notes.ts)).
- **Contrôle d'accès dans la requête d'écriture elle-même** : `UPDATE`/`DELETE`
  filtrés par `.eq('id').or('profile_id.eq.<user>,group_id.eq.<groupe>')` puis
  `.select().maybeSingle()` → 0 ligne ⇒ 404. Pas de `SELECT` préalable (le
  pattern projets en fait un), une requête au lieu de deux.
- Id invalide ⇒ **404** via `uuidSchema.safeParse` (et non `parse` : un `ZodError`
  brut n'est pas un `BadRequestError` et tomberait en 500 — c'est le cas des
  routes projets, laissé tel quel).
- JOIN auteur `created_by:profiles!notes_created_by_profile_id_fkey(id, first_name, last_name)` :
  hint FK obligatoire (2 FK vers `profiles`), **jamais `avatar_url`** (Part 42 §11).
- Réponses `{ notes }` / `{ note }` / `{ message }`, miroir des routes projets.
- Enregistrées dans le registre OpenAPI (tag `notes`). Routes : 46 → **48**.

## 4. Client

- [hooks/useNotes.ts](../../hooks/useNotes.ts) : `useQuery ['notes', context]` + 3
  `useMutation` qui écrivent le cache via `setQueryData`. **Pas**
  d'`invalidateFinancialRefreshes` : une note n'est pas une donnée financière.
- Préchargée par `DashboardDataPrefetch` (7e requête) : le compteur est là dès le
  premier rendu, sans 2e vague.
- Tirer-pour-rafraîchir invalide aussi `['notes']` (layout dashboards) — c'est le
  geste pour voir la note qu'un autre membre vient d'écrire. Pas de temps réel.
- [components/dashboard/FinancialIndicators.tsx](../../components/dashboard/FinancialIndicators.tsx) :
  l'ancienne ligne violette pleine largeur devient une grille
  `grid-cols-[minmax(0,1fr)_auto]` — `Économies (1 234,50 €)` | `Notes` + pastille
  compteur (ardoise `slate-*`, couleur neutre hors charte métier).
  - **Écart assumé au « moitié / moitié »** demandé : en 2 colonnes égales, le
    montant était tronqué dès 375 px (« Économies (1 234,… », capture Playwright
    375/390/430). Notes prend la largeur de son contenu, Économies le reste :
    montant entier jusqu'à 123 456,78 € sur les 3 largeurs, `truncate` + `title`
    au-delà.
- [components/dashboard/NotesDrawer.tsx](../../components/dashboard/NotesDrawer.tsx) :
  Radix `Dialog` + `DRAWER_CONTENT_CLASSES`, header ardoise, formulaire d'ajout
  en tête (RHF + `zodResolver(createNoteBodySchema)`, `preventEnterSubmit`,
  `aria-describedby`, `role="alert"` sur l'erreur serveur, `InlineSpinner`),
  liste `UserAvatar` + prénom (« Vous » pour soi) + date courte, menu
  Modifier (édition en place) / Supprimer (`ConfirmationDialog`), skeletons sur
  `loading || isFetching`.
  - Avatar résolu par `resolveNoteAuthor` : profil courant → `useGroupMembers`
    (cache de l'en-tête groupe) → initiales du JOIN (ancien membre) → `??`.

## 5. Tests (+42 non-gated : 988 → 1030)

- `lib/api/__tests__/notes.test.ts` (22) : scope perso/groupe, groupe absent,
  auteur à l'INSERT, trim/vide/1000/1001 caractères, filtre d'accès PUT/DELETE,
  404 id invalide sans requête, JOIN sans `avatar_url`.
- `components/dashboard/__tests__/NotesDrawer.test.tsx` (14) : avatars moi /
  membre / ancien membre, libellés perso/groupe, ajout trimé + reset, note vide
  refusée, échec serveur, édition, suppression confirmée, Échap, axe.
- `components/dashboard/__tests__/FinancialIndicators.notes.test.tsx` (6) :
  montant, skeleton, ouverture des 2 drawers, compteur, contexte par défaut.
- `DashboardDataPrefetch.test.tsx` : 7 requêtes amorcées (dont `useNotes`).

Hors sprint : 4 suites `lib/recap/__tests__/*` échouent à l'import sans
`NEXT_PUBLIC_SUPABASE_URL` (conteneur sans `.env.local`) ; vertes avec des
valeurs factices.

## 6. Déploiement — à faire hors conteneur

Le conteneur de développement n'avait ni `SUPABASE_ACCESS_TOKEN` ni accès réseau à
`api.supabase.com` : **la migration n'est appliquée sur aucune base**.

1. Dev (`ddehmjucyfgyppfkbddr`, pas de tracker) :
   `node scripts/apply-sql.mjs supabase/migrations/20260923000000_create_notes.sql`
   avec `SUPABASE_PROJECT_REF=ddehmjucyfgyppfkbddr`.
2. Prod : push gate standard (`db push --dry-run` → confirmation → `db push`),
   puis `pnpm db:types` + `db:check-types-fresh` (le bloc écrit à la main doit
   ressortir identique), re-export baseline + `db:check-drift`, `db:check-rls`.
3. Tant que la table n'existe pas, `GET /api/notes` répond 500 : la demi-ligne
   Notes s'affiche sans compteur et le drawer montre « Impossible de charger les
   notes » — le reste du dashboard n'est pas affecté.
