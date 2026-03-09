# Tests Monthly Recap - RAV Budgétaire Toujours Positif

Tous les scénarios garantissent que `RAV budgétaire = revenus_estimés - budgets_estimés ≥ 0`.

**One-liner de reset universel** (à coller avant chaque test) :
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>console.log('🔄 Reset:',d.message||d))
```

---

## Table des Matières

1. [CAS A: Équilibre Précaire](#cas-a-équilibre-précaire)
2. [CAS B: Petit Surplus — Bonne Gestion](#cas-b-petit-surplus--bonne-gestion)
3. [CAS C: Gros Surplus + Tirelire Vide](#cas-c-gros-surplus--tirelire-vide)
4. [CAS D: RAV Budgétaire Positif mais Dépenses Réelles Excessives](#cas-d-rav-budgétaire-positif-mais-dépenses-réelles-excessives)
5. [CAS E: Prime / Revenu Exceptionnel](#cas-e-prime--revenu-exceptionnel)
6. [CAS F: Économies Massives sur Budgets Fixes](#cas-f-économies-massives-sur-budgets-fixes)
7. [CAS G: Mix Surplus + Déficits Individuels, Excédent Global](#cas-g-mix-surplus--déficits-individuels-excédent-global)
8. [CAS H: Tirelire Très Remplie + Petit Surplus](#cas-h-tirelire-très-remplie--petit-surplus)
9. [CAS I: Beaucoup de Petits Budgets Tous en Surplus](#cas-i-beaucoup-de-petits-budgets-tous-en-surplus)
10. [CAS J: Équilibre Précaire avec Tirelire](#cas-j-équilibre-précaire-avec-tirelire)

---

## CAS A: Équilibre Précaire

**Scénario** : Revenus légèrement supérieurs aux budgets, marges très faibles.
- RAV budgétaire > 0€ mais faible
- RAV actuel légèrement positif
- Situation stable mais fragile

**Attendu** : Peu de transferts, excédent minime → Tirelire.

### Reset + Peuplement (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-balanced-risky',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(d=>console.log('⚖️ CAS A prêt | RAV budgétaire:',d.financial_impact?.budgetaryRAV,'€ | RAV actuel:',d.financial_impact?.currentRAV,'€'))
```

### Vérification
```javascript
fetch('/api/debug/remaining-to-live').then(r=>r.json()).then(d=>console.log('⚖️ RAV actuel:',d.remaining_to_live,'€ | RAV budgétaire:',d.rav_budgetaire,'€ | Surplus total:',d.total_surplus,'€ | Déficit total:',d.total_deficit,'€'))
```

---

## CAS B: Petit Surplus — Bonne Gestion

**Scénario** : Revenus légèrement supérieurs aux budgets, quelques budgets en sous-dépense.
- RAV budgétaire ≈ +150€
- RAV actuel ≈ +350€ (mieux que prévu)
- 3-4 budgets avec petit surplus (20-80€ chacun)

**Attendu** : Surplus → Économies, excédent modéré → Tirelire.

### Reset + Peuplement (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-positive-rav-savings',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(d=>console.log('🟢 CAS B prêt | RAV budgétaire:',d.financial_impact?.estimatedRAV,'€ | Économies:',d.financial_impact?.totalSavings,'€'))
```

### Configurer tirelire initiale (one-liner)
```javascript
fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:50,context:'profile'})}).then(r=>r.json()).then(()=>console.log('🐷 Tirelire: 50€'))
```

---

## CAS C: Gros Surplus + Tirelire Vide

**Scénario** : Revenus bien supérieurs aux budgets, tirelire à zéro.
- RAV budgétaire ≈ +400€
- RAV actuel ≈ +700€
- Plusieurs budgets avec gros surplus (100-300€)
- Tirelire = 0€

**Attendu** : Surplus → Économies, gros excédent → Tirelire (qui part de 0).

### Reset + Peuplement + Tirelire vide (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-massive-savings',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(async d=>{await fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:0,context:'profile'})});console.log('💚 CAS C prêt | Total économies:',d.statistics?.totals?.savings,'€ | Taux:',d.statistics?.totals?.savingsPercent)})
```

---

## CAS D: RAV Budgétaire Positif mais Dépenses Réelles Excessives

**Scénario** : Le budget était bien prévu (RAV budgétaire +200€), mais les dépenses réelles ont dépassé les estimations.
- RAV budgétaire = +200€ ✅ (jamais négatif)
- RAV actuel = -150€ (on a mal exécuté le mois)
- Plusieurs budgets en déficit individuel
- Tirelire modeste (300€) pour compenser

**Attendu** : CAS DÉFICIT → Tirelire utilisée pour combler l'écart.

### Reset + Peuplement (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-negative-savings-only',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(async d=>{await fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:300,context:'profile'})});console.log('🟡 CAS D prêt | RAV actuel:',d.financial_impact?.currentRAV,'€ | Tirelire: 300€')})
```

### Vérification avant recap
```javascript
fetch('/api/debug/financial').then(r=>r.json()).then(d=>console.log('📊 RAV budgétaire:',(d.totalEstimatedIncome-d.totalEstimatedBudget),'€ | RAV actuel:',d.remainingToLive,'€ | Écart:',(d.remainingToLive-(d.totalEstimatedIncome-d.totalEstimatedBudget)),'€'))
```

---

## CAS E: Prime / Revenu Exceptionnel

**Scénario** : Revenu habituel + prime exceptionnelle ce mois-ci.
- RAV budgétaire = +600€ (prime incluse dans les revenus estimés)
- RAV actuel = +800€ (encore mieux — prime + économies)
- Budgets normaux mais revenus gonflés

**Attendu** : Excédent important → Tirelire, surplus habituels → Économies.

### Reset + Peuplement (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-high-income-savings',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(d=>console.log('💸 CAS E prêt | Revenus:',d.statistics?.totals?.income,'€ | Budgets:',d.statistics?.totals?.estimated,'€ | RAV:',d.statistics?.totals?.remainingToLive,'€'))
```

### Configurer tirelire initiale (one-liner)
```javascript
fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:200,context:'profile'})}).then(r=>r.json()).then(()=>console.log('🐷 Tirelire: 200€'))
```

---

## CAS F: Économies Massives sur Budgets Fixes

**Scénario** : Budgets bien définis depuis plusieurs mois, économies importantes accumulées.
- RAV budgétaire = +300€
- RAV actuel ≈ +300€ (exécution conforme au budget)
- Économies cumulées importantes sur presque tous les budgets (héritage des mois précédents)
- Aucun budget en déficit individuel

**Attendu** : Pas de prélèvement dans les économies, excédent → Tirelire.

### Reset + Peuplement (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-massive-savings',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(async d=>{await fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:100,context:'profile'})});console.log('💎 CAS F prêt | Économies:',d.statistics?.totals?.savings,'€ | Tirelire: 100€')})
```

---

## CAS G: Mix Surplus + Déficits Individuels, Excédent Global

**Scénario** : Globalement en excédent, mais certains budgets ont dépassé leur enveloppe.
- RAV budgétaire = +250€
- RAV actuel = +400€ (excédent global)
- 2 budgets en déficit individuel (restaurants, loisirs dépassés)
- 4 budgets en surplus (courses, transport, etc.)

**Attendu** : Surplus → Économies, excédent → Tirelire, puis Tirelire → Budgets déficitaires.

### Reset + Peuplement + Tirelire (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-balanced-risky',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(async d=>{await fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:400,context:'profile'})});console.log('🟢🔴 CAS G prêt | Surplus:',d.statistics?.budgetsByStatus?.surplus?.length,'budgets | Déficits:',d.statistics?.budgetsByStatus?.deficit?.length,'budgets')})
```

---

## CAS H: Tirelire Très Remplie + Petit Surplus

**Scénario** : Tirelire bien garnie (mois précédents vertueux), petit surplus ce mois.
- RAV budgétaire = +100€
- RAV actuel = +200€
- Tirelire existante = 1500€
- Quelques petits surplus seulement

**Attendu** : Surplus → Économies, petit excédent s'ajoute à la grosse tirelire.

### Reset + Peuplement + Grosse tirelire (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-positive-rav-savings',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(async d=>{await fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:1500,context:'profile'})});console.log('🐷 CAS H prêt | RAV budgétaire:',d.financial_impact?.estimatedRAV,'€ | Tirelire: 1500€')})
```

### Vérifier la tirelire (one-liner)
```javascript
fetch('/api/debug/remaining-to-live').then(r=>r.json()).then(d=>console.log('🐷 Tirelire:',d.piggy_bank,'€ | RAV budgétaire:',d.rav_budgetaire,'€'))
```

---

## CAS I: Beaucoup de Petits Budgets Tous en Surplus

**Scénario** : Nombreuses catégories de budget, toutes légèrement sous-dépensées.
- RAV budgétaire = +200€
- RAV actuel = +500€ (sous-dépense généralisée)
- 8+ budgets avec surplus de 20-60€ chacun
- Total surplus distribué = ~300€ vers économies

**Attendu** : Chaque surplus transféré individuellement vers économies, excédent global → Tirelire.

### Reset + Peuplement (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-massive-savings',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(async d=>{await fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:0,context:'profile'})});console.log('💚 CAS I prêt | Budgets:',d.statistics?.budgetCount,'| Taux économie:',d.statistics?.totals?.savingsPercent)})
```

### Voir tous les surplus (one-liner)
```javascript
fetch('/api/debug/remaining-to-live').then(r=>r.json()).then(d=>{(d.budgets||[]).filter(b=>b.surplus>0).forEach(b=>console.log('🟢',b.name,'+'+b.surplus+'€'));console.log('Total:',d.total_surplus,'€')})
```

---

## CAS J: Équilibre Précaire avec Tirelire

**Scénario** : Même scénario que CAS A mais avec une tirelire déjà constituée.
- RAV budgétaire > 0€ mais faible
- Tirelire existante = 300€
- Les déficits individuels éventuels sont couverts par la tirelire

**Attendu** : Tirelire absorbe les déficits individuels, excédent s'y ajoute.

### Reset + Peuplement (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(()=>fetch('/api/debug/populate-balanced-risky',{method:'POST',headers:{'Content-Type':'application/json'}})).then(r=>r.json()).then(async d=>{await fetch('/api/savings/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_piggy_bank',amount:300,context:'profile'})});console.log('⚖️ CAS J prêt | RAV budgétaire:',d.financial_impact?.budgetaryRAV,'€ | Tirelire: 300€')})
```

### Vérification complète (one-liner)
```javascript
fetch('/api/debug/financial').then(r=>r.json()).then(d=>{const ravBudg=d.totalEstimatedIncome-d.totalEstimatedBudget;const diff=d.remainingToLive-ravBudg;console.log('⚖️ RAV budgétaire:',ravBudg,'€ | RAV actuel:',d.remainingToLive,'€ | Différence:',diff,'€',diff===0?'✅ PARFAIT':'⚠️')})
```

---

## Utilitaires Rapides

### Reset complet (one-liner)
```javascript
fetch('/api/debug/reset-all',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>console.log('🔄',d.message||'Reset OK'))
```

### Snapshot rapide de l'état financier (one-liner)
```javascript
fetch('/api/debug/financial').then(r=>r.json()).then(d=>console.log('💰 Solde:',d.bankBalance,'€ | Revenus:',d.totalEstimatedIncome,'€ | Budgets:',d.totalEstimatedBudget,'€ | RAV budg:',(d.totalEstimatedIncome-d.totalEstimatedBudget),'€ | RAV actuel:',d.remainingToLive,'€'))
```

### Voir les budgets en un coup d'œil (one-liner)
```javascript
fetch('/api/debug/remaining-to-live').then(r=>r.json()).then(d=>{(d.budgets||[]).forEach(b=>console.log((b.surplus>0?'🟢':b.deficit>0?'🔴':'⚪'),b.name,'| estimé:'+b.estimated_amount+'€ | dépensé:'+b.spent_amount+'€ | surplus:'+b.surplus+'€ | déficit:'+b.deficit+'€'));console.log('---','Tirelire:',d.piggy_bank||0,'€ | Économies:',d.cumulated_savings||0,'€')})
```

### Lancer le recap complet (one-liner)
```javascript
fetch('/api/monthly-recap/process-step1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:'profile'})}).then(r=>r.json()).then(d=>console.log(d.success?'✅':'❌','Cas:',d.case,'| RAV final:',d.final_rav,'€ | Tirelire finale:',d.piggy_bank_final,'€ | Gap résiduel:',d.gap_residuel||0,'€'))
```

### Vérifier que RAV budgétaire >= 0 (assertion one-liner)
```javascript
fetch('/api/debug/financial').then(r=>r.json()).then(d=>{const ravBudg=d.totalEstimatedIncome-d.totalEstimatedBudget;console.log(ravBudg>=0?'✅ RAV budgétaire OK:':'❌ RAV budgétaire NÉGATIF:',ravBudg,'€')})
```

---

## Matrice des Scénarios

| Cas | RAV budgétaire | RAV actuel | Tirelire | Surplus individuel | Déficit individuel |
|-----|---------------|-----------|----------|-------------------|-------------------|
| A   | 0€            | 0€        | 0€       | Aucun             | Aucun             |
| B   | +150€         | +350€     | 50€      | Quelques petits   | Aucun             |
| C   | +400€         | +700€     | 0€       | Nombreux gros     | Aucun             |
| D   | +200€         | -150€     | 300€     | Quelques-uns      | Plusieurs         |
| E   | +600€         | +800€     | 200€     | Quelques-uns      | Aucun             |
| F   | +300€         | +300€     | 100€     | Aucun             | Aucun             |
| G   | +250€         | +400€     | 400€     | Plusieurs         | 2 budgets         |
| H   | +100€         | +200€     | 1500€    | Quelques petits   | Aucun             |
| I   | +200€         | +500€     | 0€       | Nombreux petits   | Aucun             |
| J   | +300€         | +300€     | 300€     | Aucun             | Aucun             |

**Invariant garanti** : RAV budgétaire ≥ 0 dans tous les scénarios.
