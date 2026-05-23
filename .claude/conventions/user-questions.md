# Convention — questions à l'utilisateur en langage métier

> Règle installée 2026-05-23 (sprint 09 Monthly Recap V3 planning). Voir §11 plus bas pour le précédent.

## La règle

Toute question posée à l'utilisateur via `AskUserQuestion` (ou en texte libre dans la conversation) **doit utiliser un vocabulaire métier / produit, pas du jargon technique**. La question doit aussi inclure le **contexte business** qui explique l'enjeu : pourquoi la question existe, et ce qui change concrètement entre les options du point de vue utilisateur (pas du point de vue implémentation).

Cela s'applique **par défaut** à toute interaction avec l'utilisateur sur le projet Popoth, sauf si l'utilisateur lui-même utilise du jargon technique dans sa demande (auquel cas répondre dans son registre).

## Le pourquoi

Le user a explicitement demandé cette règle le 2026-05-23 pendant le planning du sprint 09. Il a vu 3 questions remplies de jargon (« FK ON DELETE CASCADE », « cookies httpOnly TTL 5 min », « JSONB blob produit par save_budget_snapshot »), a demandé la reformulation, puis a confirmé que cette reformulation doit devenir le **default permanent** pour le projet — pas une exception à demander à chaque fois.

Raison structurelle : le user est le **product owner** de Popoth, pas un dev qui veut auditer l'implémentation. Lui demander de choisir entre des options techniques est inefficace — il prend la décision sur le **comportement produit** attendu, pas sur la stratégie de cleanup d'une FK. Lui présenter du jargon le force soit à apprendre une notion qui ne lui apporte rien, soit à choisir au hasard, soit à demander une reformulation (perte de temps).

## Comment appliquer

### 1. Reformuler le jargon en termes utilisateur

Avant d'envoyer un `AskUserQuestion`, relire chaque `question`, `label`, et `description`. Identifier les mots qui sont du jargon dev et les remplacer.

| Jargon technique                    | Reformulation utilisateur                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `FK ON DELETE CASCADE`              | « quand on supprime A, B est supprimé automatiquement »                      |
| `cookies httpOnly TTL 5 min`        | « petit marqueur invisible dans le navigateur (valable 5 min) »              |
| `INSERT direct dans monthly_recaps` | « on prépare l'état du recap directement en base »                           |
| `RPC start_monthly_recap`           | « l'endpoint qui démarre le recap » (ou simplement « démarrer le recap »)    |
| `JSONB blob`                        | « un fichier de données structuré » (ou élider si le user n'en a pas besoin) |
| `wrapper withAuthAndProfile`        | « la fonction qui vérifie que l'user est connecté » (ou élider)              |
| `Zod schema`                        | « validation des données envoyées » (ou élider)                              |
| `proxy gating`                      | « le système qui vérifie si tu as droit d'accéder à la page »                |
| `service_role key`                  | « la clé admin qui contourne les restrictions » (si rare ; sinon élider)     |

### 2. Ajouter le contexte business

Chaque question doit pouvoir se lire seule sans connaître l'implémentation. Inclure :

- **Ce qui est en jeu** côté produit / UX (par exemple : « pour pouvoir tester l'écran de mise à jour des salaires avec plusieurs personnes »)
- **La conséquence concrète** de chaque option (« tu auras 22 scénarios au lieu de 27 », « ça ajoute 5 minutes d'attente à chaque test », « tu pourras le tester en 1 clic »)
- **L'effet de bord** s'il existe (« petit effet de bord : restes de faux comptes en base jusqu'au prochain reset »)

### 3. Format

- `header` : très court, vocabulaire utilisateur (max 12 char). Exemples : « Multi-membres », « Marqueur 5min », « Reprise wizard »
- `label` : concis (1-5 mots), action ou choix utilisateur. Exemples : « Création auto », « Nettoyer auto », « 2 sur 5 livrés »
- `description` : 1-2 phrases axées sur l'impact concret pour le user, pas sur la stratégie technique. Mentionner le compromis ou l'effet de bord. Marquer une option « (Recommended) » si je conseille spécifiquement, sinon ne pas hiérarchiser.

## Exemples avant / après

### Exemple 1 — Gestion des co-équipiers en base de test

**❌ Avant (technique)** :

> Q: « Comment gérer les scénarios groupe multi-membres (group-deficit-3-members, group-mixed-salaries, edge-locked-by-other) — profiles.id a une FK ON DELETE CASCADE vers auth.users, donc seeder des membres fake demande supabaseAdmin.auth.admin.createUser() + cleanup deleteUser ? »
>
> Options :
>
> - (a) Skip multi-member, do single-member-group scenarios only
> - (b) Implement full multi-member via admin.auth.admin.createUser + deleteUser cleanup
> - (c) Best-effort: declare multi-member scenarios but throw 'not yet implemented' on seed

**✅ Après (métier)** :

> Q: « Le sprint prévoit plusieurs scénarios où ton groupe a 2-3 membres (pour tester l'écran 'mise à jour des salaires' avec plusieurs personnes, ou l'écran 'recap verrouillé par un autre membre'). Pour les générer en 1 clic, il faut créer des faux co-équipiers en arrière-plan. Comment veux-tu gérer ça ? »
>
> Options :
>
> - **Création auto (Recommended)** : le scénario crée automatiquement 1 ou 2 faux comptes co-équipiers dans ton groupe. Tu auras les 27 scénarios complets. Léger effet de bord : ces faux comptes restent en base entre 2 resets (nettoyés au prochain reset).
> - **Solo seulement** : on ne garde que les scénarios où tu es seul dans ton groupe. ~22 scénarios au lieu de 27. Plus simple mais tu rateras la validation visuelle de l'écran salary à 3 inputs.
> - **Juste l'affichage** : les scénarios multi-membres apparaissent dans la liste mais affichent « génération manuelle requise ». Valeur cosmétique seulement.

### Exemple 2 — Cache navigateur après reset

**❌ Avant (technique)** :

> Q: « Le proxy gating utilise des cookies httpOnly 'recap-ok-{ctx}-{Y}-{M}' (TTL 5min) cachés quand status=completed. Après reset (ou seed d'un scénario blocking), comment gérer ces cookies ? »

**✅ Après (métier)** :

> Q: « Quand ton recap mensuel est terminé, l'app pose un petit marqueur invisible dans ton navigateur (valable 5 min) pour ne pas re-vérifier le statut à chaque clic. Problème : si tu fais 'Reset' pour rejouer le recap, l'app croit toujours qu'il est terminé pendant ces 5 min — /dashboard ne te renvoie pas au wizard. Comment veux-tu gérer ? »

### Exemple 3 — Niveau de complétude des seeds

**❌ Avant (technique)** :

> Q: « Pour les 5 scénarios resume-mid-flow (resume-at-summary/manage_bilan-positive/manage_bilan-negative-half/salary-update/final-recap), quel niveau de fidélité dans le seed d'état partiel ? »

**✅ Après (métier)** :

> Q: « Le sprint prévoit 5 scénarios qui te déposent pile au milieu du wizard (sur l'écran résumé, ou bilan positif, ou bilan négatif à moitié résolu, ou salary update, ou écran final). Le but : tester chaque écran isolément sans rejouer tout le wizard. Quel niveau de fidélité ? »
>
> Options :
>
> - **Les 5 parfaits (Recommended)** : chaque scénario te dépose pile au bon écran AVEC les calculs cohérents derrière. Tu peux faire des QA rapides sur n'importe quel écran en 1 clic. Plus de boulot orchestrateur mais c'est l'objet du sprint.
> - **2 sur 5 bien faits** : on en livre 2 (résumé + écran final) avec l'état cohérent, on stub les 3 autres. Plus rapide. Pour tester bilan positif/négatif/salary, tu repartiras du début à chaque fois.
> - **Tous 5 sommaires** : les 5 scénarios sont livrés mais le seeding est minimal. Risque : tu peux voir des incohérences UI. À éviter.

## Quand le jargon reste OK

- Le user a lui-même utilisé le terme technique dans sa demande → matcher son registre.
- La question est explicitement sur l'**implémentation** (« quel pattern TypeScript préfères-tu pour cette discriminated union ? ») et le user a confirmé qu'il veut un avis tech.
- Notes en interne (Plan files, mémoire, commit messages) peuvent rester techniques — la règle s'applique aux **questions posées au user en interactif**.

## Précédent (2026-05-23)

Sprint 09 Monthly Recap V3 planning. Premier `AskUserQuestion` jargon-heavy → user a rejeté avec « Peux-tu reposer tes questions dans un vocabulaire métier plus que technique ? Avec du context. J'aimerais que tu fasses ça pour toutes les questions à venir par claude code. Grave le dans le claude.md pour que je n'ai plus à le dire. »

Persistance :

- Mémoire `feedback_questions_business_language.md` (rappel permanent cross-session)
- Ce fichier (`.claude/conventions/user-questions.md` — détails + exemples)
- Pointeur dans `CLAUDE.md` §6 / §8
