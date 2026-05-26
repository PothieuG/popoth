# Feature : Projets d'épargne

## Contexte

Je souhaite ajouter une nouvelle feature majeure à l'application : les **Projets**. Un projet permet de définir un objectif d'épargne sur une durée donnée, avec un suivi mensuel de l'avancement.

**Exemple concret :** organiser un voyage au Japon dans 3 ans avec un budget de 7000€ → l'utilisateur doit économiser 7000€ sur 36 mois.

---

## 1. Emplacement et navigation

- Ajouter un **3ème onglet "Projet"** dans le planificateur de budget (à côté des onglets existants).
- Cet onglet affiche la liste de tous les projets en cours.

---

## 2. Liste des projets

Le design s'inspire de la liste des budgets existante. Chaque projet affiche :

- Le **nom** du projet
- Le **pourcentage d'avancement**, représenté visuellement par un cercle de progression
- La **date d'échéance** (deadline)
- Le **nombre de mois restants**
- Le **montant économisé / montant total** (ex : `4084 / 7000€`)

Actions disponibles sur chaque projet :

- **Modifier**
- **Supprimer** (avec modal de confirmation explicative)

---

## 3. Création d'un projet

L'ouverture du formulaire se fait via une modal contenant :

### Champs

- **Nom** du projet
- **Montant total** visé
- **Durée** (ou montant mensuel à investir, voir logique ci-dessous)

### Logique de calcul

La création repose sur la marge disponible = `revenus estimés − budgets déjà alloués`.

Deux modes de saisie possibles, qui se calculent mutuellement :

1. **Saisie du montant total uniquement** → on calcule la **durée minimale possible** en se basant sur la marge maximale disponible.
   - _Exemple : marge dispo = 100€/mois, projet de 2000€ → durée minimale = 20 mois._

2. **Saisie d'un montant mensuel à investir** (≤ marge disponible) → on calcule la **durée correspondante**.

L'utilisateur peut **augmenter la durée** au-delà du minimum, ce qui réduit le montant mensuel à allouer.

### Contraintes

- Impossible de créer un projet qui ferait basculer le **reste à vivre en négatif**.
- Le montant maximum utilisable pour un groupe dépend de la somme du reste à vivre de chacun des membres du groupe

---

## 4. Intégration à la logique budgétaire

Une fois le projet créé, son **montant mensuel** est traité comme un budget classique :

- Il s'ajoute à l'ensemble des budgets dans tous les calculs.
- Il impacte le reste à vivre.
- Il suit les mêmes règles métier que les budgets.

### Suppression d'un projet

- Le montant total déjà économisé est **reversé dans la tirelire**.
- Le reste à vivre est **rééquilibré** automatiquement.

### Modification d'un projet

- Rouvre la même modal **pré-remplie**.
- Permet d'avancer/reculer l'échéance et d'augmenter le budget.
- Les mêmes contraintes s'appliquent (reste à vivre positif, marge disponible).
- ⚠️ Le calcul doit tenir compte de **l'argent déjà économisé**.

---

## 5. Intégration au Monthly Recap

### 5.1 Écran de récap initial

- Afficher une ligne indiquant le **nombre de projets en cours**.
- Un **drawer** affiche la liste des projets avec leur état d'avancement.

### 5.2 Cas BILAN < 0 : renflouement du déficit

Conserver la logique étape-par-étape existante, mais **insérer une nouvelle étape entre le renflouement par les économies et le renflouement par les budgets** :

**Nouvelle étape — Renflouement par les projets :**

- L'utilisateur peut "renoncer" temporairement à l'épargne mensuelle d'un projet pour combler le déficit.
- **Renflouement total :** si projet = 100€/mois et déficit = 200€ → on peut annuler la contribution du mois (100€ utilisés, déficit restant = 100€), puis passer à l'étape suivante.
- **Renflouement partiel :** si projet = 100€/mois et déficit = 50€ → on utilise 50€ du projet, l'utilisateur économise donc seulement 50€ ce mois-ci pour ce projet.
- **Plusieurs projets disponibles :** puiser **proportionnellement** dans tous les projets (même logique que pour les budgets).

### 5.3 Validation du monthly recap

- Toutes les actions de renflouement restent **virtuelles** jusqu'à la validation finale.
- L'écran de récapitulatif final doit **résumer ce qui s'est passé sur les projets**.
- À la validation, le montant ponctionné est réellement extrait des projets concernés.
- La **durée du projet est recalculée** :
  - **Renflouement total** d'une mensualité → décalage de l'échéance d'1 mois.
  - **Renflouement partiel** → recalcul proportionnel (je te laisse force de proposition sur la formule la plus juste, à valider avant implémentation).

---

## Demande

Découpe cette feature en **étapes d'implémentation cohérentes et ordonnées logiquement**. Pour chaque étape, rédige un **prompt Claude Code complet et autonome** que je pourrai exécuter dans l'ordre pour arriver au bout de l'implémentation.

Chaque prompt doit être suffisamment détaillé pour être exécuté indépendamment, tout en s'appuyant sur les étapes précédentes.
