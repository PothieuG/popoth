# Fix du calcul du solde disponible

**Date**: 2025-09-20
**Problème**: Le solde disponible ne se mettait pas à jour lors de l'ajout/suppression de revenus et dépenses réels
**Solution**: Correction de la logique de calcul pour inclure les transactions réelles

## 🐛 Problème identifié

Le solde disponible affiché dans `FinancialIndicators` (coin haut gauche) utilisait uniquement le solde bancaire statique et n'incluait pas les revenus et dépenses réels ajoutés par l'utilisateur.

### Code problématique (avant)
```typescript
// Dans getProfileFinancialData() et getGroupFinancialData()
const availableBalance = userBankBalance  // ❌ Statique !
```

### Comportement observé
- Ajout dépense de 20€ → Solde inchangé ❌
- Ajout revenu de 20€ → Solde inchangé ❌
- Aucune mise à jour en temps réel

## ✅ Solution implémentée

### 1. Correction de la fonction calculateAvailableCash()

**Avant:**
```typescript
export function calculateAvailableCash(realIncomes: number, realExpenses: number): number {
  return realIncomes - realExpenses
}
```

**Maintenant:**
```typescript
export function calculateAvailableCash(bankBalance: number, realIncomes: number, realExpenses: number): number {
  const result = bankBalance + realIncomes - realExpenses
  console.log('💰 [calculateAvailableCash] Calcul du solde disponible:', {
    bankBalance,
    realIncomes,
    realExpenses,
    result
  })
  return result
}
```

### 2. Mise à jour des calculs financiers

**Pour les profils:**
```typescript
console.log('📊 [getProfileFinancialData] Calcul du solde disponible pour le profil:', profileId)
const availableBalance = calculateAvailableCash(userBankBalance, totalRealIncome, totalRealExpenses)
```

**Pour les groupes:**
```typescript
console.log('📊 [getGroupFinancialData] Calcul du solde disponible pour le groupe:', groupId)
const availableBalance = calculateAvailableCash(totalGroupBankBalance, totalRealIncome, totalRealExpenses)
```

### 3. Documentation ajoutée

Ajout de documentation détaillée dans la fonction `calculateAvailableCash()` expliquant:
- La formule de calcul
- Les composants du solde disponible
- Le comportement attendu

## 🔧 Formule finale

```
Solde Disponible = Solde Bancaire Base + Revenus Réels - Dépenses Réelles
```

## 📊 Logs ajoutés

- Log détaillé dans `calculateAvailableCash()` avec tous les paramètres
- Log d'entrée dans `getProfileFinancialData()` et `getGroupFinancialData()`
- Log complet des calculs financiers avec tous les montants

## ✅ Résultat attendu

Maintenant, quand l'utilisateur:
1. **Ajoute une dépense de 20€** → Solde diminue de 20€
2. **Ajoute un revenu de 20€** → Solde augmente de 20€
3. **Supprime une transaction** → Solde se recalcule automatiquement

Le tout avec refresh automatique grâce au système de notifications globales implémenté précédemment.

## 🧪 Test recommandé

1. Partir d'un solde bancaire de base = 0€
2. Ajouter revenu de 100€ → Solde = 100€
3. Ajouter dépense de 30€ → Solde = 70€
4. Ajouter dépense de 80€ → Solde = -10€ (négatif OK)
5. Supprimer la dépense de 80€ → Solde = 70€

## 📁 Fichiers modifiés

- `lib/financial-calculations.ts` - Fonction calculateAvailableCash + calculs principaux
- `hooks/useFinancialData.ts` - Système de refresh automatique (session précédente)
- `hooks/useRealExpenses.ts` - Utilisation du nouveau système de refresh
- `hooks/useRealIncomes.ts` - Utilisation du nouveau système de refresh