# Next steps — backlog produit

> Items produit en attente, non liés à la dette technique (qui est trackée dans [CLAUDE.md §11](CLAUDE.md)). Ce fichier remplace l'ancien `next steps.txt` (10 lignes plates) — chaque item a maintenant un titre, un domaine et un descriptif.

## P1 — Switch hebdo / quotidien

**Domaine** : dashboard / planning

Ajouter une option de switch par semaine ou par jour sur l'affichage budgets / dépenses.

## P2 — RAV calculé sans économies de budget

**Domaine** : finances / RAV calc

Le RAV (Reste À Vivre) doit être calculé **sans inclure** les économies cumulées des budgets — actuellement le calcul les inclut, ce qui gonfle artificiellement le RAV affiché.

## P3 — Recalcul RAV sur validation revenu

**Domaine** : finances / RAV calc

Quand un revenu est validé, recalculer le RAV avec la nouvelle valeur. Règles :

- Si un budget est négatif, le négatif s'ajoute au calcul du RAV.
- Une dépense hors budget s'ajoute au calcul du RAV.
- Une entrée d'argent hors budget s'ajoute au calcul du RAV.

## P4 — Cascade économies sur dépassement budget

**Domaine** : finances / dépenses

Si un budget dépasse son enveloppe mais qu'il a des économies cumulées, taper dedans **par défaut**. Si le dépassement continue après avoir épuisé les économies du budget, **proposer** à l'utilisateur de prendre dans des économies d'autres budgets.

## P5 — Modal dépense : option économies

**Domaine** : UI / modal dépense

Dans la modal d'ajout d'une dépense, proposer à l'utilisateur de prendre dans les économies s'il le souhaite (pas seulement en cas de dépassement P4).

## P6 — Modal dépense : étape 1 = type

**Domaine** : UI / modal dépense

Dans la même modal (P5), la **première étape** doit être de spécifier si la dépense est budgétée (rattachée à un budget existant) ou exceptionnelle (hors budget).

## P7 — Permissions créateur sur solde groupe

**Domaine** : groups / permissions

Seul le créateur d'un groupe peut changer le solde disponible du groupe dans les options. Les autres membres ne doivent pas voir cette action.

## P8 — Menu groupe : nettoyage UI

**Domaine** : groups / settings

Dans le menu du groupe (settings) :

- Enlever la pastille "créateur".
- Enlever l'option de suppression.
- Enlever la box du bas.

## P9 — Menu "Mon groupe" : retirer "Se déconnecter"

**Domaine** : groups / settings

Enlever l'entrée "Se déconnecter" dans les options "Mon groupe" — la déconnexion n'a rien à faire ici, elle est dans le menu utilisateur global.

## P10 — Fix flicker page d'accueil

**Domaine** : auth / UX

Régler le flicker de la page d'information visible quand on arrive sur le site. Probablement lié au flow `useAuthUser()` initial render avant validation de session ([contexts/AuthContext.tsx](contexts/AuthContext.tsx) `INIT_START` → `INIT_SUCCESS`).
