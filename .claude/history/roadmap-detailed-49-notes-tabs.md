# Part 49 — Notes à 3 onglets : Courses, Notes, Projets (2026-10-03)

> 1 sprint. Demande de l'utilisateur : améliorer le drawer Notes
> ([Part 43](roadmap-detailed-43-notes-pense-betes.md)) avec 3 onglets —
> **Courses** (cases à cocher, texte « très légèrement » barré une fois coché),
> **Note** (l'existant, inchangé), **Projet** (une liste simple).

## 1. Décisions produit (validées par l'utilisateur)

| Question                     | Réponse                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Une ligne « Projet » ?       | Ligne courte, **sans case** ni texte barré (sans lien avec les projets d'épargne)              |
| Articles de courses cochés ? | Légèrement barrés, **descendent en bas**, **supprimés 7 jours après** (réponse libre « wipe ») |
| Compteur du dashboard ?      | **Tout ce qui reste** : courses non cochées + notes + projets                                  |
| Onglet à l'ouverture ?       | **Le dernier utilisé**, Courses la toute première fois                                         |

Choix faits sans question (signalés à l'utilisateur) : pas d'avatar ni de date
devant un article ou un projet, même en groupe (liste compacte) ; pas de bouton
« vider les cochés » (le ménage à 7 jours le remplace) ; Entrée ferme le clavier
sans ajouter (règle `preventEnterSubmit`, modals) — le bouton « Ajouter » ne
fait pas perdre le focus au champ, on enchaîne les articles clavier ouvert.

## 2. Base — migration `20261003000000_add_notes_kind_and_checked_at.sql`

- Même table `notes` pour les 3 onglets (propriétaire, partage groupe, contrôle
  d'accès identiques) : colonne `kind text NOT NULL DEFAULT 'note'` + CHECK
  `notes_kind_check` (`note | shopping | project`, miroir `NOTE_KINDS`). Les
  notes existantes deviennent `note` via le DEFAULT.
- `checked_at timestamptz` (NULL = à acheter) + CHECK
  `notes_checked_at_shopping_only_check` (réservé aux courses).
- Table hors snapshots (exclue de `snapshots.restorable_tables()`, Part 44) :
  aucun impact sur la sauvegarde de fin de mois. Aucune RPC.
- `lib/database.types.ts` complété **à la main** (migration appliquée sur
  aucune base au moment du commit, cf. §6).

## 3. API — `lib/api/notes.ts`

- `GET` : toutes les lignes du contexte (le drawer filtre par `kind`). Avant la
  lecture, **ménage** : `DELETE … kind = shopping AND checked_at < now − 7 j`
  dans le même périmètre (perso ou groupe). Pas de tâche planifiée ; un échec du
  ménage est loggé et ne bloque pas la liste.
- `POST` : `kind` optionnel (défaut `note` — clients d'avant les onglets).
- `PUT` : `{ content }` **ou** `{ checked }` (`z.union`). Cocher filtre aussi
  `kind = shopping` : viser une note ou un projet ⇒ 0 ligne ⇒ 404.
- `checked_at` = horodatage **technique** (heure réelle, comme
  `applied_to_balance_at`), pas `now()` de `lib/clock` : la rétention compte des
  jours réels, date simulée ou non.
- Constantes : `NOTE_KINDS`, `SHOPPING_CHECKED_RETENTION_DAYS = 7`
  ([lib/constants/notes.ts](../../lib/constants/notes.ts)). Messages Zod rendus
  neutres (« Le texte ne peut pas être vide ») : communs aux 3 onglets.

## 4. Client

- [hooks/useNotes.ts](../../hooks/useNotes.ts) : toujours **une** query
  `['notes', context]` (le compteur et les 3 onglets la partagent, 0 requête de
  plus). `addNote(content, kind)`, `toggleChecked(id, checked)` **optimiste**
  (réponse immédiate en magasin) avec retour arrière **limité à l'article** en
  cas d'échec — restaurer la liste entière défaisait un 2e article coché
  entre-temps. `pendingCount` (compteur) via `isPendingNote`.
- [NotesDrawer.tsx](../../components/dashboard/NotesDrawer.tsx) : barre
  d'onglets au gabarit de `PlanningDrawer` (teinte ardoise, `role="tablist"`,
  `aria-selected`, `aria-controls` sur l'onglet actif seulement — axe refuse un
  id absent). Configuration par onglet (`TABS` : libellés, vides, erreurs,
  confirmation de suppression). Dernier onglet en `localStorage`
  (`notes-drawer-tab`, try/catch, valeur inconnue ⇒ Courses).
  - Courses : case native + `<label>` (tout le libellé est cliquable), cochés
    `text-gray-400 line-through decoration-gray-300` sous un intertitre
    « Dans le panier · retirés au bout de 7 jours », derniers cochés en tête
    (`splitShoppingItems`, tri `Date.parse` : horodatages `+00:00` et `Z` mêlés).
  - Projets : puce + texte. Édition en place et suppression confirmée partout.
  - Formulaire : `multiline` (Notes) ou champ d'une ligne + bouton à droite.
- Vérifié en navigateur (Chromium mobile, 375/390/430 px, page de
  prévisualisation temporaire non commitée) : aucun débordement horizontal ;
  l'échec réel d'un cochage (401) remet la case et affiche l'erreur.

## 5. Tests (+33 non-gated : 1222 → 1255)

- `lib/api/__tests__/notes.test.ts` (+11) : ménage avant lecture (date de
  coupure, périmètre), échec du ménage non bloquant, `kind` à l'INSERT (défaut,
  3 onglets, inconnu ⇒ 400), cocher / décocher, 404 hors courses, 400 non booléen.
- `hooks/__tests__/useNotes.test.tsx` (nouveau, 6) : compteur, `kind` envoyé,
  cochage optimiste puis horodatage serveur, retour arrière ciblé.
- `NotesDrawer.test.tsx` (+16) : onglet initial / retenu / inconnu, filtrage
  par onglet, ordre et style des cochés, case et libellé, échec, ajout avec
  focus gardé, projets (liste, ajout, édition, suppression), axe Courses.
- `FinancialIndicators.notes.test.tsx` : compteur lu dans `pendingCount`.

## 6. Déploiement — ordre impératif

Le code lit `kind` / `checked_at` : **migration avant le code**, sinon
`GET /api/notes` répond 500 (la demi-ligne Notes s'affiche sans compteur, le
drawer montre « Impossible de charger les notes » ; le reste du dashboard n'est
pas touché).

1. Dev : `apply-sql.mjs` + `INSERT` dans `schema_migrations` (tracker tenu
   depuis 2026-10, multi-env §6), avant de merger dans `dev`.
2. Prod : push gate standard avant `main`, puis `pnpm db:types` (le bloc écrit
   à la main doit ressortir identique), baseline re-exportée, `db:check-drift`,
   `db:check-types-fresh`, `db:check-rls`.

Un client resté sur l'ancien JavaScript (PWA en cache) affiche les 3 onglets
mélangés comme des notes jusqu'au rechargement ; ses ajouts restent des notes.

### 6.1 Effectué le 2026-10-03 (base de test, prod, `dev` et `main`)

- **Base de test** (`ddehmjucyfgyppfkbddr`) : état vérifié avant (table sans
  `kind`/`checked_at`, 2 notes, tracker à jour jusqu'à `20261002010000`), puis
  migration + `INSERT` dans `supabase_migrations.schema_migrations` en **une
  seule** requête `apply-sql.mjs` (`SUPABASE_PROJECT_REF` explicite : le script
  vise la prod par défaut). Vérifié : 2 colonnes, 2 CHECK, les 2 notes passées
  en `note`, RLS active sans policy, ligne de tracker présente.
- `supabase gen types` contre la base de test : bloc `notes` **identique** au
  bloc écrit à la main.
- `dev` avancé en fast-forward sur la branche de la fonctionnalité (aucun
  commit de fusion), sur demande de l'utilisateur.
- **Prod** (`jzmppreybwabaeycvasz`), sur feu vert explicite de l'utilisateur :
  `db:check-drift` à 0 et même état que la base de test avant migration
  (contrôle rejoué juste avant l'écriture), puis la même requête unique
  (migration et ligne de tracker). Vérifié : mêmes colonnes et CHECK, 2 notes
  en `note`, RLS, tracker. Pas de `SUPABASE_DB_PASSWORD` dans le conteneur,
  d'où `apply-sql.mjs` plutôt que `db push` (précédent Part 43 §6.1).
- `pnpm db:types` depuis la prod : **aucun diff** sur `lib/database.types.ts`.
  Baseline re-exportée (2 colonnes + 2 CHECK `notes`). `pnpm verify` vert :
  1255 tests, drift, RLS, 31 RPC, fonctions, types frais, objets, snapshots.
- `main` puis `dev` avancés en fast-forward sur le même commit (`dev = main`).
