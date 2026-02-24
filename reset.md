# Scripts de Reset et Re-trigger Monthly Recap

Scripts à copier/coller dans la console F12.

---

## Table des Matières

1. [Reset Complet des Données](#reset-complet-des-données)
2. [Re-trigger Monthly Recap](#re-trigger-monthly-recap)
3. [Reset Partiel (par catégorie)](#reset-partiel-par-catégorie)
4. [Utilitaires](#utilitaires)

---

## Reset Complet des Données

### Reset de TOUTES les données financières (conserve user/groups)

> **Inclut maintenant:** tirelire → 0€, bank_balance → 0€, et le RAV (Reste À Vivre) sera calculé à 0€ car toutes les données financières sont supprimées.

```javascript
// RESET COMPLET - Supprime toutes les données sauf user et groups
(async () => {
  console.log('🗑️ RESET COMPLET EN COURS...');
  console.log('============================');

  const response = await fetch('/api/debug/reset-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const result = await response.json();

  if (result.success) {
    console.log('✅ RESET COMPLET RÉUSSI');
    console.log('');
    console.log('📋 Résultats par table:');
    for (const [table, status] of Object.entries(result.results)) {
      console.log(`   ${table}: ${status}`);
    }
    console.log('');
    console.log('🔒 Conservé:', result.preserved.join(', '));
    console.log('🗑️ Supprimé:', result.deleted.join(', '));
    console.log('🔄 Reset:', result.reset.join(', '));
  } else {
    console.log('⚠️ Reset partiellement réussi');
    console.log('Détails:', result);
  }

  console.log('');
  console.log('📋 Pour recréer des données, utilisez un des scripts populate-* dans test.md');
})();
```

### Reset ONE-LINER

```javascript
// Reset complet en une ligne
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>console.log(d.success?'✅ Reset complet réussi':'❌ Erreur',d));
```

---

## Re-trigger Monthly Recap

### Re-trigger SIMPLE (supprime uniquement le monthly_recap du mois en cours)

**Ne modifie PAS les données financières** (budgets, dépenses, revenus, tirelire, économies restent intacts)

```javascript
// RE-TRIGGER MONTHLY RECAP - Ne modifie PAS les données financières
(async () => {
  console.log('🔄 RE-TRIGGER MONTHLY RECAP');
  console.log('===========================');

  const response = await fetch('/api/debug/retrigger-recap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'profile' })
  });

  const result = await response.json();

  if (result.success) {
    console.log('✅', result.message);
    console.log('');
    console.log('📊 Détails:');
    console.log('   Mois/Année:', result.details.month + '/' + result.details.year);
    console.log('   Recaps supprimés:', result.details.recaps_deleted);
    console.log('');
    console.log('🔒 Données préservées:');
    for (const item of result.data_preserved) {
      console.log('   ✓', item);
    }
    console.log('');
    console.log('⏭️ Actualisez la page pour voir le Monthly Recap');
  } else {
    console.log('❌ Erreur:', result.error);
  }
})();
```

### Re-trigger pour GROUPE

```javascript
// RE-TRIGGER MONTHLY RECAP - Contexte groupe
(async () => {
  console.log('🔄 RE-TRIGGER MONTHLY RECAP (GROUPE)');

  const response = await fetch('/api/debug/retrigger-recap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: 'group' })
  });

  const result = await response.json();
  console.log(result.success ? '✅' : '❌', result.message);
  console.log('⏭️ Actualisez la page pour voir le Monthly Recap');
})();
```

### Re-trigger ONE-LINER

```javascript
// Re-trigger monthly recap en une ligne
fetch('/api/debug/retrigger-recap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:'profile'})}).then(r=>r.json()).then(d=>console.log(d.success?'✅ '+d.message:'❌ '+d.error));
```

---

## Reset Partiel (par catégorie)

### Reset des économies cumulées uniquement

```javascript
// Remettre toutes les économies cumulées à 0€
(async () => {
  console.log('💎 Reset des économies cumulées...');

  // Récupérer tous les budgets
  const budgetsRes = await fetch('/api/savings/data?context=profile');
  const budgetsData = await budgetsRes.json();
  const budgets = budgetsData.budgets || [];

  console.log('Budgets trouvés:', budgets.length);

  let count = 0;
  for (const budget of budgets) {
    if (budget.cumulated_savings > 0) {
      const updateRes = await fetch('/api/finances/budgets/estimated', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: budget.id,
          cumulated_savings: 0
        })
      });

      if (updateRes.ok) {
        console.log(`  ✅ ${budget.name}: ${budget.cumulated_savings}€ → 0€`);
        count++;
      } else {
        console.log(`  ❌ ${budget.name}: erreur`);
      }
    }
  }

  console.log(`✅ ${count} budgets remis à 0€ d'économies`);
})();
```

---

## Utilitaires

### Vérifier l'état actuel

```javascript
// Voir l'état actuel avant reset
(async () => {
  console.log('📊 ÉTAT ACTUEL');
  console.log('==============');

  // Données financières
  const finRes = await fetch('/api/debug/financial');
  const fin = await finRes.json();

  console.log('💰 Finances:');
  console.log('   Solde bancaire:', fin.bankBalance, '€');
  console.log('   Revenus estimés:', fin.totalEstimatedIncome, '€');
  console.log('   Revenus réels:', fin.totalRealIncome, '€');
  console.log('   Budgets estimés:', fin.totalEstimatedBudget, '€');
  console.log('   Dépenses réelles:', fin.totalRealExpenses, '€');
  console.log('   RAV:', fin.remainingToLive, '€');

  // Économies
  const savRes = await fetch('/api/savings/data?context=profile');
  const sav = await savRes.json();

  console.log('');
  console.log('💎 Économies:');
  console.log('   Tirelire:', sav.piggy_bank, '€');
  console.log('   Économies budgets:', sav.statistics?.budgets_savings, '€');
  console.log('   Total:', sav.statistics?.total_savings, '€');

  // Status recap
  const statusRes = await fetch('/api/monthly-recap/status?context=profile');
  const status = await statusRes.json();

  console.log('');
  console.log('📅 Monthly Recap:');
  console.log('   Required:', status.required);
  console.log('   Déjà fait:', status.hasExistingRecap);
})();
```

---

## Tableau Récapitulatif

| Script | Endpoint | Données Modifiées | Données Conservées |
|--------|----------|-------------------|-------------------|
| **Reset Complet** | `/api/debug/reset-all` | budgets, revenus, dépenses, transferts, recaps, tirelire→0, **bank_balance→0**, **RAV→0** | user, groups, profiles |
| **Re-trigger** | `/api/debug/retrigger-recap` | monthly_recaps (mois en cours) | **Tout le reste** |
| **Reset Économies** | Via PATCH | cumulated_savings → 0 | Tout le reste |

---

## Notes

- **Re-trigger** = La méthode la plus propre pour relancer le monthly recap **sans changer les données financières**
- **Reset Complet** = Repart de zéro (il faudra repeupler avec un script `populate-*` de `test.md`)
- Les endpoints `populate-*` font automatiquement un reset + création de données de test
