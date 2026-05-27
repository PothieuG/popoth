# Roadmap Detailed — Part 33 : PWA-Standalone-Polish

Sprint isolé (post-Group-RAV-Recap) — polish PWA pour atteindre une expérience "vraie app native immersive" sur iPhone + Android : plein écran sous le notch, splash screen au lancement, icône d'écran d'accueil peaufinée. La PWA technique était déjà câblée (manifest `display: standalone`, service worker, banner d'install Android) — il manquait 4 morceaux de finition.

---

- ✅ **Sprint PWA-Standalone-Polish** (livré 2026-05-27 sur `dev`).

  ### Contexte

  Le user installait déjà Popoth sur son écran d'accueil mais le résultat ne se sentait pas comme une vraie app : barre/bande visible en haut, contenu pas sous l'encoche iPhone, écran de chargement blanc, icônes génériques. 3 axes prioritaires confirmés : **plein écran sous le notch** (iOS + Android), **écran de chargement avec logo** (splash screen iOS — Android est auto), **icône d'app peaufinée**.

  ### Architecture

  **3 leviers techniques combinés** pour transformer l'expérience iOS :
  1. `viewport-fit: cover` ([app/layout.tsx](../../app/layout.tsx) viewport) — autorise le contenu à utiliser toute la surface du device, y compris sous le notch / Dynamic Island
  2. `statusBarStyle: 'black-translucent'` ([app/layout.tsx](../../app/layout.tsx) appleWebApp) — rend la barre système iOS transparente et auto-adapte la couleur du texte selon le luminance du fond. L'app `bg-white` du header passe propre sous l'heure/batterie.
  3. CSS `env(safe-area-inset-*)` ([app/globals.css](../../app/globals.css)) — exposé comme 4 utilities Tailwind 4 `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe` via le directive `@utility`. Appliqué sur les surfaces qui touchent les bords du device : DashboardHeader, BottomNav, dashboard wrapper (lateral pour landscape), 4 pages auth + 2 confirm/error, RecapShell wizard.

  **Splash screen iOS** : Safari ne lit pas le manifest pour le splash — il faut fournir des images statiques via `<link rel="apple-touch-startup-image" media="...">`. 10 tailles iPhone (SE 2 → 15 Pro Max) générées en batch via [scripts/generate-pwa-assets.mjs](../../scripts/generate-pwa-assets.mjs) (sharp 0.34.5 en devDep) → wirage `appleWebApp.startupImage[]` avec 10 media queries précises. Android Chrome n'a rien besoin (génération auto depuis `theme_color` + `background_color` + icon 512).

  **Icône peaufinée** : `app/apple-icon.png` (180×180) auto-détecté par Next.js (file convention) → injection `<link rel="apple-touch-icon">`. Icônes manifest régénérées (192, 512 standard + 512 maskable avec safe zone 60% pour les launchers Android Pixel/Samsung qui croppent).

  **Polish manifest** : ajout `id: '/'`, `scope: '/'`, `display_override: ['standalone']`, `categories: ['finance', 'productivity']` pour aider la détection PWA par certains navigateurs (Edge, Samsung Internet) et préparer un éventuel listing Microsoft Store.

  ### Décisions de design
  - **`black-translucent` plutôt que `default`** : avec `default`, iOS réserve une bande blanche en haut pour la status bar — c'est ce que le user percevait comme "barre d'URL". Avec `black-translucent`, la barre est transparente et l'app peut respirer pleine hauteur. Trade-off : exige du `pt-safe` partout pour ne pas planquer le contenu sous l'heure ; bénéfice : sensation app native immersive. **Reverse possible** en 1 ligne si rendu déplaît.

  - **Tailwind 4 `@utility` plutôt que `@layer utilities`** : la directive `@utility name { ... }` (Tailwind 4 CSS-first natif) crée des classes disponibles avec les variants (hover:pt-safe, etc.), équivalent fonctionnel mais plus idiomatique que l'ancienne syntaxe `@layer utilities`.

  - **Génération assets via sharp + script Node, pas un service tiers** : 1 source `design/logo-source.png` + 1 commande `pnpm pwa:assets` produit 14 PNG (1 apple-icon + 3 icons manifest + 10 splash) en ~3s, idempotent. Réplicable à chaque changement de logo sans dépendance externe. Sharp était la seule devDep ajoutée (~30MB mais largement utilisé Next.js, déjà recommandé pour Image optimization prod).

  - **Logo source dans `design/`, processed PNG sur fond bleu nuit** : le script consomme `design/logo-source.png` (transparent idéalement, mais fonctionne sur n'importe quel format puisque sharp `fit: contain` + composite sur fond `#0f172a`). Le user a fourni un JPEG (700×900) avec watermark "Dreamstime.com" → process inline (threshold pixel R+G+B ≥ 240 → alpha 0, 83.2% des pixels rendus transparents) puis bascule au générateur. Décision user : usage perso, watermark acceptable. Pour usage public, achat de licence Dreamstime ou remplacement par un asset propriétaire.

  - **`logoRatio: 0.3` pour splash, `0.7` pour icon, `0.6` pour maskable** : ratios calibrés pour (a) splash sobre style "app sérieuse" (logo discret au centre, ~30% de la largeur), (b) icon généreuse (~70% pour bien remplir le carré arrondi iOS), (c) maskable avec safe zone (60% pour absorber le crop circulaire/squircle des launchers Android).

  - **Maskable icon dans un fichier séparé** : `icon-maskable-512x512.png` (vs `icon-512x512.png` historique qui servait à la fois `purpose: 'any'` et `purpose: 'maskable'`). Sépare clairement les deux usages, permet de tuner le safe zone du maskable sans affecter l'icône standard.

  - **`pt-safe pb-safe` sur les pages auth centrées** : les pages connexion/inscription/forgot/reset/confirm/auth-code-error utilisent toutes `<div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">`. Ajouter `pt-safe pb-safe` au wrapper assure que la carte centrée ne dépasse pas sous le notch ni sur le home indicator même si min-h-screen grandit naturellement avec le contenu.

  - **`pl-safe pr-safe` sur le wrapper dashboard** : utile uniquement pour le mode paysage / Dynamic Island latéral (rare en mobile-first portrait), mais coût zéro (env() = 0 quand pas d'inset). Préventif.

  ### Modules livrés

  **Configuration PWA** :
  - [app/layout.tsx](../../app/layout.tsx) — `viewportFit: 'cover'`, `statusBarStyle: 'black-translucent'`, `appleWebApp.startupImage[]` avec 10 entrées media-query (iPhone SE 2/3 → iPhone 14/15 Pro Max).
  - [app/manifest.ts](../../app/manifest.ts) — ajout `id`, `scope`, `display_override`, `categories`. Maskable icon basculé vers `/icons/icon-maskable-512x512.png`.

  **CSS safe-area** :
  - [app/globals.css](../../app/globals.css) — 4 nouvelles `@utility` : `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`. Comment expliquant que sur Android / non-notched, les env() résolvent à 0.

  **Application UI** :
  - [components/dashboard/DashboardHeader.tsx](../../components/dashboard/DashboardHeader.tsx) — `pt-safe` sur le `<nav>` sticky top.
  - [components/dashboard/BottomNav.tsx](../../components/dashboard/BottomNav.tsx) — `pb-safe` sur le `<footer>`.
  - [app/(dashboards)/layout.tsx](<../../app/(dashboards)/layout.tsx>) — `pl-safe pr-safe` sur le wrapper `fixed inset-0`.
  - [app/connexion/page.tsx](../../app/connexion/page.tsx), [app/inscription/page.tsx](../../app/inscription/page.tsx), [app/forgot-password/page.tsx](../../app/forgot-password/page.tsx), [app/reset-password/page.tsx](../../app/reset-password/page.tsx), [app/auth/confirm/page.tsx](../../app/auth/confirm/page.tsx), [app/auth/auth-code-error/page.tsx](../../app/auth/auth-code-error/page.tsx) — `pt-safe pb-safe` sur le wrapper `flex min-h-screen` (pattern miroir cross-file).
  - [components/monthly-recap/RecapShell.tsx](../../components/monthly-recap/RecapShell.tsx) — `pt-safe pb-safe pl-safe pr-safe` sur le `<div fixed inset-0>` du wizard.

  **Assets generator** :
  - [scripts/generate-pwa-assets.mjs](../../scripts/generate-pwa-assets.mjs) — NEW. Lit `design/logo-source.png` + compose sur fond `#0f172a`. Produit `app/apple-icon.png` (180×180, logoRatio 0.7), `public/icons/icon-{192x192,512x512}.png` (logoRatio 0.7), `public/icons/icon-maskable-512x512.png` (logoRatio 0.6 safe zone), `public/splash/splash-WxH.png` (10 iPhone sizes, logoRatio 0.3). Idempotent (relance écrase). Erreur explicite si source manquante.
  - [package.json](../../package.json) — `sharp@^0.34.2` (résolu 0.34.5) en devDep, script `"pwa:assets": "node scripts/generate-pwa-assets.mjs"`.

  **Assets générés** (14 fichiers binaires) :
  - `app/apple-icon.png` (180×180) — icône iOS home screen.
  - `public/icons/icon-192x192.png`, `icon-512x512.png` (purpose `any` dans manifest).
  - `public/icons/icon-maskable-512x512.png` (purpose `maskable`, safe zone 60%).
  - `public/splash/splash-{750x1334,828x1792,1080x2340,1125x2436,1170x2532,1179x2556,1242x2208,1242x2688,1284x2778,1290x2796}.png` — 10 splash screens iPhone.

  ### Test plan manuel (device réel)

  **iPhone Safari** :
  1. Push `dev` → Vercel-dev déploie.
  2. Ouvre l'URL `popoth-dev.vercel.app` sur Safari (PAS Chrome iOS).
  3. Partager (carré + flèche) → "Sur l'écran d'accueil" → confirme.
  4. Lance depuis l'écran d'accueil.
  5. **Attendu** : aucune barre Safari, status bar transparente (heure flotte sur le bleu du header `bg-white` avec texte sombre auto), splash écran navy `#0f172a` avec logo heart-hand pendant le boot (~1-2s), pas d'écran blanc.
  6. Test header dashboard : pas chevauchement avec l'heure.
  7. Test BottomNav : pas chevauchement avec le home indicator.

  **Android Chrome** :
  1. Ouvre l'URL prod sur Chrome.
  2. Banner "Installer Popoth App" en bas → "Installer".
  3. Lance depuis l'écran d'accueil.
  4. **Attendu** : pas d'URL bar, icône bien arrondie avec logo heart-hand, splash auto avec fond `#0f172a` (généré par Chrome depuis manifest), navigation entre dashboard/group-dashboard fluide.

  **DevTools local** : `pnpm dev` → Chrome DevTools → Application → Manifest (vérifier les 3 icons + display: standalone + start_url + id + categories) + Service Workers (sw.js activé). Lighthouse PWA audit en mobile preset, cible score ≥ 90.

  ### Verification
  - `pnpm typecheck` : OK
  - `pnpm lint:check` : 0 errors / 0 warnings
  - `pnpm format:check` : OK
  - `pnpm test:run` : 775 passed / 227 skipped (gated DB)
  - `pnpm build` : 55/55 pages compilées (route `/apple-icon.png` auto-détectée par Next.js file conventions, vs 54 pages pré-sprint)
  - 0 nouvelle migration DB
  - 0 nouvelle RPC
  - Bundle JS impact : marginal (juste 4 utilities CSS supplémentaires, déjà optimisées par Tailwind).
