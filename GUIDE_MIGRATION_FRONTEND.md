# Guide de Migration du Frontend

## 🎯 Objectif
Remplacer les appels aux anciennes API par la nouvelle API `/process-step1` dans le composant React.

---

## 📂 Fichiers à Modifier

### 1. ✅ `components/monthly-recap/MonthlyRecapFlow.tsx`

**Fichier concerné**: [components/monthly-recap/MonthlyRecapFlow.tsx](components/monthly-recap/MonthlyRecapFlow.tsx)

---

## 🔧 Changements à Appliquer

### Changement 1: Fonction `handleStep1Next` (lignes 77-115)

**AVANT** (ANCIEN CODE):
```typescript
const handleStep1Next = async () => {
  try {
    // Avant de passer à l'étape 2, récupérer le surplus de l'étape 1
    // et l'accumuler dans la tirelire
    const response = await fetch(`/api/monthly-recap/step1-data?context=${context}`)
    const step1Data = await response.json()

    if (response.ok && step1Data.surplus_for_next_step > 0) {
      console.log(`🐷 [Frontend] Accumulation de ${step1Data.surplus_for_next_step}€ dans la tirelire`)

      // Appeler l'API pour accumuler le surplus dans la tirelire
      const accumulateResponse = await fetch('/api/monthly-recap/accumulate-piggy-bank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context,
          amount: step1Data.surplus_for_next_step
        })
      })

      const accumulateData = await accumulateResponse.json()

      if (accumulateResponse.ok) {
        console.log(`✅ [Frontend] Tirelire mise à jour: ${accumulateData.old_amount}€ → ${accumulateData.new_amount}€`)
      } else {
        console.error('❌ [Frontend] Erreur lors de l\'accumulation:', accumulateData.error)
      }
    }

    // La navigation est maintenant simple car les données sont récupérées live à chaque étape
    goToNextStep()
  } catch (error) {
    console.error('❌ [Frontend] Erreur lors de la validation de l\'étape 1:', error)
    // On continue quand même vers l'étape 2 même en cas d'erreur
    goToNextStep()
  }
}
```

**APRÈS** (NOUVEAU CODE):
```typescript
const handleStep1Next = async () => {
  try {
    console.log(``)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(`🎯🎯🎯 [FRONTEND] EXÉCUTION PROCESS STEP 1`)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(`🎯 Contexte: ${context}`)
    console.log(`🎯🎯🎯 ========================================================`)
    console.log(``)

    // ✅ NOUVEAU: Appel à l'API process-step1 qui gère TOUT
    const processResponse = await fetch('/api/monthly-recap/process-step1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ context })
    })

    const processData = await processResponse.json()

    if (processResponse.ok && processData.success) {
      console.log(`✅ [Frontend] Process Step 1 réussi`)
      console.log(`   📊 Cas: ${processData.case}`)
      console.log(`   💰 RAV initial: ${processData.initial_rav}€`)
      console.log(`   💰 RAV final: ${processData.final_rav}€`)
      console.log(`   💰 RAV budgétaire: ${processData.budgetary_rav}€`)
      console.log(`   🐷 Tirelire finale: ${processData.piggy_bank_final}€`)
      console.log(`   📋 Opérations effectuées: ${processData.operations_performed.length}`)

      // Si cas déficit et pas complètement équilibré
      if (processData.case === 'deficit' && !processData.is_fully_balanced) {
        console.warn(`⚠️ [Frontend] Équilibrage partiel - Gap résiduel: ${processData.gap_residuel}€`)
        // Optionnel: Afficher un toast/alert à l'utilisateur
        // alert(`Attention: Un gap de ${processData.gap_residuel}€ subsiste. Réduisez vos budgets ou augmentez vos revenus.`)
      }

      // Log détaillé des opérations pour debug
      console.log(``)
      console.log(`📋 Détail des opérations:`)
      processData.operations_performed.forEach((op, index) => {
        console.log(`   ${index + 1}. [${op.step}] ${op.type}:`, op.details)
      })
      console.log(``)

      // Navigation vers Step 2
      goToNextStep()
    } else {
      console.error('❌ [Frontend] Erreur lors du process step 1:', processData.error)

      // Optionnel: Afficher l'erreur à l'utilisateur
      // alert(`Erreur: ${processData.error}`)

      // Décider si on bloque ou on continue vers Step 2
      // Option 1: Bloquer (recommandé)
      throw new Error(processData.error)

      // Option 2: Continuer quand même (déconseillé)
      // goToNextStep()
    }
  } catch (error) {
    console.error('❌ [Frontend] Erreur lors de la validation de l\'étape 1:', error)

    // Afficher l'erreur à l'utilisateur
    alert(`Erreur lors du rééquilibrage: ${error.message}`)

    // NE PAS continuer vers l'étape 2 en cas d'erreur
    // goToNextStep() // ❌ À SUPPRIMER
  }
}
```

**Explications des changements**:
1. ❌ Supprime l'appel à `/step1-data` (pas nécessaire car `/process-step1` fait tout)
2. ❌ Supprime l'appel à `/accumulate-piggy-bank` (déjà fait dans `/process-step1`)
3. ✅ Remplace par UN SEUL appel à `/process-step1`
4. ✅ Gère le cas déficit avec gap résiduel
5. ✅ Logs détaillés pour debug
6. ✅ Meilleure gestion d'erreurs (ne continue pas vers Step 2 en cas d'erreur)

---

### Changement 2: Hook `useMonthlyRecap` (OPTIONNEL)

**Fichier concerné**: [hooks/useMonthlyRecap.ts](hooks/useMonthlyRecap.ts)

**Action**: Vérifier si la fonction `balanceRemainingToLive` existe et est encore utilisée ailleurs.

**Si elle n'est plus utilisée**:
- ❌ Supprimer la fonction `balanceRemainingToLive` du hook
- ❌ Supprimer son export

**Si elle est encore utilisée dans `MonthlyRecapStep1.tsx`**:
- ⚠️ La remplacer par un appel à `/process-step1`

---

### Changement 3: Vérifier `MonthlyRecapStep1.tsx` (IMPORTANT)

**Fichier concerné**: [components/monthly-recap/MonthlyRecapStep1.tsx](components/monthly-recap/MonthlyRecapStep1.tsx)

**Action**: Vérifier si le composant Step1 appelle directement `onBalanceRemainingToLive`

**Si OUI**:
```typescript
// AVANT
<button onClick={onBalanceRemainingToLive}>
  Équilibrer
</button>

// APRÈS
// Option 1: Supprimer le bouton (rééquilibrage automatique au Next)
// Option 2: Appeler /process-step1 directement
<button onClick={async () => {
  const response = await fetch('/api/monthly-recap/process-step1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context })
  })
  const result = await response.json()
  // Refresh l'UI avec les nouvelles données
  // ... refetch step1-data
}}>
  Équilibrer
</button>
```

**Recommandation**: Option 1 (supprimer le bouton) car le rééquilibrage se fait automatiquement au passage à Step 2.

---

## 📋 CHECKLIST COMPLÈTE

### Phase 1: Modification du Code
- [ ] Ouvrir [components/monthly-recap/MonthlyRecapFlow.tsx](components/monthly-recap/MonthlyRecapFlow.tsx)
- [ ] Remplacer la fonction `handleStep1Next` (lignes 77-115)
- [ ] Copier le **NOUVEAU CODE** depuis ce guide
- [ ] Sauvegarder le fichier

### Phase 2: Vérifications
- [ ] Vérifier [hooks/useMonthlyRecap.ts](hooks/useMonthlyRecap.ts)
  - [ ] `balanceRemainingToLive` est-elle encore utilisée ?
  - [ ] Si non, la supprimer du hook
- [ ] Vérifier [components/monthly-recap/MonthlyRecapStep1.tsx](components/monthly-recap/MonthlyRecapStep1.tsx)
  - [ ] Y a-t-il un bouton "Équilibrer" ?
  - [ ] Si oui, décider de le supprimer ou le modifier
- [ ] Compiler le projet TypeScript
  ```bash
  npm run typecheck
  ```
- [ ] Vérifier qu'il n'y a pas d'erreurs de compilation

### Phase 3: Tests
- [ ] Lancer le serveur de développement
  ```bash
  npm run dev
  ```
- [ ] Tester le flow complet:
  - [ ] Aller sur la page Monthly Recap
  - [ ] Vérifier Step 1 s'affiche correctement
  - [ ] Cliquer "Suivant" (devrait appeler `/process-step1`)
  - [ ] Vérifier les logs dans la console navigateur
  - [ ] Vérifier les logs dans la console serveur
  - [ ] Vérifier que Step 2 s'affiche correctement
  - [ ] Compléter le recap
- [ ] Vérifier la BDD:
  - [ ] Économies mises à jour correctement
  - [ ] Tirelire mise à jour correctement
  - [ ] Pas de double comptabilisation
- [ ] Tester les cas d'erreur:
  - [ ] Simuler une erreur serveur (couper le serveur)
  - [ ] Vérifier que l'erreur s'affiche correctement
  - [ ] Vérifier qu'on ne passe PAS à Step 2

### Phase 4: Validation
- [ ] Relire [SYNTHESE_CORRECTIONS_APPLIQUEES.md](SYNTHESE_CORRECTIONS_APPLIQUEES.md)
- [ ] Exécuter les tests de [FINAL_STATUS_AND_TESTS.md](FINAL_STATUS_AND_TESTS.md)
- [ ] Valider la conservation de la masse monétaire

---

## 🧪 Comment Tester en Développement

### Test Console Navigateur

Après avoir cliqué "Suivant" sur Step 1, vous devriez voir dans la console:

```
🎯🎯🎯 ========================================================
🎯🎯🎯 [FRONTEND] EXÉCUTION PROCESS STEP 1
🎯🎯🎯 ========================================================
🎯 Contexte: profile
🎯🎯🎯 ========================================================

✅ [Frontend] Process Step 1 réussi
   📊 Cas: excedent
   💰 RAV initial: 1600€
   💰 RAV final: 1600€
   💰 RAV budgétaire: 1500€
   🐷 Tirelire finale: 200€
   📋 Opérations effectuées: 3

📋 Détail des opérations:
   1. [1.1] surplus_to_savings: {...}
   2. [1.1] surplus_to_savings: {...}
   3. [1.2] excedent_to_piggy_bank: {...}
```

### Test Console Serveur

Côté serveur, vous devriez voir les logs détaillés de `/process-step1`:

```
🎯🎯🎯 ========================================================
🎯🎯🎯 PROCESS STEP 1 - ALGORITHME DE RÉÉQUILIBRAGE
🎯🎯🎯 ========================================================
🎯 CONTEXTE: PROFILE
🎯 ID: xxx-xxx-xxx
🎯 USER: John Doe
🎯 TIMESTAMP: 2025-12-02T10:30:00.000Z
🎯🎯🎯 ========================================================

💰 RAV ACTUEL: 1600€
💰 RAV BUDGÉTAIRE (CIBLE): 1500€
📊 DIFFÉRENCE: +100€

✅ CAS 1: EXCÉDENT OU ÉQUILIBRE (Différence ≥ 0)

🔄 ÉTAPE 1.1: Transfert des surplus vers économies
   ✅ Alimentation: 50€ transférés → Économies: 0€ → 50€
   ✅ Transport: 20€ transférés → Économies: 0€ → 20€

🔄 ÉTAPE 1.2: Transfert de l'excédent vers la tirelire
   ✅ Tirelire: 100€ + 100€ = 200€

✅ Aucun budget déficitaire à renflouer

🎯🎯🎯 ========================================================
🎯🎯🎯 RÉSULTAT FINAL - CAS 1 (EXCÉDENT)
🎯🎯🎯 ========================================================
💰 RAV INITIAL: 1600€
💰 RAV FINAL: 1600€
💰 RAV BUDGÉTAIRE: 1500€
🐷 TIRELIRE FINALE: 200€
📊 OPÉRATIONS EFFECTUÉES: 3
🎯🎯🎯 ========================================================
```

---

## ❓ FAQ Migration

### Q: Dois-je modifier `step1-data` ?
**R**: NON. L'API `/step1-data` reste inchangée et est toujours utilisée pour l'affichage initial de Step 1. Elle n'est plus appelée dans `handleStep1Next` car `/process-step1` fait tout.

### Q: Puis-je garder l'ancienne implémentation en parallèle ?
**R**: Oui, temporairement. Vous pouvez créer une feature flag:
```typescript
const USE_NEW_ALGORITHM = true // ou false pour revenir à l'ancien

const handleStep1Next = async () => {
  if (USE_NEW_ALGORITHM) {
    // Nouveau code
  } else {
    // Ancien code
  }
}
```

### Q: Que faire si `/process-step1` échoue ?
**R**: Le code mis à jour ne continue PAS vers Step 2 en cas d'erreur (contrairement à l'ancien code). C'est voulu pour garantir l'intégrité des données.

### Q: Comment déboguer si ça ne marche pas ?
**R**:
1. Vérifier la console navigateur (erreurs JS ?)
2. Vérifier la console serveur (logs détaillés)
3. Vérifier les requêtes réseau (onglet Network)
4. Vérifier la BDD directement (Supabase dashboard)

---

## ✅ Validation Finale

Après la migration, vérifier:

1. ✅ Le code compile sans erreur TypeScript
2. ✅ Step 1 → Step 2 fonctionne
3. ✅ Les logs sont visibles (navigateur + serveur)
4. ✅ La tirelire est mise à jour correctement
5. ✅ Les économies sont mises à jour correctement
6. ✅ Pas de double comptabilisation
7. ✅ Conservation de la masse monétaire

---

**FIN DU GUIDE DE MIGRATION**

*En cas de problème, référez-vous à [SYNTHESE_CORRECTIONS_APPLIQUEES.md](SYNTHESE_CORRECTIONS_APPLIQUEES.md) ou relancez une session d'analyse.*
