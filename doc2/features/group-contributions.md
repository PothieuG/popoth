# Contribution au groupe — Documentation métier & technique

> Référence end-to-end de la mécanique de **contribution proportionnelle** au budget d'un groupe Popoth : du choix utilisateur dans le formulaire profil jusqu'à la table `group_contributions` et son intégration dans le reste-à-vivre (RAV) du groupe.
>
> **Audience** : développeur arrivant sur la feature, product ownership, support utilisateur, auditeur sécurité.

---

## 1. Vue d'ensemble métier

Popoth permet à plusieurs utilisateurs (typiquement un couple, une colocation, une famille) de partager un **budget commun** — par exemple un budget courses + loyer + sorties à 1 800 €/mois. Chaque membre du groupe **cotise au prorata de son salaire personnel** vers ce budget commun. La cotisation calculée est **affichée à titre informatif** : Popoth ne déplace pas automatiquement l'argent du compte personnel vers la tirelire du groupe. Charge à chaque membre d'effectuer le virement réel vers le compte commun, puis de l'enregistrer comme dépense exceptionnelle (sortie côté personnel) ou revenu (entrée côté groupe).

**Proposition de valeur** : éviter les disputes "qui paie quoi ?" en partant d'une règle d'équité — celui qui gagne plus contribue plus, en valeur absolue, mais le **pourcentage de salaire mobilisé est le même pour tous**.

### Exemple canonique

| Membre | Salaire mensuel | Part du salaire total | Contribution mensuelle | % de son salaire |
| ------ | --------------- | --------------------- | ---------------------- | ---------------- |
| Alice  | 2 000 €         | 40 %                  | 720 €                  | 36 %             |
| Bob    | 3 000 €         | 60 %                  | 1 080 €                | 36 %             |
| **Σ**  | **5 000 €**     | **100 %**             | **1 800 €**            | **36 %**         |

Budget du groupe : **1 800 € / mois**. Alice contribue 720 €, Bob 1 080 €. Tous deux mobilisent **36 %** de leur salaire — l'effort relatif est strictement égal.

---

## 2. Glossaire

| Terme                   | Définition                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Groupe**              | Table `groups`. Un et un seul groupe par utilisateur (`profiles.group_id` unique nullable). Possède un nom unique, un `monthly_budget_estimate`, un `creator_id`.                                                                                                   |
| **Budget mensuel**      | `groups.monthly_budget_estimate` (numeric(10,2)). **Auto-syncé** depuis `SUM(estimated_budgets.estimated_amount WHERE group_id = X)` par le trigger `estimated_budgets_sync_group_budget` (Sprint Group-Budget-Auto-Sync 2026-05-19). Non saisissable manuellement. |
| **Salaire**             | `profiles.salary` (numeric(10,2), ≥ 0). Donnée privée individuelle, requise pour participer au calcul proportionnel.                                                                                                                                                |
| **Contribution**        | Ligne dans `group_contributions` (`profile_id`, `group_id`, `salary`, `contribution_amount`, `contribution_percentage`, `calculated_at`). 1 ligne par (membre, groupe), unique.                                                                                     |
| **Recalcul**            | Appel à la fonction PL/pgSQL `calculate_group_contributions(group_id_param)` qui UPSERT toutes les lignes du groupe en un seul `FOR member_record IN ...`.                                                                                                          |
| **Split proportionnel** | Mode nominal : `contribution_amount = (salary / Σ salaires positifs) × monthly_budget_estimate`.                                                                                                                                                                    |
| **Split égalitaire**    | Mode fallback : `contribution_amount = monthly_budget_estimate / nb_membres` quand tous les salaires sont à 0.                                                                                                                                                      |
| **Creator**             | Membre qui a créé le groupe (`groups.creator_id`). Peut modifier le nom + budget, supprimer le groupe. **Ne peut pas le quitter** tant que d'autres membres y sont (verrou côté API + UX).                                                                          |
| **RAV** (reste-à-vivre) | Indicateur central du tableau de bord. Pour un groupe, inclut les `contribution_amount` des membres comme un revenu collectif (cf. §5). Pour un profil personnel, **n'inclut PAS** sa contribution comme une charge.                                                |

---

## 3. Règles métier

### 3.1 Cycle de vie d'un groupe

1. **Création** (`POST /api/groups`) : un utilisateur sans `profile.group_id` choisit un nom unique. `monthly_budget_estimate` démarre à 0 et sera auto-syncé dès le 1ᵉʳ `estimated_budget` créé pour le groupe (cf. §6.4 trigger `estimated_budgets_sync_group_budget`). Le serveur INSERT le groupe puis UPDATE `profiles.group_id = group.id`. Le trigger `profiles_contribution_recalc` (cf. §6.4) crée la première ligne `group_contributions` pour le creator.
2. **Rejoindre** (`POST /api/groups/[id]/members`) : un utilisateur sans groupe set son `profile.group_id = groupId`. Le trigger ajoute sa ligne et **recalcule toutes les contributions du groupe** (les parts des autres membres baissent mécaniquement puisque le dénominateur Σ salaires grandit).
3. **Modifier son salaire** (`PUT /api/profile`) : un membre change `profiles.salary`. Le trigger refire et **recalcule l'intégralité du groupe** (sa part change, donc celle des autres aussi).
4. **Modifier le budget total** : indirect via INSERT/UPDATE/DELETE d'items dans `estimated_budgets` (avec `group_id IS NOT NULL`). Le trigger `estimated_budgets_sync_group_budget` (Sprint Group-Budget-Auto-Sync 2026-05-19) UPDATE `groups.monthly_budget_estimate = SUM(estimated_amount)` du groupe, ce qui déclenche en cascade `groups_budget_contribution_recalc` → recalcul de toutes les contributions au prorata. Plus de saisie manuelle ni de route `PUT /api/groups/[id]` pour le budget — seul `name` reste mutable via cette route.
5. **Quitter** (`DELETE /api/groups/[id]/members`) : un membre set son `profile.group_id = NULL`. Le trigger DELETE sa ligne `group_contributions` puis recalcule pour les membres restants.
6. **Supprimer un groupe** (`DELETE /api/groups/[id]`, **creator only**, **0 autre membre**) : deux triggers BEFORE DELETE s'enchaînent dans l'ordre alphabétique :
   - `groups_aaa_cleanup_members` — null `profiles.group_id` pour tous les membres restants
   - `groups_cleanup_contributions` — DELETE FROM `group_contributions` WHERE `group_id = OLD.id`
   - Puis la ligne `groups` est supprimée. FK `ON DELETE CASCADE` fait le ménage des autres dépendants.

### 3.2 Formule de calcul

Exécutée intégralement côté DB par `calculate_group_contributions(group_id_param)` :

```
budget         := SELECT monthly_budget_estimate FROM groups WHERE id = group_id_param
total_salaries := SELECT SUM(salary) FROM profiles WHERE group_id = group_id_param AND salary > 0

IF total_salaries = 0 THEN
    -- Fallback equal-split (aucun membre n'a déclaré de salaire)
    total_members := SELECT COUNT(*) FROM profiles WHERE group_id = group_id_param
    contribution_amount := budget / total_members
ELSE
    -- Split proportionnel
    contribution_amount := (member.salary / total_salaries) * budget
END IF

contribution_percentage := (contribution_amount / member.salary) * 100  -- 0 si salaire = 0
```

Le résultat est UPSERT dans `group_contributions` via `ON CONFLICT (profile_id, group_id) DO UPDATE SET ...` — la contrainte unique `group_contributions_unique_profile_group` garantit l'idempotence.

### 3.3 Validation salaire vs contribution (côté form)

Le formulaire de profil ([components/profile/ProfileSettingsCard.tsx](../../components/profile/ProfileSettingsCard.tsx)) calcule **localement** (sans DB round-trip) ce que serait la contribution du user avec son nouveau salaire, via [lib/contribution-calculator.ts](../../lib/contribution-calculator.ts). Si le résultat dépasse le salaire saisi, le form est **bloqué** avec 3 suggestions UX :

1. Augmenter le salaire à au moins `Math.ceil(contribution)`
2. Demander au creator de réduire le budget à au plus **90 % de la somme des salaires actuels** (marge de sécurité)
3. Attendre que d'autres membres rejoignent (le dénominateur grandit → la part baisse)

> ⚠️ Ce calcul preview duplique la logique du RPC en TypeScript pour la réactivité. Si la formule évolue côté DB, **les deux doivent rester synchronisées**. Les tests [lib/\_\_tests\_\_/contribution-calculator.test.ts](../../lib/__tests__/contribution-calculator.test.ts) verrouillent 6 cas (happy path, fallback equal-split, salaire négatif, budget nul, contribution > salaire, marge 90 %).

### 3.4 Rôles & verrous

- **Creator** : créateur du groupe. Privilèges DB exclusifs : modifier `name` + `monthly_budget_estimate`, supprimer le groupe. Tagué via `groups.creator_id`.
- **Membre standard** : peut consulter les contributions de tout le monde dans son groupe (RLS), peut modifier son propre salaire (impact en cascade), peut quitter.
- **Verrou creator-leave** : la route `DELETE /api/groups/[id]/members` refuse (HTTP 403) si `creator_id = userId` ET `member_count > 1`. Surface UX : encart amber + bouton désactivé dans [GroupManagementPanel.tsx](../../components/settings/GroupManagementPanel.tsx) (cf. operational rule "false-affordance UX" pour le pattern).
- **Unicité de groupe par utilisateur** : `profile.group_id` est nullable mais singulier. Pour rejoindre un autre groupe, il faut d'abord quitter l'actuel (HTTP 409 sur tentative double-membership).

---

## 4. Exemples chiffrés

### 4.1 Trois salaires différents, budget 1 200 €

| Membre  | Salaire | Σ salaires | Part | Contribution | %    |
| ------- | ------- | ---------- | ---- | ------------ | ---- |
| Alice   | 1 500 € | 5 000 €    | 30 % | 360 €        | 24 % |
| Bob     | 2 000 € | 5 000 €    | 40 % | 480 €        | 24 % |
| Charlie | 1 500 € | 5 000 €    | 30 % | 360 €        | 24 % |

### 4.2 Un seul membre

| Membre | Salaire | Contribution | Note                                                  |
| ------ | ------- | ------------ | ----------------------------------------------------- |
| Alice  | 2 000 € | 1 800 €      | Tout le budget repose sur Alice — 90 % de son salaire |

C'est typiquement le cas juste après création du groupe, avant qu'un second membre n'ait rejoint.

### 4.3 Salaires non renseignés (fallback equal-split)

| Membre | Salaire | Mode                | Contribution          | %   |
| ------ | ------- | ------------------- | --------------------- | --- |
| Alice  | 0       | Σ = 0 → equal split | 1 800 / 2 = **900 €** | —   |
| Bob    | 0       | Σ = 0 → equal split | 1 800 / 2 = **900 €** | —   |

Dès qu'un membre déclare un salaire > 0, le mode bascule en proportionnel et celui à salaire 0 voit sa contribution tomber à 0 (numérateur = 0). Le formulaire **n'affiche pas d'erreur** dans ce cas (la règle `userSalary === 0 || userContribution <= userSalary` est satisfaite par le 1ᵉʳ disjoint).

### 4.4 Contribution > salaire (cas invalide)

Alice 100 €/mois, seule dans un groupe à 300 €/mois. Contribution calculée = 300 €. Le formulaire affiche :

> ⚠ Votre contribution calculée (300 €) dépasse votre salaire (100 €)
>
> **Solutions possibles** :
>
> - Augmentez votre salaire à au moins 300 €
> - Demandez au groupe de réduire le budget à 100 € maximum
> - Attendez que d'autres membres rejoignent le groupe pour réduire votre part

Le bouton "Enregistrer" est désactivé tant que la condition n'est pas levée.

---

## 5. Intégration au reste-à-vivre (RAV)

### 5.1 RAV groupe — la contribution est un **revenu**

[lib/finance/financial-data.ts:188-202](../../lib/finance/financial-data.ts) :

```ts
const { data: groupContributions } = await supabaseServer
  .from('group_contributions')
  .select('contribution_amount')
  .eq('group_id', ownerId)

const totalProfileContributions =
  groupContributions?.reduce((sum, c) => sum + c.contribution_amount, 0) ?? 0

remainingToLive = await calculateRemainingToLiveGroup(
  incomeContribution, // revenus estimés du groupe (loyers, allocations communes…)
  exceptionalIncomes, // revenus exceptionnels groupe
  totalProfileContributions, // ← somme des cotisations des membres
  totalEstimatedBudgets,
  exceptionalExpenses,
  totalBudgetDeficits,
)
```

Et [lib/finance/calc-rtl.ts:58-74](../../lib/finance/calc-rtl.ts) :

```ts
export async function calculateRemainingToLiveGroup(
  totalIncomeContribution,
  exceptionalIncomes,
  totalGroupContributions,
  estimatedBudgets,
  exceptionalExpenses,
  budgetDeficits = 0,
): Promise<number> {
  return (
    totalIncomeContribution +
    exceptionalIncomes +
    totalGroupContributions - // ← additionné comme un revenu
    estimatedBudgets -
    exceptionalExpenses -
    budgetDeficits
  )
}
```

**Lecture métier** : du point de vue du groupe, les cotisations sont la source de financement principale. Le RAV groupe = ce qui reste après avoir couvert les budgets et déficits, dans l'hypothèse où tous les membres ont effectivement versé leur quote-part.

### 5.2 RAV personnel — la contribution **n'est PAS** auto-déduite

C'est une décision produit explicite : Popoth n'opère **aucun mouvement automatique** entre le compte personnel et le compte commun. Pour qu'une cotisation impacte le RAV personnel, le membre doit :

1. Effectuer le virement réel hors-application (ou en interne via la feature "transfert").
2. Enregistrer une **dépense réelle** côté personnel (typiquement exceptionnelle, sans budget rattaché → soustraite directement du RAV via `exceptionalExpenses`).
3. Optionnellement, enregistrer un **revenu réel** côté groupe pour matérialiser l'entrée.

> ⚠️ Conséquence à connaître pour le support : un user qui voit "Contribution au groupe : 720 €" dans la navbar (cf. [UserInfoNavbar.tsx](../../components/ui/UserInfoNavbar.tsx)) ne voit **pas** ces 720 € soustraits de son RAV personnel. Le chiffre est un **engagement informatif**, pas un débit comptable.

---

## 6. Architecture technique

### 6.1 Schéma de la table `group_contributions`

[supabase/migrations/20260101000000_remote_schema.sql:85-93](../../supabase/migrations/20260101000000_remote_schema.sql) :

```sql
CREATE TABLE IF NOT EXISTS "group_contributions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "salary" numeric(10, 2) NOT NULL,
  "contribution_amount" numeric(10, 2) NOT NULL,
  "contribution_percentage" numeric(5, 2) NOT NULL,
  "calculated_at" timestamp with time zone DEFAULT now()
);
```

**Contraintes** :

- `PRIMARY KEY (id)` — UUID auto-généré
- `UNIQUE (profile_id, group_id)` — verrou anti-doublon, support du `ON CONFLICT` du RPC
- `FK profile_id → profiles(id) ON DELETE CASCADE`
- `FK group_id → groups(id) ON DELETE CASCADE` (en pratique, le trigger BEFORE DELETE fait le ménage **avant** la cascade — défensif, mais redondant)
- `CHECK contribution_amount >= 0`
- `CHECK contribution_percentage >= 0`
- `CHECK salary >= 0`

**Index** :

- `idx_group_contributions_calculated_at` — pour observer les recalculs récents
- `idx_group_contributions_group_id` — pour la lecture côté groupe (RAV)
- `idx_group_contributions_profile_id` — pour la lecture côté navbar (1 row)

> 💡 La colonne `salary` est un **snapshot** du salaire au moment du recalcul (UPSERT). Elle évite un JOIN supplémentaire sur `profiles.salary` côté lecture. Mais elle est **techniquement redondante** : la source de vérité reste `profiles.salary`, et un drift peut survenir si une UPDATE manuelle SQL contourne le trigger (cas pathologique).

### 6.2 Policies RLS

[supabase/migrations/20260507000001_fix_group_contributions_policy.sql](../../supabase/migrations/20260507000001_fix_group_contributions_policy.sql) — Sprint DB / D2 a fermé une faille où la policy précédente `USING (auth.uid() IS NOT NULL)` laissait tout user authentifié lire/écrire **n'importe quel groupe**.

```sql
-- Policy FOR ALL — accessible uniquement aux membres du groupe
CREATE POLICY "Group members can manage their group contributions"
  ON group_contributions
  FOR ALL
  USING (
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );

-- Policy FOR SELECT — fallback explicite (Postgres OR-merge les permissives)
CREATE POLICY "Users can view contributions for their own group"
  ON group_contributions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.group_id = group_contributions.group_id
    )
  );
```

> ⚠️ Toutes les routes API utilisent `supabaseServer` (service_role, **RLS bypass**, cf. [CLAUDE.md §5](../../CLAUDE.md)). Les policies RLS sont la défense **uniquement** contre un accès direct depuis le client anon (browser → Supabase REST sans passer par /api). Elles restent critiques car un bug futur pourrait introduire un accès anon, mais elles n'empêchent **pas** un bug dans une route /api de leak.

### 6.3 RPC `calculate_group_contributions`

[supabase/migrations/20260512000000_capture_trigger_functions.sql:38-119](../../supabase/migrations/20260512000000_capture_trigger_functions.sql) — fonction PL/pgSQL `SECURITY DEFINER` qui implémente la formule §3.2.

**Signature** :

```sql
CREATE OR REPLACE FUNCTION public.calculate_group_contributions(group_id_param uuid)
  RETURNS void
  LANGUAGE plpgsql
AS $function$ ... $function$;
```

**Comportement** :

1. `SELECT monthly_budget_estimate INTO group_budget FROM groups WHERE id = group_id_param` — si NULL (groupe en cours de suppression, ou inexistant), `RAISE NOTICE` + `RETURN` silencieux (pas d'exception).
2. `SELECT COALESCE(SUM(salary), 0) INTO total_salaries FROM profiles WHERE group_id = group_id_param AND salary > 0`.
3. Branche fallback si `total_salaries = 0` : COUNT(\*) puis equal-split.
4. Branche nominale : boucle `FOR member_record IN ... LOOP` qui UPSERT.
5. Le `ON CONFLICT (profile_id, group_id) DO UPDATE SET ...` met à jour `salary`, `contribution_amount`, `contribution_percentage`, `calculated_at = now()`.

**Appelée par** : 2 triggers (`groups_budget_contribution_recalc`, `profiles_contribution_recalc`) + la route force-recalc `POST /api/groups/contributions`.

**Non listée dans `EXPECTED_RPCS`** (cf. [scripts/check-rpcs.mjs](../../scripts/check-rpcs.mjs), 10 RPCs pinnées). Le check-trigger-functions ([scripts/check-trigger-functions.mjs](../../scripts/check-trigger-functions.mjs)) verrouille sa présence dans `pg_proc` séparément.

### 6.4 Les 4 triggers liés

Tous en `LANGUAGE plpgsql` `SECURITY DEFINER`, capturés en migration le Sprint Audit-Triggers (cf. [conventions/git-workflow.md §5](../../.claude/conventions/git-workflow.md)).

| Trigger                               | Table               | Évènement                  | Fonction                             | Effet                                                                                                                                   |
| ------------------------------------- | ------------------- | -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles_contribution_recalc`        | `profiles`          | AFTER INSERT/UPDATE/DELETE | `trigger_recalculate_contributions`  | Recalcule pour `NEW.group_id` (ou `OLD.group_id` si DELETE/leave). DELETE row si leave.                                                 |
| `groups_budget_contribution_recalc`   | `groups`            | AFTER UPDATE               | `trigger_group_budget_change`        | Si `monthly_budget_estimate` a changé → recalcule pour `NEW.id`.                                                                        |
| `estimated_budgets_sync_group_budget` | `estimated_budgets` | AFTER INSERT/UPDATE/DELETE | `sync_group_monthly_budget_estimate` | Recompute `SUM(estimated_amount)` du groupe → UPDATE `groups.monthly_budget_estimate` (cascade en `groups_budget_contribution_recalc`). |
| `groups_aaa_cleanup_members`          | `groups`            | BEFORE DELETE              | `cleanup_group_members_on_delete`    | Null tous les `profiles.group_id` du groupe. Préfixe `_aaa_` force l'ordre.                                                             |
| `groups_cleanup_contributions`        | `groups`            | BEFORE DELETE              | `cleanup_group_contributions`        | DELETE FROM `group_contributions` WHERE `group_id = OLD.id`.                                                                            |

**Pourquoi l'ordre des deux BEFORE DELETE sur `groups` ?** PostgreSQL fire les triggers du même événement par **ordre alphabétique du nom**. `groups_aaa_cleanup_members` (préfixe `_aaa_`) fire avant `groups_cleanup_contributions`. Du coup :

1. Les `profiles.group_id` sont d'abord nullés. Cela déclenche `profiles_contribution_recalc` (AFTER UPDATE), mais `NEW.group_id = NULL` → aucun recalcul utile, et la branche "OLD.group_id != NEW.group_id" tente un recalcul pour le `OLD.group_id` (le groupe mourant) ; ce recalcul lit `monthly_budget_estimate = NULL` (le groupe est en cours de DELETE) → exit silencieux via la garde `IF group_budget IS NULL THEN RETURN`.
2. Puis `groups_cleanup_contributions` DELETE les `group_contributions` du groupe — pas de churn ni de réinsertion.
3. Enfin la ligne `groups` est DELETE.

> 🔍 Cf. [supabase/migrations/20260515000000_add_group_members_cleanup_trigger.sql](../../supabase/migrations/20260515000000_add_group_members_cleanup_trigger.sql) pour le post-mortem de cet ordering, et [.claude/conventions/git-workflow.md §10](../../.claude/conventions/git-workflow.md) pour la règle générale "vérifier ON DELETE existant avant d'ajouter un trigger".

### 6.5 Flux trigger join/leave/budget/delete

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Action UI                  Mutation SQL                Trigger fired   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  POST /api/groups          INSERT groups + UPDATE       profiles_recalc │
│  (création + auto-join,    profiles.group_id            → create row 1  │
│   budget = 0 default)                                                   │
│                                                                         │
│  POST /api/groups/[id]/    UPDATE profiles              profiles_recalc │
│  members (rejoindre)       SET group_id = X             → create row +  │
│                                                            recalc all   │
│                                                                         │
│  DELETE /api/groups/[id]/  UPDATE profiles              profiles_recalc │
│  members (quitter)         SET group_id = NULL          → DELETE row +  │
│                                                            recalc rest  │
│                                                                         │
│  PUT /api/profile          UPDATE profiles              profiles_recalc │
│  (changer salaire)         SET salary = N               → recalc all    │
│                                                            (own + peers)│
│                                                                         │
│  POST/PUT/DELETE           INSERT/UPDATE/DELETE         budget_sync     │
│  /api/finance/budgets      estimated_budgets            → UPDATE groups │
│  (?context=group)          WHERE group_id IS NOT NULL   .monthly_budget │
│                                                            (= SUM)      │
│                                                         budget_recalc   │
│                                                         → recalc all    │
│                                                                         │
│  DELETE /api/groups/[id]   DELETE groups                aaa_cleanup     │
│  (creator solo only)                                    → null members  │
│                                                         cleanup_contrib │
│                                                         → DELETE rows   │
│                                                         FK CASCADE      │
│                                                         → DELETE row    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Surface API

### 7.1 `GET /api/groups/contributions`

[app/api/groups/contributions/route.ts:36-112](../../app/api/groups/contributions/route.ts). Wrappé par `withAuthAndProfile`. Retourne :

```ts
{
  contributions: Array<{
    id: string
    profile_id: string
    group_id: string
    salary: number
    contribution_amount: number
    contribution_percentage: number
    calculated_at: string | null
    profile: { first_name: string; last_name: string } | null
  }>,
  group_info: {
    id: string
    name: string
    monthly_budget_estimate: number
    total_salaries: number          // recalculé côté API depuis les rows
    total_contributions: number     // idem
  }
}
```

- HTTP 400 si `profile.group_id === null` (l'utilisateur n'est pas dans un groupe — le hook traite ce 400 comme "pas d'erreur", retour `[]`).
- HTTP 404 si le groupe a disparu entre-temps (race avec un DELETE concurrent).
- HTTP 500 sur erreur DB générique.

### 7.2 `POST /api/groups/contributions` — force-recalc

Pour les cas où le trigger aurait silencieusement échoué (ex. avant Sprint Audit-Triggers, où les fonctions n'étaient pas versionnées). Appelle directement le RPC `calculate_group_contributions(group_id_param)` via `supabase.rpc(...)`. Retour `{ message, group_id }` ou HTTP 500.

> Surfacé côté UI via le bouton "Actualiser" sur [UserContributionCard.tsx](../../components/contributions/UserContributionCard.tsx). Géré côté hook par `recalculateContributions()` qui chaîne ensuite un `fetchContributions()` pour rafraîchir la vue.

### 7.3 Routes connexes

| Route                                                     | Méthode         | Effet sur les contributions                                                                                                                                                       |
| --------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/groups`                                        | POST            | Création + auto-join → 1 row contribution                                                                                                                                         |
| `PUT /api/groups/[id]`                                    | PUT             | UPDATE `name` only (creator only). Budget n'est plus mutable via API — auto-syncé depuis `estimated_budgets`.                                                                     |
| `POST/PUT/DELETE /api/finance/budgets` (`?context=group`) | POST/PUT/DELETE | Mute l'item `estimated_budget` → trigger `estimated_budgets_sync_group_budget` UPDATE `groups.monthly_budget_estimate` → cascade `groups_budget_contribution_recalc` → recalc all |
| `DELETE /api/groups/[id]`                                 | DELETE          | DELETE all rows via trigger (creator solo only)                                                                                                                                   |
| `POST /api/groups/[id]/members`                           | POST            | Join → +1 row + recalc all                                                                                                                                                        |
| `DELETE /api/groups/[id]/members`                         | DELETE          | Leave → -1 row + recalc rest (creator blocked si > 1 membre)                                                                                                                      |
| `PUT /api/profile` (champ `salary`)                       | PUT             | Recalc all (cascade via trigger sur `profiles`)                                                                                                                                   |

---

## 8. Surface client

### 8.1 Composants

| Composant                            | Localisation                                                                         | Rôle                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `ProfileSettingsCard`                | [components/profile/](../../components/profile/ProfileSettingsCard.tsx)              | Form profil — édition nom, prénom, **salaire**. Affiche la contribution preview. Validation bloquante. |
| `UserContributionCard`               | [components/contributions/](../../components/contributions/UserContributionCard.tsx) | Carte dashboard détaillée (budget groupe, contribution €/%, stats, "Actualiser").                      |
| `UserInfoNavbar`                     | [components/ui/](../../components/ui/UserInfoNavbar.tsx)                             | Navbar — affichage compact "Contribution au groupe X : 720 € (36 %)". État empty avec tooltip.         |
| `GroupMembersWithContributionsModal` | [components/groups/](../../components/groups/GroupMembersWithContributionsModal.tsx) | Modal Radix Dialog — liste membres + contribution individuelle. Empty state si salaire non défini.     |
| `GroupManagementPanel`               | [components/settings/](../../components/settings/GroupManagementPanel.tsx)           | Panneau settings — créer/rejoindre/quitter groupe, voir membres, badge "Créateur".                     |

### 8.2 Hook `useGroupContributions`

[hooks/useGroupContributions.ts](../../hooks/useGroupContributions.ts) — hook **TanStack Query** (Sprint Group-Budget-Auto-Sync 2026-05-19). Une `useQuery` sur queryKey `['group-contributions']` pour le GET + une `useMutation` pour le POST force-recalc. Invalidé automatiquement par `invalidateFinancialRefreshes` (cf. [lib/query-client.ts](../../lib/query-client.ts)), donc créer/modifier/supprimer un `estimated_budget` (via `useBudgets.*`) rafraîchit la contribution sans plumbing manuel.

**API publique** :

```ts
const {
  // Data
  contributions, // GroupContributionData[]
  groupInfo, // { id, name, monthly_budget_estimate, total_salaries, total_contributions } | null

  // Loading states
  isLoading, // boolean
  error, // string | null
  isRecalculating, // boolean

  // Methods
  fetchContributions, // () => Promise<void>
  recalculateContributions, // () => Promise<boolean>  — force-RPC
  getUserContribution, // (userId: string) => GroupContributionData | null
  getGroupStats, // () => { averageContribution, highestContribution, lowestContribution, memberCount }
  resetContributions, // () => void
  cleanup, // () => void  — abort pending request

  // Computed flags
  hasContributions, // boolean
  hasGroup, // boolean — groupInfo !== null
  totalMembers, // number
  isOperationInProgress, // boolean — isLoading || isRecalculating
} = useGroupContributions()
```

L'annulation de requête en vol est désormais gérée nativement par TanStack Query via le `AbortSignal` passé à `queryFn`. Les méthodes `resetContributions` et `cleanup` deviennent des no-ops (préservées pour rétro-compat des consumers existants — TanStack gère cache + lifecycle).

### 8.3 Helper pur `calculateUserContribution`

[lib/contribution-calculator.ts](../../lib/contribution-calculator.ts) — duplication TypeScript de la formule DB pour le preview form. **Synchrone, zéro I/O, zéro Supabase**.

```ts
calculateUserContribution(
  userSalary: number,
  groupBudget: number,
  otherMembers: GroupMember[] = [],
): ContributionCalculation
// → { userContribution, userPercentage, isValid, errorMessage?, suggestions? }
```

À **ne pas confondre** avec `calculateIncomeCompensation` ([lib/finance/income-compensation.ts](../../lib/finance/income-compensation.ts)) qui agrège les revenus pour le RAV — domaines orthogonaux malgré la proximité du naming (cf. CLAUDE.md §5 "Distinction calculs finance").

---

## 9. Tests

### 9.1 Tests unitaires non-gated

[lib/\_\_tests\_\_/contribution-calculator.test.ts](../../lib/__tests__/contribution-calculator.test.ts) — 6 cas :

1. Happy path proportionnel (3 membres, salaires non-nuls)
2. `totalGroupSalaries === 0` → fallback equal-split
3. `userSalary` négatif → invalide
4. `groupBudget === 0` → invalide
5. `contribution > salary` (single-member) → 3 suggestions
6. `contribution > salary` (multi-member) → marge 90 % dans suggestions[1]

### 9.2 Tests gated `SUPABASE_TRIGGER_TESTS=1`

[lib/\_\_tests\_\_/trigger-behavior.test.ts](../../lib/__tests__/trigger-behavior.test.ts) — 5 cas end-to-end staging (Sprint Audit-Functions-v2 / B2) :

1. `trigger_recalculate_contributions` auto-crée une row à l'INSERT/UPDATE join
2. `trigger_group_budget_change` recalcule à l'UPDATE de `monthly_budget_estimate` (somme conservée = nouveau budget)
3. `cleanup_group_contributions` wipe toutes les rows au DELETE du groupe
4. `update_updated_at_column` (boilerplate canonique, sanity check)
5. FK `ON DELETE SET NULL` sur `profiles.group_id` quand un groupe est supprimé

> Ces tests sont skipped par défaut (`describe.skipIf(!ENABLED)`). Activation : `SUPABASE_TRIGGER_TESTS=1 pnpm test:run` avec `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local`.

### 9.3 Tests RLS isolation gated `SUPABASE_RLS_TESTS=1`

[lib/finance/\_\_tests\_\_/rls-isolation.test.ts](../../lib/finance/__tests__/rls-isolation.test.ts) — vérifie qu'un user anon ne peut pas lire/écrire les contributions d'un autre groupe via la policy `Group members can manage...`.

---

## 10. Pièges & invariants critiques

### 10.1 Aucune déduction automatique côté profil

Le RAV personnel d'un membre n'inclut **pas** sa contribution comme une charge implicite. La contribution est un engagement informatif qui se matérialise uniquement quand le user enregistre une dépense réelle (virement vers le compte commun). Voir §5.2.

### 10.2 Triggers non-atomiques avec la mutation déclenchante

Les triggers `AFTER` ne bloquent pas la transaction parente. Si `calculate_group_contributions` levait une exception (cas non-attendu — la fonction est défensive avec `RAISE NOTICE + RETURN` plutôt qu'erreur), la mutation parente (UPDATE profile, INSERT group, etc.) **roulerait quand même quand même back via la transaction**. En revanche, si un trigger silencieusement no-op-e (cas pathologique d'une fonction stubbée), les rows seraient stale → besoin du bouton "Actualiser" pour forcer un RPC explicite.

> Le filet : `pnpm db:check-functions` ([scripts/check-trigger-functions.mjs](../../scripts/check-trigger-functions.mjs)) vérifie la **présence** des 4 fonctions dans `pg_proc`. La **behavior** est verrouillée par les tests gated `SUPABASE_TRIGGER_TESTS=1` (cf. §9.2). Un stub `BEGIN RETURN NEW; END` passerait check-functions mais ferait sortir les tests rouge.

### 10.3 Snapshot `group_contributions.salary` vs `profiles.salary`

La colonne `group_contributions.salary` est un snapshot UPSERT à chaque recalcul. Si une UPDATE manuelle SQL contourne le trigger (ex. backfill DB-only), les valeurs peuvent diverger. **Source de vérité = `profiles.salary`**. Le bouton "Actualiser" remet d'aplomb via un appel RPC explicite.

### 10.4 RLS bypass via service_role

Toutes les routes `/api/groups/**` utilisent `supabaseServer` qui bypass RLS. Les policies (§6.2) restent indispensables car :

1. Défense en profondeur contre un futur accès anon depuis le client browser (qui passerait par `supabase-client.ts`).
2. Protection des tests gated qui utilisent un client anon pour valider l'isolation cross-user.

Toute nouvelle route lisant/écrivant `group_contributions` **doit** soit utiliser `withAuthAndProfile` pour vérifier `profile.group_id`, soit utiliser un client anon (rare).

### 10.5 Verrou creator-leave — défense en profondeur

Le verrou "creator ne peut pas quitter si d'autres membres" existe à 3 niveaux :

1. **Backend** ([app/api/groups/[id]/members/route.ts:147-169](../../app/api/groups/[id]/members/route.ts)) — HTTP 403.
2. **Frontend handler** ([GroupManagementPanel.tsx:89-98](../../components/settings/GroupManagementPanel.tsx)) — court-circuit `if (otherMembers > 0) return`.
3. **Frontend UX** — bouton désactivé + encart amber explicatif (cf. operational rule "false-affordance UX").

Aucun de ces niveaux ne supprime le besoin des autres : le backend protège contre un client malveillant, le frontend handler protège contre un `setState` direct, l'UX protège contre un user qui ne comprend pas pourquoi son clic ne fait rien.

### 10.6 Pas d'historisation

`group_contributions` n'historise PAS les calculs passés. Un recalcul UPSERT écrase la ligne existante. Si une feature "historique des cotisations mensuelles" devait être ajoutée, il faudrait :

- soit une table d'archive `group_contributions_history` alimentée par un trigger post-recalc,
- soit utiliser les `recap_snapshots` (cf. workflow recap mensuel) pour figer un état à la clôture du mois.

---

## 11. Roadmap & dette connue

- [x] ~~**Migrer `useGroupContributions` vers TanStack Query**~~ — fait Sprint Group-Budget-Auto-Sync (2026-05-19). Le hook utilise désormais `useQuery + useMutation` avec queryKey `['group-contributions']`, invalidé via `invalidateFinancialRefreshes`.
- [ ] **Lier formellement la formule DB et le helper TS** — soit déplacer le calcul côté client (DB devient lecture seule), soit générer le TS depuis un schéma source unique. Aujourd'hui synchronisation manuelle.
- [ ] **Atomicité contribution + transfert réel** — ajouter une feature optionnelle "marquer ma contribution comme payée ce mois-ci" qui déclencherait une dépense réelle automatique côté profil + revenu réel côté groupe (toggle utilisateur).
- [ ] **Historisation mensuelle** — utile pour les recaps "qui a contribué quoi sur l'année".

---

## 12. Références code

| Fichier                                                                                                                                                    | Rôle                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [supabase/migrations/20260101000000_remote_schema.sql](../../supabase/migrations/20260101000000_remote_schema.sql)                                         | Baseline schéma (table + indexes + RLS + triggers liés)          |
| [supabase/migrations/20260507000001_fix_group_contributions_policy.sql](../../supabase/migrations/20260507000001_fix_group_contributions_policy.sql)       | Sprint DB / D2 — fix policy over-permissive                      |
| [supabase/migrations/20260512000000_capture_trigger_functions.sql](../../supabase/migrations/20260512000000_capture_trigger_functions.sql)                 | Sprint Audit-Triggers / A2 — capture des 4 fonctions PL/pgSQL    |
| [supabase/migrations/20260515000000_add_group_members_cleanup_trigger.sql](../../supabase/migrations/20260515000000_add_group_members_cleanup_trigger.sql) | Trigger `groups_aaa_cleanup_members` (FK SET NULL backup)        |
| [lib/contribution-calculator.ts](../../lib/contribution-calculator.ts)                                                                                     | Helper pur preview form (sync, 0 I/O)                            |
| [lib/finance/financial-data.ts](../../lib/finance/financial-data.ts)                                                                                       | `_loadFinancialData` — agrège totalProfileContributions pour RAV |
| [lib/finance/calc-rtl.ts](../../lib/finance/calc-rtl.ts)                                                                                                   | `calculateRemainingToLiveGroup` — formule avec contributions     |
| [app/api/groups/contributions/route.ts](../../app/api/groups/contributions/route.ts)                                                                       | GET (read) + POST (force-recalc)                                 |
| [app/api/groups/[id]/members/route.ts](../../app/api/groups/[id]/members/route.ts)                                                                         | POST join / DELETE leave                                         |
| [app/api/groups/[id]/route.ts](../../app/api/groups/[id]/route.ts)                                                                                         | PUT update name/budget + DELETE group                            |
| [hooks/useGroupContributions.ts](../../hooks/useGroupContributions.ts)                                                                                     | Hook client (fetch + recalc + computed)                          |
| [hooks/useGroups.ts](../../hooks/useGroups.ts)                                                                                                             | Mutations TanStack (create/join/leave + invalidations RAV)       |
| [components/profile/ProfileSettingsCard.tsx](../../components/profile/ProfileSettingsCard.tsx)                                                             | Form profil + validation salaire vs contribution                 |
| [components/contributions/UserContributionCard.tsx](../../components/contributions/UserContributionCard.tsx)                                               | Carte détaillée dashboard                                        |
| [components/groups/GroupMembersWithContributionsModal.tsx](../../components/groups/GroupMembersWithContributionsModal.tsx)                                 | Modal membres + contributions                                    |
| [components/settings/GroupManagementPanel.tsx](../../components/settings/GroupManagementPanel.tsx)                                                         | Panel settings (create/join/leave/voir membres)                  |
| [components/ui/UserInfoNavbar.tsx](../../components/ui/UserInfoNavbar.tsx)                                                                                 | Navbar compacte                                                  |
| [lib/\_\_tests\_\_/contribution-calculator.test.ts](../../lib/__tests__/contribution-calculator.test.ts)                                                   | 6 cas unit non-gated                                             |
| [lib/\_\_tests\_\_/trigger-behavior.test.ts](../../lib/__tests__/trigger-behavior.test.ts)                                                                 | 5 cas e2e gated `SUPABASE_TRIGGER_TESTS=1`                       |
| [scripts/check-trigger-functions.mjs](../../scripts/check-trigger-functions.mjs)                                                                           | Filet CI : 4 fonctions PL/pgSQL présentes dans `pg_proc`         |

---

_Document maintenu manuellement. Mettre à jour quand la formule, les triggers, ou les routes changent. Référence dans `doc2/` (pas chargé en contexte Claude Code par défaut, donc pas soumis à la règle 38k chars)._
