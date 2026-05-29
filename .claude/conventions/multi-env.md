# Multi-environnement — prod + dev (Supabase + Vercel + local)

> Installé 2026-05-27 avec la création de la branche `dev`. Workflow staging avant prod.

## 1. Architecture

| Couche              | Prod                      | Dev                        |
| ------------------- | ------------------------- | -------------------------- |
| **Branche git**     | `main`                    | `dev`                      |
| **Projet Supabase** | `jzmppreybwabaeycvasz`    | `ddehmjucyfgyppfkbddr`     |
| **Projet Vercel**   | Existant (déjà configuré) | **Nouveau projet à créer** |

Les deux branches partent du même historique. Le workflow standard :

1. Créer branche feature depuis `dev`
2. Merger dans `dev` → déploie auto sur Vercel-dev (DB dev)
3. Tester sur l'URL preview Vercel
4. Merger `dev` → `main` → déploie auto sur Vercel-prod (DB prod)

## 2. Switch local entre prod et dev

`.env.local` (un seul fichier) contient les **deux jeux de variables**, avec un seul bloc actif et l'autre commenté. Pour switcher : éditer `.env.local`, commenter/décommenter les blocs, redémarrer `pnpm dev` (Next charge `.env.local` au démarrage uniquement).

Pattern recommandé :

```
# === DEV (actif par défaut) ===
NEXT_PUBLIC_SUPABASE_URL=https://ddehmjucyfgyppfkbddr.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<dev publishable>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev anon>
SUPABASE_SERVICE_ROLE_KEY=<dev service role>

# === PROD (commenté) ===
# NEXT_PUBLIC_SUPABASE_URL=https://jzmppreybwabaeycvasz.supabase.co
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<prod publishable>
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod anon>
# SUPABASE_SERVICE_ROLE_KEY=<prod service role>

# Identiques aux deux environnements :
JWT_SECRET_KEY=<...>
LOG_LEVEL=debug
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Setup initial** : récupérer les clés dev depuis [Project Settings → API du projet dev](https://supabase.com/dashboard/project/ddehmjucyfgyppfkbddr/settings/api) et les ajouter dans `.env.local` (en plus des prod déjà présentes, en commentaire). Par défaut tu travailles sur dev. Quand tu as besoin de pointer vers prod en local (très rare), tu inverses les commentaires.

`.env.local` reste gitignored via le pattern `.env*.local` dans `.gitignore`. **Ne jamais commiter de secret**.

## 3. Setup nouveau projet Vercel pour dev

> À faire une seule fois, côté UI Vercel.

1. **Créer le projet** : [vercel.com/new](https://vercel.com/new) → Import Git Repository → choisir `PothieuG/popoth` (le même repo que le projet prod existant).
2. **Configurer la production branch** : Project Settings → Git → **Production Branch = `dev`** (au lieu du `main` par défaut). Sans ça, Vercel ne déploie que sur push vers main.
3. **Renommer le projet** pour le distinguer du prod, e.g. `popoth-dev`.
4. **Ajouter les variables d'env Production** (Project Settings → Environment Variables, scope = Production) :
   - `NEXT_PUBLIC_SUPABASE_URL` → `https://ddehmjucyfgyppfkbddr.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → clé dev
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → clé dev anon
   - `SUPABASE_SERVICE_ROLE_KEY` → clé dev service role
   - `JWT_SECRET_KEY` → ton secret JWT
   - `NEXT_PUBLIC_SITE_URL` → l'URL Vercel-dev (e.g. `https://popoth-dev.vercel.app`) après le premier deploy
5. **Configurer les Redirect URLs Supabase dev** (dashboard Supabase dev → Authentication → URL Configuration) :
   - Site URL = l'URL Vercel-dev
   - Redirect URLs = `https://popoth-dev.vercel.app/**` + `http://localhost:3000/**`
6. **Déclencher le premier déploiement** : push un commit cosmétique sur `dev` ou utiliser "Deploy" dans l'UI Vercel.

## 4. Workflow quotidien recommandé

1. **Branche feature depuis dev** : `git checkout dev && git pull && git checkout -b feature/<name>`
2. **Code en local avec `.env.local` pointant vers dev** (bloc dev actif, bloc prod commenté)
3. **Push + merge sur dev** → Vercel déploie sur l'URL preview dev
4. **Tester sur Vercel-dev** (réelle URL, DB dev, mêmes conditions que prod sauf data)
5. **Merger dev → main** quand validé → Vercel déploie prod
6. **Re-pull main + dev** pour les synchroniser après release

```powershell
git checkout main
git pull
git checkout dev
git merge main      # dev = main après chaque release
git push origin dev
```

## 5. Scripts DB (sync entre prod/dev)

Les scripts `db:*` (`db:check-drift`, `db:check-rpcs`, etc.) ciblent **prod par défaut** (fallback hardcodé `jzmppreybwabaeycvasz` dans `scripts/check-*.mjs`). Pour pointer vers dev :

```powershell
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
pnpm db:check-drift
pnpm db:check-rpcs
# etc.
$env:SUPABASE_PROJECT_REF = $null   # reset
```

`pnpm db:types` est **hardcodé prod** dans `package.json` (pas d'env var lue). Pour régénérer les types depuis dev :

```powershell
supabase gen types typescript --project-id ddehmjucyfgyppfkbddr --schema public > lib/database.types.ts
```

⚠️ **Attention** : commiter des types générés depuis dev casserait l'invariant `db:check-types-fresh` (qui compare contre prod). Toujours régénérer depuis prod avant commit final. Le pre-push hook ne le détecte pas — `pnpm db:check-types-fresh` à lancer manuellement.

## 6. Aligner le schéma dev sur prod (première fois)

Si la DB dev `ddehmjucyfgyppfkbddr` n'a jamais reçu les migrations récentes :

```powershell
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
pnpm db:check-drift
# Si drift -> appliquer les migrations qui manquent :
pnpm supabase link --project-ref ddehmjucyfgyppfkbddr
pnpm supabase db push --dry-run
# valider -> pnpm supabase db push
pnpm db:check-drift   # exit 0 attendu
$env:SUPABASE_PROJECT_REF = $null
```

Si la DB dev est vide / fresh : copier la baseline prod via `supabase db push --include-all` après link.

> ⚠️ **Réalité dev (constatée 2026-05-29)** : le projet dev `ddehmjucyfgyppfkbddr` n'a **aucun tracker de migrations** — le schéma `supabase_migrations` (et donc la table `schema_migrations`) **n'existe pas**. Son schéma a été bâti entièrement en ad-hoc via `apply-sql.mjs` (Management API), jamais via `supabase db push`. Conséquences :
>
> - `supabase migration list` / `db push` contre dev **ne marchent pas tels quels** : un `db push` créerait le tracker puis tenterait d'appliquer **toutes** les migrations locales — or la plupart existent déjà sur dev → collisions (`relation already exists`, `type already exists`…). Le bloc PowerShell ci-dessus (link + `db push`) est donc **théorique** tant que le tracker dev n'est pas initialisé.
> - Il n'y a donc **rien à enregistrer** dans `schema_migrations` côté dev (aucun risque « db push ré-applique »). Pour migrer dev aujourd'hui : `apply-sql.mjs` (idempotent via `CREATE OR REPLACE` ; un `CREATE TABLE`/`CREATE TYPE` neuf passe une fois).
> - Initialiser un vrai tracker dev = créer `supabase_migrations.schema_migrations` + **backfiller toutes** les versions historiques (~100) pour matcher les fichiers locaux. Tâche séparée, non faite.
>
> Côté **prod** (`jzmppreybwabaeycvasz`), au contraire, `schema_migrations` **existe et fait foi**. Toute migration appliquée hors `db push` (ex. `20260608000000_create_add_exceptional_expense_with_piggy_rpc`, poussée via `apply-sql.mjs` le 2026-05-29) **doit y être enregistrée** — `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (…)` (équivalent de `migration repair --status applied <version>`), sinon un futur `db push` la re-tente (inoffensif si idempotente, mais tracker désynchronisé). Enregistrement faisable via `apply-sql.mjs` (Management API + `SUPABASE_ACCESS_TOKEN`) quand le `SUPABASE_DB_PASSWORD` du shell est ambigu (bloc `.env.local` basculé prod↔dev).

## 7. Règle de sécurité (rappel)

Le fichier `.env.local` (et tout autre `.env*.local`) est **gitignored** et contient des secrets. Claude **ne doit JAMAIS lire ses valeurs** (règle absolue CLAUDE.md §10). Pour le user uniquement — y compris les blocs commentés contenant les clés prod ou dev.

Test de présence binaire autorisé :

```powershell
if (Test-Path .env.local) { 'OK' } else { 'MISSING' }
```
