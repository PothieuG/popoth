# Feature : Monthly Recap

## 1. Vue d'ensemble

Le **Monthly Recap** est un processus mensuel obligatoire qui se déclenche à la première connexion de chaque mois. Il permet à l'utilisateur de faire le bilan du mois écoulé et de gérer ses surplus ou son déficit budgétaire avant de pouvoir réutiliser l'application.

---

## 2. Règles générales

### 2.1. Déclenchement
- Le Monthly Recap se lance **à la première connexion d'un nouveau mois**.
  - *Exemple : si je me connecte pour la première fois le 3 avril (sans m'être connecté le 1er ou le 2), le recap se lance ce jour-là.*
- Il se lance **une seule fois par mois**.
- Si un utilisateur ne s'est pas connecté pendant un mois entier, **le mois manqué est ignoré** : on lance directement le recap du mois en cours.

### 2.2. Périmètre
- Il existe **un Monthly Recap par dashboard** :
  - Un pour le dashboard **personnel**
  - Un pour le dashboard **groupe**

### 2.3. Blocage de l'application
- Tant que le Monthly Recap n'est pas **entièrement terminé**, l'utilisateur **ne peut pas accéder au dashboard**.
- **Cas du dashboard groupe** : si un membre du groupe lance le recap, tous les autres membres sont bloqués. Ils voient un écran explicatif indiquant qu'un membre est en train d'effectuer le recap, avec un bouton **"Se déconnecter"** comme seule action possible.

### 2.4. Persistance et navigation
- **Chaque action est sauvegardée immédiatement en base de données** (sauf les étapes différées listées en section 7).
- En cas de déconnexion/reconnexion ou de crash, l'utilisateur **reprend exactement à l'écran et à l'état où il s'était arrêté**.
- Un système de tracking permet de savoir à tout moment où en est l'utilisateur dans le processus.

### 2.5. Navigation interdite
- **Impossible de revenir à une étape précédente** pendant le processus.
- Une fois le recap terminé, **impossible d'y revenir**.
- Le bouton "retour" du navigateur/téléphone **ne doit jamais** ramener l'utilisateur sur un écran du recap depuis le dashboard.

### 2.6. UI/UX
- Le recap se déroule **en plein écran**.
- La navigation reprend la **vibe du wizard utilisé dans les modals d'ajout de dépenses/revenus**.
- Une **frise de progression** en haut indique l'étape actuelle.
- ⚠️ Malgré la vibe wizard, le bouton "retour" est **désactivé** (cf. 2.5).

---

## 3. Définitions des valeurs clés

| Terme | Définition |
|---|---|
| **Solde actuel** | Solde du compte au moment du recap. |
| **Reste à vivre estimé** | `somme(revenus estimés) - somme(budgets estimés)`, hors économies. Issu du planificateur. Peut être négatif. |
| **Reste à vivre effectif** | Même calcul que sur le dashboard, hors économies, avec toutes les dépenses, revenus et revenus estimés complétés. |
| **Surplus d'un budget** | `budget total - dépensé`, **uniquement si positif**. *Exemple : 205€ dépensés sur 400€ → surplus = 195€.* Si négatif, le surplus est nul (pas négatif). |
| **Surplus total** | Somme des surplus de tous les budgets. |
| **Bilan du mois** | `reste à vivre effectif + reste à vivre estimé`. L'idée : le reste à vivre effectif doit **compenser** le reste à vivre estimé pour que le mois soit équilibré. Si `Bilan ≥ 0` → mois dans le vert. Si `Bilan < 0` → mois dans le rouge. |
| **Dépense/Revenu validé** | Une dépense ou un revenu est dit "validé" lorsqu'il a été mis en surbrillance via un **appui long** sur la carte. |

---

## 4. Étapes du Monthly Recap

### Écran 1 — Bienvenue
Écran introductif court : qu'est-ce que le Monthly Recap, à quoi il sert.
→ Bouton **"Commencer"**.

---

### Écran 2 — Récapitulatif général

Affichage des valeurs suivantes :
- **Solde actuel**
- **Reste à vivre estimé**
- **Reste à vivre effectif**
- **Surplus total des budgets**
  - Bouton "Voir le détail" → ouvre un **drawer indicatif** listant le surplus par budget. Aucune action possible.
- **Total des économies actuelles**
  - Bouton "Voir le détail" → ouvre un **drawer indicatif** affichant le total de la tirelire et la liste des économies par budget. Aucune action possible.

**Bloc Bilan** (visuellement séparé, en bas) :
- Calcul : `reste à vivre effectif + reste à vivre estimé`
- Indicateur visuel **vert/rouge** :
  - **Vert** si le bilan est `≥ 0` (le mois est équilibré ou positif)
  - **Rouge** si le bilan est `< 0` (le mois est déficitaire)
- Affichage du **montant du bilan**.
- **Si vert (bilan ≥ 0)** : message du type *"Vous allez pouvoir ajouter {montant du bilan} à votre total d'économies."*
- **Si rouge (bilan < 0)** : message du type *"L'objectif est de revenir à l'équilibre (bilan = 0)."*

→ Bouton **"Étape suivante"**.

---

### Écran 3 — Gestion du bilan

Le contenu de cet écran **dépend du signe du bilan**.

#### 4.A — Cas BILAN ≥ 0 : transformation des surplus en économies

**Partie indicative (haut de l'écran)** :
- Récapitulatif de la transformation des surplus en économies.
- *Exemple 1 : budget avec +150€ de surplus et 0€ d'économies → 150€ d'économies au mois prochain.*
- *Exemple 2 : budget avec +150€ de surplus et 50€ d'économies existantes → 200€ d'économies au mois prochain.*

**Partie interactive (bas de l'écran)** :
Question : **"Voulez-vous ajouter un ou plusieurs surplus à la tirelire ?"**

- **Si "Non"** :
  - Apparition du bouton **"Transformer tous les surplus en économies"** → exécute l'action et passe à l'**Écran 4 — Mise à jour du salaire**.

- **Si "Oui"** :
  - Ouverture d'un **drawer** listant chaque budget avec son surplus + **checkbox** par ligne.
  - Bouton en bas du drawer : **"Transférer les surplus sélectionnés vers la tirelire"**.
  - Au clic : loader sur le bouton → action en base → fermeture du drawer → retour à l'écran.
  - **Refetch** des surplus restants (ceux non transférés vers la tirelire).
    - **S'il reste des surplus** : afficher le bouton **"Transformer les surplus restants en économies"** → exécute l'action et passe à l'**Écran 4**.
    - **S'il ne reste aucun surplus** : afficher le message *"Plus de surplus disponible"* à la place de la liste, et un bouton **"Continuer"** → passe à l'**Écran 4**.

---

#### 4.B — Cas BILAN < 0 : renflouement du déficit

**En haut de l'écran** : montant à renflouer (valeur absolue du bilan négatif). **Se met à jour en temps réel** selon les actions. Objectif : atteindre **0€**.

Trois lignes de renflouement, dans l'ordre :

##### Ligne 1 — Tirelire
- **S'il y a de l'argent dans la tirelire** :
  - Affichage du montant disponible et de combien peut être utilisé pour renflouer.
  - Bouton **"Renflouer X€"**.
  - Au clic : mise à jour du montant à renflouer en haut.
    - **Si la tirelire suffit à combler le déficit** :
      - Message : *"Le déficit est comblé. Il reste X€ dans la tirelire."*
      - Bouton **"Continuer"** → l'utilisateur bascule sur le **flow du bilan positif (4.A)** avec le surplus restant.
    - **Si la tirelire ne suffit pas** :
      - Tirelire vidée, montant à renflouer mis à jour, passage à la ligne 2.
- **Si la tirelire est vide** : ligne simplement **indicative** (*"Pas d'argent dans la tirelire"*).

##### Ligne 2 — Économies des budgets
- Affichage du **total des économies** de tous les budgets.
- En dessous, plus petit : **liste des budgets concernés** avec leurs économies respectives.
- Bouton **"Transférer mes économies dans le déficit"**.
- Comportement au clic :
  - L'algorithme **puise proportionnellement** dans les économies de tous les budgets jusqu'à combler le déficit.
  - **Si les économies suffisent** : mise à jour du total et de chaque ligne par budget. Bilan revenu à 0 → bascule sur le **flow positif (4.A)** s'il reste un surplus, sinon passage direct à l'**Écran 4**.
  - **Si les économies ne suffisent pas** : toutes les économies sont vidées, le déficit est partiellement comblé, mise à jour de l'affichage, passage à la ligne 3.
- **Si aucune économie n'existe** : ligne simplement **indicative** (*"Pas d'économies disponibles"*).

##### Ligne 3 — Puiser dans les budgets existants
- Bouton **"Puiser proportionnellement dans tous les budgets pour renflouer"**.
- En dessous : liste des budgets estimés avec leur état actuel au format `consommé/budgété` (ex: *"Courses → 33/400"* signifie 33€ consommés sur les 400€ budgétés — même format que dans le planificateur de budget).
- Comportement au clic :
  - Le système calcule un **snapshot** : combien retirer proportionnellement à chaque budget pour combler le déficit.
  - ⚠️ **Important** : ce snapshot **n'impacte PAS la DB immédiatement**. Les budgets ne sont mis à jour qu'**à la fin du Monthly Recap**.
  - *Exemple : déficit de 30€ + 3 budgets (Machin 100€ budgétés, Truc 50€ budgétés, Bidule 25€ budgétés) → on retire 10€ à chacun. Après le recap, les budgets s'afficheront ainsi dans le planificateur : Machin 10/100, Truc 10/50, Bidule 10/25 (10€ consommés sur le budget total respectif).*
- Une fois le déficit comblé (= 0€), le bouton **"Continuer"** apparaît → passage à l'**Écran 4**.

---

### Écran 4 — Mise à jour du salaire

Cet écran propose de mettre à jour le(s) salaire(s) avant de finaliser le recap.

**Comportement selon le type de dashboard** :
- **Recap personnel** : on parle **du salaire de l'utilisateur**.
- **Recap de groupe** : on peut mettre à jour **le salaire de n'importe quel membre du groupe** (incluant l'utilisateur en cours). N'importe quel membre est autorisé à modifier le salaire de n'importe quel autre membre.

**Question affichée** : *"Voulez-vous mettre à jour {le salaire / un des salaires des membres du groupe} ?"*

Deux boutons : **Oui** / **Non**.

- **Si "Non"** → passage direct à l'**Écran 5 — Récapitulatif final**.

- **Si "Oui"** :
  - **Cas recap personnel** : un **input** apparaît, pré-rempli avec le salaire actuel de l'utilisateur. L'utilisateur peut modifier la valeur.
  - **Cas recap groupe** : la liste des **membres du groupe** apparaît, chacun avec son salaire actuel en input éditable.
  - Un bouton **"Mettre à jour"** est disponible.
  - Au clic sur "Mettre à jour" :
    - Enregistrement immédiat du/des nouveaux salaires en base.
    - **Cas recap groupe** : si un ou plusieurs salaires ont été modifiés, **les contributions de chaque utilisateur au groupe sont automatiquement recalculées et mises à jour** en conséquence.
    - Passage à l'**Écran 5 — Récapitulatif final**.

---

### Écran 5 — Récapitulatif final

- Résumé bref des actions effectuées pendant le recap, adapté au parcours emprunté (positif ou négatif), incluant la mise à jour éventuelle du/des salaire(s).
- Bouton **"Retourner au dashboard"**.
- Au clic sur ce bouton, les actions suivantes sont exécutées dans cet ordre :
  1. **Application du snapshot** de puisage dans les budgets (si l'étape 4.B - Ligne 3 a été utilisée).
  2. **Traitement des dépenses et revenus du mois écoulé** :
     - Les dépenses/revenus **validés** (mis en surbrillance via appui long) sont **supprimés** définitivement.
     - Les dépenses/revenus **non validés** sont **conservés et reportés sur le dashboard du mois prochain**, avec les règles spéciales décrites en **section 5**.
  3. **Ajout des valeurs read-only sur les dashboards** (cf. section 6).
  4. **Fin du recap** et redirection vers le dashboard.

---

## 5. Gestion des dépenses/revenus reportés au mois suivant

Les dépenses et revenus **non validés** lors du mois écoulé sont reportés sur le dashboard du mois suivant avec les règles strictes suivantes :

### 5.1. Comportement visuel
- Ils sont **affichés** dans la liste des dépenses/revenus du nouveau mois.
- Un **petit flag/badge** sur la carte indique clairement qu'ils proviennent du mois précédent.

### 5.2. Comportement fonctionnel
- ⚠️ **Ils NE DOIVENT PAS être pris en compte** dans :
  - Le calcul du **reste à vivre**.
  - Le calcul du **solde**.
  - Tout autre calcul de budget, surplus, économies, etc.
- **Ils sont purement visuels.**

### 5.3. Actions possibles sur ces cartes reportées
Les seules actions autorisées sont :
- **Valider** la dépense/revenu via appui long → la carte devient une dépense/revenu **normal du mois en cours**, **le solde se met à jour**, le flag "mois précédent" disparaît.
- **Dévalider** la dépense/revenu via appui long → retour à l'état "reporté, non compté".

---

## 6. Valeurs read-only ajoutées aux dashboards après le recap

À la fin du recap, les valeurs suivantes sont ajoutées **en read-only** (immuables, aucune action possible dessus) :

### 6.1. Sur le dashboard personnel de l'utilisateur
- La **valeur du salaire** de l'utilisateur est ajoutée dans la section **revenus estimés**.

### 6.2. Sur le dashboard du groupe (si l'utilisateur fait partie d'un groupe)
- La **valeur de la contribution de l'utilisateur** au groupe (la même que celle affichée dans le header du groupe) est ajoutée dans la section **revenus estimés** du groupe.

### 6.3. Règles communes
- Ces deux valeurs sont **immuables** : aucune édition, suppression ou interaction possible.
- Elles sont uniquement informatives et alimentent les calculs de revenus estimés du nouveau mois.
- Ces valeurs sont **ajoutées chaque mois** lors du recap et **remplacent** celles du mois précédent (pas d'accumulation).

---

## 7. Persistance en base de données

| Action | Impact DB |
|---|---|
| Transfert surplus → tirelire | **Immédiat** |
| Transformation surplus → économies | **Immédiat** |
| Renflouement via tirelire | **Immédiat** |
| Renflouement via économies | **Immédiat** |
| Mise à jour du/des salaire(s) (Écran 4) | **Immédiat** |
| Mise à jour des contributions du groupe (suite à un changement de salaire) | **Immédiat** |
| Progression dans les étapes | **Immédiat** (pour la reprise après déco) |
| Snapshot de puisage dans les budgets (Ligne 3) | **Différé** — appliqué à la fin du recap |
| Suppression des dépenses/revenus validés | **Différé** — appliqué à la fin du recap |
| Report des dépenses/revenus non validés (avec flag) | **Différé** — appliqué à la fin du recap |
| Remplacement des valeurs read-only (salaire / contribution) | **Différé** — appliqué à la fin du recap |

---

## 8. Travail à effectuer avant l'implémentation

1. **Nettoyer la base existante** : repartir du code de la V2 du Monthly Recap, supprimer ce qui n'est plus pertinent pour avoir une base lean.
2. **Mettre à jour les cas de tests** : au moins **20 cas variés** couvrant les différents parcours (bilan positif, bilan négatif avec/sans tirelire, avec/sans économies, mise à jour de salaire ou non, modification d'un salaire impactant les contributions du groupe, dépenses validées/non validées, reprise après déconnexion, blocage groupe, etc.).
3. **Faciliter le test du processus** : vérifier qu'il est simple de déclencher le recap manuellement et de simuler les différents états pour le tester.

---
