# Tests Monthly Recap - Cas de Tests Console F12

Ce document contient des appels `fetch()` à copier/coller dans la console développeur (F12) pour tester tous les scénarios du Monthly Recap.

**Référence**: Voir `MONTHLY_RECAP_SPECIFICATION.md` pour les règles de rééquilibrage.

---

## Table des Matières

1. [Prérequis et Utilitaires](#prérequis-et-utilitaires)
2. [CAS 1: RAV Positif avec Gros Surplus](#cas-1-rav-positif-avec-gros-surplus)
3. [CAS 2: RAV Négatif - Déficit Critique](#cas-2-rav-négatif---déficit-critique)
4. [CAS 3: RAV Négatif avec Tirelire Suffisante](#cas-3-rav-négatif-avec-tirelire-suffisante)
5. [CAS 4: RAV Négatif avec Économies sur Budgets](#cas-4-rav-négatif-avec-économies-sur-budgets)
6. [CAS 5: Déficit Extrême (Ressources Épuisées)](#cas-5-déficit-extrême-ressources-épuisées)
7. [CAS 6: Excédent avec Budgets Déficitaires Individuels](#cas-6-excédent-avec-budgets-déficitaires-individuels)
8. [CAS 7: Grosses Économies Accumulées](#cas-7-grosses-économies-accumulées)
9. [CAS 8: Revenus Élevés avec Économies](#cas-8-revenus-élevés-avec-économies)
10. [Flux Complet du Monthly Recap](#flux-complet-du-monthly-recap)

---

## Prérequis et Utilitaires

### Vérifier le statut du Monthly Recap

```javascript
// Vérifier si le monthly recap doit se déclencher
fetch('/api/monthly-recap/status?context=profile')
  .then(r => r.json())
  .then(data => {
    console.log('📅 Statut Monthly Recap:');
    console.log('  - Required:', data.required);
    console.log('  - Has Existing Recap:', data.hasExistingRecap);
    console.log('  - Date:', data.currentDay + '/' + data.currentMonth + '/' + data.currentYear);
    console.log('  - Context ID:', data.contextId);
  });
```

### Voir l'état financier actuel

```javascript
// Voir toutes les données financières
fetch('/api/debug/financial')
  .then(r => r.json())
  .then(data => {
    console.log('💰 État financier actuel:');
    console.log('  - Solde bancaire:', data.bankBalance, '€');
    console.log('  - Revenus estimés:', data.totalEstimatedIncome, '€');
    console.log('  - Revenus réels:', data.totalRealIncome, '€');
    console.log('  - Budgets estimés:', data.totalEstimatedBudget, '€');
    console.log('  - Dépenses réelles:', data.totalRealExpenses, '€');
    console.log('  - RAV actuel:', data.remainingToLive, '€');
    console.log('  - RAV budgétaire:', data.totalEstimatedIncome - data.totalEstimatedBudget, '€');
    console.log('  - Différence:', data.remainingToLive - (data.totalEstimatedIncome - data.totalEstimatedBudget), '€');
  });
```

### Voir les budgets détaillés (surplus/déficit/économies)

```javascript
// Voir le détail complet des budgets
fetch('/api/debug/remaining-to-live')
  .then(r => r.json())
  .then(data => {
    console.log('📊 Détail des budgets:');
    console.log('============================================');
    for (const budget of data.budgets || []) {
      const status = budget.surplus > 0 ? '🟢' : budget.deficit > 0 ? '🔴' : '⚪';
      console.log(`${status} ${budget.name}:`);
      console.log(`   Estimé: ${budget.estimated_amount}€ | Dépensé: ${budget.spent_amount}€`);
      console.log(`   Surplus: ${budget.surplus}€ | Déficit: ${budget.deficit}€`);
      console.log(`   Économies cumulées: ${budget.cumulated_savings}€`);
    }
    console.log('============================================');
    console.log('💰 RAV Actuel:', data.remaining_to_live, '€');
    console.log('🎯 RAV Budgétaire:', data.rav_budgetaire, '€');
    console.log('📊 Tirelire:', data.piggy_bank || 0, '€');
  });
```

### Configurer la tirelire

```javascript
// Définir le montant de la tirelire
(async () => {
  const MONTANT_TIRELIRE = 500; // Modifier cette valeur

  const response = await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_piggy_bank',
      amount: MONTANT_TIRELIRE,
      context: 'profile'
    })
  });

  const result = await response.json();
  console.log('🐷 Tirelire configurée:', MONTANT_TIRELIRE, '€');
  console.log('Résultat:', result);
})();
```

---

## CAS 1: RAV Positif avec Gros Surplus

**Scénario**: RAV Actuel > RAV Budgétaire (revenus exceptionnels)
- Surplus sur plusieurs budgets
- L'excédent global va à la tirelire
- Les surplus vont aux économies

**Règle spec (Cas 1)**:
1. Transférer surplus → économies
2. Transférer excédent (RAV_Actuel - RAV_Budgétaire) → tirelire

### 1.1 Peupler les données

```javascript
// CAS 1: RAV TRÈS POSITIF avec surplus - Gestion excellente
(async () => {
  console.log('🟢 CAS 1: Création scénario RAV TRÈS POSITIF');
  console.log('Attendu: Surplus → Économies, Excédent → Tirelire');

  const response = await fetch('/api/debug/populate-positive-rav-savings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();
  console.log('✅ Scénario créé:', result.scenario);
  console.log('💰 RAV estimé:', result.financial_impact?.estimatedRAV, '€');
  console.log('📊 Économies totales:', result.financial_impact?.totalSavings, '€');
  console.log('🎯 Status:', result.financial_impact?.status);

  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

### 1.2 Configurer une tirelire initiale (optionnel)

```javascript
// Ajouter de l'argent à la tirelire avant le test
(async () => {
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'add_to_piggy_bank',
      amount: 200,
      context: 'profile'
    })
  });
  console.log('🐷 200€ ajoutés à la tirelire');
})();
```

---

## CAS 2: RAV Négatif - Déficit Critique

**Scénario**: RAV Actuel < RAV Budgétaire (dépenses excessives)
- Dépenses supérieures aux budgets
- Pas assez de tirelire ni d'économies pour compenser
- Prélèvement dans les budgets

**Règle spec (Cas 2)**:
1. Transférer surplus → économies
2. Utiliser tirelire
3. Utiliser économies proportionnellement
4. Prélever dans budgets proportionnellement

### 2.1 Peupler les données

```javascript
// CAS 2: RAV NÉGATIF - Situation financière critique
(async () => {
  console.log('🔴 CAS 2: Création scénario RAV NÉGATIF');
  console.log('Attendu: Utilisation Tirelire → Économies → Budgets');

  const response = await fetch('/api/debug/populate-negative-rav', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();
  console.log('✅ Scénario créé:', result.scenario);
  console.log('⚠️ RAV estimé:', result.financial_impact?.estimatedRAV, '€');
  console.log('🔴 Déficit net:', result.financial_impact?.netDeficit, '€');
  console.log('🚨 Niveau de crise:', result.financial_impact?.crisis_level);

  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

---

## CAS 3: RAV Négatif avec Tirelire Suffisante

**Scénario**: Déficit comblé uniquement par la tirelire
- Tirelire > Gap à combler
- Économies restent intactes
- Budgets restent intacts

### 3.1 Peupler les données + Grosse tirelire

```javascript
// CAS 3: RAV négatif MAIS tirelire suffisante
(async () => {
  console.log('🐷 CAS 3: Création scénario TIRELIRE SUFFISANTE');
  console.log('Attendu: Seule la tirelire est utilisée');

  // 1. Créer un scénario avec déficit modéré
  await fetch('/api/debug/populate-negative-savings-only', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  // 2. Ajouter une grosse tirelire (2000€)
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_piggy_bank',
      amount: 2000,
      context: 'profile'
    })
  });

  console.log('✅ Scénario créé avec tirelire de 2000€');
  console.log('🐷 La tirelire devrait absorber tout le déficit');
  console.log('💎 Les économies devraient rester intactes');

  // Vérifier les données
  const finRes = await fetch('/api/debug/financial');
  const finData = await finRes.json();
  console.log('\n💰 État actuel:');
  console.log('  RAV:', finData.remainingToLive, '€');
  console.log('  Tirelire: 2000€');

  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

---

## CAS 4: RAV Négatif avec Économies sur Budgets

**Scénario**: Tirelire vide, économies compensent le déficit
- Tirelire = 0€
- Économies cumulées sur plusieurs budgets
- Prélèvement proportionnel dans les économies

### 4.1 Peupler les données

```javascript
// CAS 4: Compensation par les ÉCONOMIES UNIQUEMENT
(async () => {
  console.log('💎 CAS 4: Création scénario ÉCONOMIES SEULES');
  console.log('Attendu: Tirelire vide → Économies utilisées proportionnellement');

  const response = await fetch('/api/debug/populate-negative-savings-only', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();
  console.log('✅ Scénario créé:', result.scenario);
  console.log('💎 Économies nettes:', result.statistics?.totals?.netSavings, '€');

  // S'assurer que la tirelire est vide
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_piggy_bank',
      amount: 0,
      context: 'profile'
    })
  });

  console.log('🐷 Tirelire vidée');
  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

### 4.2 Alternative: Ajouter des économies manuellement

```javascript
// Ajouter des économies cumulées aux budgets
(async () => {
  console.log('💎 Ajout manuel d\'économies cumulées...');

  // 1. Récupérer les budgets existants
  const budgetsRes = await fetch('/api/finances/budgets/estimated');
  const budgetsData = await budgetsRes.json();
  const budgets = budgetsData.data || [];

  console.log('Budgets trouvés:', budgets.length);

  // 2. Ajouter des économies à chaque budget (100-500€)
  for (const budget of budgets.slice(0, 5)) {
    const savingsAmount = Math.floor(Math.random() * 400) + 100;

    await fetch('/api/finances/budgets/estimated', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: budget.id,
        cumulated_savings: savingsAmount
      })
    });

    console.log(`  💎 ${budget.name}: +${savingsAmount}€ économies`);
  }

  console.log('✅ Économies ajoutées aux 5 premiers budgets');
})();
```

---

## CAS 5: Déficit Extrême (Ressources Épuisées)

**Scénario**: Déficit impossible à combler
- Tirelire + Économies + Budgets insuffisants
- Affichage d'un avertissement
- Gap résiduel

### 5.1 Peupler les données

```javascript
// CAS 5: DÉFICIT EXTRÊME - Crise financière majeure
(async () => {
  console.log('🚨 CAS 5: Création scénario DÉFICIT EXTRÊME');
  console.log('Attendu: Toutes ressources épuisées + Gap résiduel');

  const response = await fetch('/api/debug/populate-extreme-deficit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();
  console.log('🚨 Scénario créé:', result.scenario);
  console.log('💔 Solde bancaire:', result.financial_impact?.bankBalance, '€');
  console.log('💸 Dépenses totales:', result.financial_impact?.totalSpent, '€');
  console.log('⚠️ RAV estimé:', result.financial_impact?.estimatedRAV, '€');
  console.log('🔴 Score de crise:', result.financial_impact?.crisisScore, '/100');

  // Vider tirelire et économies pour accentuer
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_piggy_bank',
      amount: 0,
      context: 'profile'
    })
  });

  console.log('\n🐷 Tirelire vidée pour maximiser le déficit');
  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

---

## CAS 6: Excédent avec Budgets Déficitaires Individuels

**Scénario**: RAV global positif mais certains budgets en déficit
- RAV Actuel > RAV Budgétaire (excédent global)
- Certains budgets individuels en déficit
- La tirelire renfloue les budgets déficitaires

**Règle spec (Cas 1, Étapes 1.3-1.4)**:
1. Identifier budgets déficitaires
2. Renflouer depuis tirelire puis économies

### 6.1 Peupler les données

```javascript
// CAS 6: EXCÉDENT + BUDGETS DÉFICITAIRES
(async () => {
  console.log('🟢🔴 CAS 6: Création scénario EXCÉDENT + DÉFICITS INDIVIDUELS');
  console.log('Attendu: Excédent → Tirelire, puis Tirelire → Budgets déficitaires');

  const response = await fetch('/api/debug/populate-balanced-risky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();
  console.log('✅ Scénario créé');
  console.log('📊 Budgets en surplus:', result.statistics?.budgetsByStatus?.surplus?.length);
  console.log('📊 Budgets en déficit:', result.statistics?.budgetsByStatus?.deficit?.length);

  // Ajouter une tirelire initiale
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_piggy_bank',
      amount: 500,
      context: 'profile'
    })
  });

  console.log('🐷 Tirelire configurée à 500€');
  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

---

## CAS 7: Grosses Économies Accumulées

**Scénario**: Beaucoup d'économies sur presque tous les budgets
- Économies massives (70-90% d'économies par budget)
- Test de l'accumulation des surplus

### 7.1 Peupler les données

```javascript
// CAS 7: ÉCONOMIES MASSIVES - Excellent gestionnaire
(async () => {
  console.log('💚 CAS 7: Création scénario ÉCONOMIES MASSIVES');
  console.log('Attendu: Gros surplus transférés vers économies');

  const response = await fetch('/api/debug/populate-massive-savings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();
  console.log('✅ Scénario créé:', result.scenario);
  console.log('💰 Total estimé:', result.statistics?.totals?.estimated, '€');
  console.log('💸 Total dépensé:', result.statistics?.totals?.spent, '€');
  console.log('💎 Total économies:', result.statistics?.totals?.savings, '€');
  console.log('📈 Taux d\'économie:', result.statistics?.totals?.savingsPercent);

  // Ajouter une tirelire initiale
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_piggy_bank',
      amount: 300,
      context: 'profile'
    })
  });

  console.log('🐷 Tirelire configurée à 300€');
  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

---

## CAS 8: Revenus Élevés avec Économies

**Scénario**: Situation financière optimale
- Revenus > Budgets estimés
- Économies cumulées sur plusieurs budgets
- RAV très positif

### 8.1 Peupler les données

```javascript
// CAS 8: REVENUS ÉLEVÉS + ÉCONOMIES CUMULÉES
(async () => {
  console.log('💰 CAS 8: Création scénario REVENUS ÉLEVÉS + ÉCONOMIES');
  console.log('Attendu: RAV excellent, surplus → économies, excédent → tirelire');

  const response = await fetch('/api/debug/populate-high-income-savings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();
  console.log('✅ Scénario créé:', result.scenario);
  console.log('💰 Revenus totaux:', result.statistics?.totals?.income, '€');
  console.log('📊 Budgets estimés:', result.statistics?.totals?.estimated, '€');
  console.log('💸 Dépenses réelles:', result.statistics?.totals?.spent, '€');
  console.log('💎 Économies cumulées:', result.statistics?.totals?.cumulatedSavings, '€');
  console.log('🎯 RAV:', result.statistics?.totals?.remainingToLive, '€');
  console.log('📈 Status RAV:', result.financial_impact?.rav_status);

  // Ajouter une tirelire initiale modeste
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_piggy_bank',
      amount: 150,
      context: 'profile'
    })
  });

  console.log('🐷 Tirelire configurée à 150€');
  console.log('\n⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

---

## Flux Complet du Monthly Recap

### Étape 0: Vérifier et préparer

```javascript
// Vérification complète avant de lancer
(async () => {
  console.log('🔍 VÉRIFICATION COMPLÈTE');
  console.log('========================');

  // 1. Status
  const statusRes = await fetch('/api/monthly-recap/status?context=profile');
  const status = await statusRes.json();
  console.log('\n📅 Status:');
  console.log('  Required:', status.required);
  console.log('  Has Existing:', status.hasExistingRecap);

  // 2. Données financières
  const finRes = await fetch('/api/debug/financial');
  const fin = await finRes.json();
  console.log('\n💰 Finances:');
  console.log('  RAV Actuel:', fin.remainingToLive, '€');
  console.log('  RAV Budgétaire:', fin.totalEstimatedIncome - fin.totalEstimatedBudget, '€');
  console.log('  Différence:', fin.remainingToLive - (fin.totalEstimatedIncome - fin.totalEstimatedBudget), '€');

  // 3. Détails des budgets
  const budgetsRes = await fetch('/api/debug/remaining-to-live');
  const budgets = await budgetsRes.json();
  console.log('\n📊 Budgets:');
  console.log('  Total Surplus:', budgets.total_surplus, '€');
  console.log('  Total Déficit:', budgets.total_deficit, '€');
  console.log('  Tirelire:', budgets.piggy_bank || 0, '€');
  console.log('  Économies cumulées:', budgets.cumulated_savings || 0, '€');

  console.log('\n========================');
  if (status.required) {
    console.log('✅ Monthly Recap PRÊT - Actualisez la page');
  } else {
    console.log('⚠️ Monthly Recap non requis ou déjà fait');
  }
})();
```

### Étape 1: Initialiser le monthly recap

```javascript
// Initialiser le monthly recap
(async () => {
  console.log('🚀 INITIALISATION MONTHLY RECAP');

  const response = await fetch('/api/monthly-recap/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'profile' })
  });

  const data = await response.json();

  if (!data.success) {
    console.error('❌ Erreur:', data.error);
    return;
  }

  console.log('✅ Initialisé!');
  console.log('  Session ID:', data.session_id);
  console.log('  RAV actuel:', data.current_remaining_to_live, '€');
  console.log('  Surplus total:', data.total_surplus, '€');
  console.log('  Déficit total:', data.total_deficit, '€');
  console.log('  Ratio général:', data.general_ratio, '€');

  // Sauvegarder pour les étapes suivantes
  window.monthlyRecapSession = data.session_id;
  window.monthlyRecapRAV = data.current_remaining_to_live;

  console.log('\n📋 Budgets:');
  for (const budget of data.budget_stats || []) {
    const status = budget.surplus > 0 ? '🟢' : budget.deficit > 0 ? '🔴' : '⚪';
    console.log(`  ${status} ${budget.name}: surplus=${budget.surplus}€, déficit=${budget.deficit}€`);
  }
})();
```

### Étape 2: Exécuter le rééquilibrage (Process Step 1)

```javascript
// Exécuter l'algorithme de rééquilibrage
(async () => {
  console.log('⚙️ EXÉCUTION RÉÉQUILIBRAGE (Step 1)');

  const response = await fetch('/api/monthly-recap/process-step1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'profile' })
  });

  const data = await response.json();

  if (!data.success) {
    console.error('❌ Erreur:', data.error);
    return;
  }

  console.log('✅ Rééquilibrage effectué!');
  console.log('  Cas:', data.case === 'excedent' ? '🟢 EXCÉDENT' : '🔴 DÉFICIT');
  console.log('  RAV initial:', data.initial_rav, '€');
  console.log('  RAV final:', data.final_rav, '€');
  console.log('  RAV budgétaire:', data.budgetary_rav, '€');
  console.log('  Différence:', data.difference, '€');
  console.log('  Tirelire finale:', data.piggy_bank_final, '€');

  if (data.gap_residuel > 0.01) {
    console.log('  ⚠️ Gap résiduel:', data.gap_residuel, '€');
  }

  console.log('\n📋 Opérations effectuées:', data.operations_performed?.length);
  for (const op of (data.operations_performed || []).slice(0, 10)) {
    console.log(`  ${op.step}: ${op.type}`);
    if (op.details.amount) console.log(`      Montant: ${op.details.amount}€`);
  }

  if (data.operations_performed?.length > 10) {
    console.log(`  ... et ${data.operations_performed.length - 10} autres opérations`);
  }
})();
```

### Étape 3: Récupérer les données Step 2

```javascript
// Récupérer les données pour l'étape 2 (récapitulatif)
(async () => {
  console.log('📊 DONNÉES STEP 2');

  const response = await fetch('/api/monthly-recap/step2-data?context=profile');
  const data = await response.json();

  console.log('💰 État post-rééquilibrage:');
  console.log('  RAV actuel:', data.current_remaining_to_live, '€');
  console.log('  Tirelire:', data.piggy_bank, '€');
  console.log('  Économies totales:', data.total_cumulated_savings, '€');

  console.log('\n📋 Budgets finaux:');
  for (const budget of (data.budgets || []).slice(0, 5)) {
    console.log(`  ${budget.name}:`);
    console.log(`    Estimé: ${budget.estimated_amount}€, Dépensé: ${budget.spent_amount}€`);
    console.log(`    Économies: ${budget.cumulated_savings}€`);
  }
})();
```

### Étape 4: Finaliser le monthly recap

```javascript
// Finaliser le monthly recap
(async () => {
  console.log('🏁 FINALISATION MONTHLY RECAP');

  // Utiliser les valeurs sauvegardées ou des valeurs par défaut
  const sessionId = window.monthlyRecapSession || 'manual_test_session';
  const finalAmount = window.monthlyRecapRAV || 0;

  const response = await fetch('/api/monthly-recap/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: 'profile',
      session_id: sessionId,
      remaining_to_live_choice: {
        action: 'carry_forward', // ou 'deduct_from_budget'
        final_amount: finalAmount
      }
    })
  });

  const data = await response.json();

  if (!data.success) {
    console.error('❌ Erreur:', data.error);
    return;
  }

  console.log('✅ Monthly Recap FINALISÉ!');
  console.log('  Recap ID:', data.summary?.recap_id);
  console.log('  RAV initial:', data.summary?.initial_remaining_to_live, '€');
  console.log('  RAV final:', data.summary?.final_remaining_to_live, '€');
  console.log('  Action:', data.summary?.action_taken);
  console.log('  Surplus total:', data.summary?.total_surplus, '€');
  console.log('  Déficit total:', data.summary?.total_deficit, '€');
  console.log('  Redirect dashboard:', data.redirect_to_dashboard);

  console.log('\n🎉 Terminé! Le dashboard reflète maintenant le nouvel état.');
})();
```

---

## Tests Automatisés Complets

### Test automatique CAS 1 (Excédent)

```javascript
// TEST AUTOMATIQUE CAS 1: RAV Positif
(async () => {
  console.log('🧪 TEST AUTOMATIQUE CAS 1: RAV POSITIF');
  console.log('=====================================');

  // 1. Peupler les données
  console.log('\n1️⃣ Peuplement des données...');
  await fetch('/api/debug/populate-positive-rav-savings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  // 2. Configurer tirelire
  console.log('2️⃣ Configuration tirelire (100€)...');
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_piggy_bank', amount: 100, context: 'profile' })
  });

  // 3. Vérifier état initial
  console.log('3️⃣ État initial...');
  const initRes = await fetch('/api/debug/remaining-to-live');
  const initData = await initRes.json();
  console.log('  RAV initial:', initData.remaining_to_live, '€');
  console.log('  RAV budgétaire:', initData.rav_budgetaire, '€');
  console.log('  Tirelire:', initData.piggy_bank, '€');

  // 4. Initialiser le recap
  console.log('\n4️⃣ Initialisation...');
  const initRecapRes = await fetch('/api/monthly-recap/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'profile' })
  });
  const initRecap = await initRecapRes.json();
  console.log('  Session:', initRecap.session_id);

  // 5. Process Step 1
  console.log('\n5️⃣ Rééquilibrage...');
  const processRes = await fetch('/api/monthly-recap/process-step1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'profile' })
  });
  const processData = await processRes.json();
  console.log('  Cas:', processData.case);
  console.log('  RAV final:', processData.final_rav, '€');
  console.log('  Tirelire finale:', processData.piggy_bank_final, '€');
  console.log('  Opérations:', processData.operations_performed?.length);

  // 6. Vérifier résultats
  console.log('\n6️⃣ Vérification...');
  const finalRes = await fetch('/api/debug/remaining-to-live');
  const finalData = await finalRes.json();

  console.log('\n=====================================');
  console.log('📊 RÉSULTATS:');
  console.log('  Cas détecté:', processData.case === 'excedent' ? '✅ EXCÉDENT (attendu)' : '❌ DÉFICIT (inattendu)');
  console.log('  Tirelire:', initData.piggy_bank, '→', finalData.piggy_bank, '€');
  console.log('  (devrait avoir augmenté de l\'excédent)');

  if (processData.case === 'excedent') {
    console.log('\n✅ TEST CAS 1 RÉUSSI');
  } else {
    console.log('\n❌ TEST CAS 1 ÉCHOUÉ');
  }
})();
```

### Test automatique CAS 2 (Déficit)

```javascript
// TEST AUTOMATIQUE CAS 2: RAV Négatif
(async () => {
  console.log('🧪 TEST AUTOMATIQUE CAS 2: RAV NÉGATIF');
  console.log('=====================================');

  // 1. Peupler les données
  console.log('\n1️⃣ Peuplement des données...');
  await fetch('/api/debug/populate-negative-rav', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  // 2. Configurer tirelire modeste
  console.log('2️⃣ Configuration tirelire (200€)...');
  await fetch('/api/savings/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_piggy_bank', amount: 200, context: 'profile' })
  });

  // 3. Vérifier état initial
  console.log('3️⃣ État initial...');
  const initRes = await fetch('/api/debug/remaining-to-live');
  const initData = await initRes.json();
  console.log('  RAV initial:', initData.remaining_to_live, '€');
  console.log('  RAV budgétaire:', initData.rav_budgetaire, '€');
  console.log('  Gap:', initData.remaining_to_live - initData.rav_budgetaire, '€');
  console.log('  Tirelire:', initData.piggy_bank, '€');

  // 4. Initialiser le recap
  console.log('\n4️⃣ Initialisation...');
  const initRecapRes = await fetch('/api/monthly-recap/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'profile' })
  });
  const initRecap = await initRecapRes.json();
  console.log('  Session:', initRecap.session_id);

  // 5. Process Step 1
  console.log('\n5️⃣ Rééquilibrage...');
  const processRes = await fetch('/api/monthly-recap/process-step1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'profile' })
  });
  const processData = await processRes.json();
  console.log('  Cas:', processData.case);
  console.log('  RAV final:', processData.final_rav, '€');
  console.log('  Tirelire finale:', processData.piggy_bank_final, '€');
  console.log('  Gap résiduel:', processData.gap_residuel, '€');
  console.log('  Opérations:', processData.operations_performed?.length);

  // 6. Analyser les opérations
  console.log('\n📋 Opérations effectuées:');
  const opTypes = {};
  for (const op of processData.operations_performed || []) {
    opTypes[op.type] = (opTypes[op.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(opTypes)) {
    console.log(`  ${type}: ${count}x`);
  }

  console.log('\n=====================================');
  console.log('📊 RÉSULTATS:');
  console.log('  Cas détecté:', processData.case === 'deficit' ? '✅ DÉFICIT (attendu)' : '❌ EXCÉDENT (inattendu)');
  console.log('  Tirelire utilisée:', initData.piggy_bank - processData.piggy_bank_final, '€');
  console.log('  Équilibre atteint:', processData.is_fully_balanced ? '✅' : '⚠️ Gap résiduel');

  if (processData.case === 'deficit') {
    console.log('\n✅ TEST CAS 2 RÉUSSI');
  } else {
    console.log('\n❌ TEST CAS 2 ÉCHOUÉ');
  }
})();
```

---

## Rappel des Règles (Spécification)

### CAS 1: Différence ≥ 0 (Excédent ou Équilibre)
| Étape | Action | Détail |
|-------|--------|--------|
| 1.1 | Surplus → Économies | Pour chaque budget avec surplus > 0 |
| 1.2 | Excédent → Tirelire | Différence_RAV va à la tirelire |
| 1.3 | Identifier déficits | Lister budgets avec dépenses > estimé |
| 1.4.1 | Tirelire → Déficits | Renflouer depuis tirelire d'abord |
| 1.4.2 | Économies → Déficits | Puis économies proportionnellement |

### CAS 2: Différence < 0 (Déficit)
| Étape | Action | Détail |
|-------|--------|--------|
| 2.1 | Surplus → Économies | Pour chaque budget avec surplus > 0 |
| 2.2 | Utiliser Tirelire | Combler le gap avec la tirelire |
| 2.3 | Utiliser Économies | Proportionnellement au montant |
| 2.4 | Prélever Budgets | Proportionnellement au disponible |
| 2.5 | Post-équilibre | Gérer les surplus restants |

### Invariants à Vérifier
1. **Conservation**: Total_Actif_Avant = Total_Actif_Après
2. **Équilibre**: RAV_Final ≥ RAV_Budgétaire (ou avertissement)
3. **Cohérence**: Affichage = Base de données

---

## Notes Importantes

- **Chaque test modifie les données** en base → utiliser sur environnement de dev
- **Les endpoints `populate-*`** suppriment automatiquement les monthly_recaps existants
- **Après chaque test**, le monthly recap est considéré comme fait pour ce mois
- **Pour relancer un test**, il faut repeupler les données (ce qui reset le recap)
- **Vérifier les logs serveur** pour le détail des opérations
