# 📊 Tracking du RAV (Reste À Vivre) - Console Logs

Ce document explique tous les points de console.log mis en place pour tracker le RAV à chaque étape du monthly recap.

## 🎯 Vue d'ensemble

Le RAV est tracké à **4 moments clés** :
1. **Étape 1** - État initial
2. **Après rééquilibrage** - Si l'utilisateur équilibre le RAV négatif
3. **Étape 2** - État avant finalisation
4. **Finalisation** - État final avant validation

---

## 📍 Points de tracking détaillés

### 1️⃣ ÉTAPE 1 - RAV Initial

**Fichier Backend** : `app/api/monthly-recap/step1-data/route.ts`
**Fichier Frontend** : `components/monthly-recap/MonthlyRecapStep1.tsx`

#### Backend (API)
```
🎯🎯🎯 ========================================================
🎯🎯🎯 ÉTAPE 1 - RESTE À VIVRE INITIAL
🎯🎯🎯 ========================================================
🎯 CONTEXTE: PROFILE|GROUP
🎯 ID: <contextId>
🎯 TIMESTAMP: <ISO timestamp>

💰 RESTE À VIVRE (RAV): <montant>€

📊 DÉTAILS FINANCIERS:
   - Solde bancaire: <montant>€
   - Revenus estimés: <montant>€
   - Revenus réels: <montant>€
   - Budgets estimés: <montant>€
   - Dépenses réelles: <montant>€
   - Solde disponible: <montant>€
🎯🎯🎯 ========================================================
```

#### Frontend (Composant)
```
🎯🎯🎯 ========================================================
🎯🎯🎯 [FRONTEND] ÉTAPE 1 - DONNÉES REÇUES
🎯🎯🎯 ========================================================
💰 RESTE À VIVRE: <montant>€
📊 Est positif: true|false
📉 Déficit: <montant>€
💎 Économies disponibles: <montant>€
📊 Excédents disponibles: <montant>€
💰 Total disponible: <montant>€
✅ Peut équilibrer: true|false
✅ Peut équilibrer complètement: true|false
🎯🎯🎯 ========================================================
```

---

### 2️⃣ APRÈS RÉÉQUILIBRAGE - RAV après correction

**Fichier Backend** : `app/api/monthly-recap/balance/route.ts`
**Fichier Frontend** : `components/monthly-recap/MonthlyRecapStep1.tsx`

#### Backend (API)
```
🔄🔄🔄 ========================================================
🔄🔄🔄 APRÈS RÉÉQUILIBRAGE - RESTE À VIVRE
🔄🔄🔄 ========================================================
🔄 CONTEXTE: PROFILE|GROUP
🔄 ID: <contextId>
🔄 TIMESTAMP: <ISO timestamp>

💰 RESTE À VIVRE INITIAL: <montant>€
💰 RESTE À VIVRE APRÈS RÉÉQUILIBRAGE: <montant>€
📈 CHANGEMENT: +<montant>€

💵 RÉCUPÉRÉ:
   - Économies utilisées: <montant>€
   - Excédents utilisés: <montant>€
   - TOTAL RÉCUPÉRÉ: <montant>€

🏦 SOLDE BANCAIRE:
   - Initial: <montant>€
   - Final: <montant>€
   - Changement: +<montant>€

✅ VÉRIFICATION MATHÉMATIQUE:
   - Attendu: <initial> + <récupéré> = <résultat>€
   - Réel: <montant>€
   - Match: ✅ OUI | ❌ NON
🔄🔄🔄 ========================================================
```

#### Frontend (Composant)
```
🔄🔄🔄 ========================================================
🔄🔄🔄 [FRONTEND] RÉÉQUILIBRAGE EN COURS
🔄🔄🔄 ========================================================
💰 RAV avant rééquilibrage: <montant>€
🔄🔄🔄 ========================================================

... (après appel API) ...

🔄🔄🔄 ========================================================
🔄🔄🔄 [FRONTEND] RÉSULTAT RÉÉQUILIBRAGE
🔄🔄🔄 ========================================================
💰 RAV initial: <montant>€
💰 RAV final: <montant>€
📈 Changement: <montant>€
💎 Économies utilisées: <montant>€
📊 Excédents utilisés: <montant>€
🔄🔄🔄 ========================================================
```

---

### 3️⃣ ÉTAPE 2 - RAV avant finalisation

**Fichier Backend** : `app/api/monthly-recap/step2-data/route.ts`
**Fichier Frontend** : `components/monthly-recap/MonthlyRecapStep2.tsx`

#### Backend (API)
```
📊📊📊 ========================================================
📊📊📊 ÉTAPE 2 - RESTE À VIVRE
📊📊📊 ========================================================
📊 CONTEXTE: PROFILE|GROUP
📊 ID: <contextId>
📊 TIMESTAMP: <ISO timestamp>

💰 RESTE À VIVRE (RAV): <montant>€

📊 DÉTAILS FINANCIERS:
   - Solde bancaire: <montant>€
   - Revenus estimés: <montant>€
   - Revenus réels: <montant>€
   - Budgets estimés: <montant>€
   - Dépenses réelles: <montant>€
   - Solde disponible: <montant>€
📊📊📊 ========================================================
```

#### Frontend (Composant)
```
📊📊📊 ========================================================
📊📊📊 [FRONTEND] ÉTAPE 2 - DONNÉES REÇUES
📊📊📊 ========================================================
💰 RESTE À VIVRE: <montant>€
📊 Total surplus: <montant>€
📉 Total déficit: <montant>€
📊 Nombre de budgets: <nombre>
📊📊📊 ========================================================
```

---

### 4️⃣ FINALISATION - RAV final

**Fichier Backend** : `app/api/monthly-recap/complete/route.ts`
**Fichier Frontend** : `components/monthly-recap/MonthlyRecapFlow.tsx`

#### Backend (API)
```
🏁🏁🏁 ========================================================
🏁🏁🏁 FINALISATION - RESTE À VIVRE FINAL
🏁🏁🏁 ========================================================
🏁 CONTEXTE: PROFILE|GROUP
🏁 ID: <contextId>
🏁 TIMESTAMP: <ISO timestamp>

💰 RESTE À VIVRE AVANT VALIDATION: <montant>€
💰 RESTE À VIVRE FINAL (après choix): <montant>€

🎯 ACTION CHOISIE: carry_forward|deduct_from_budget
🎯 MODE: Report sur le mois suivant | BUDGET UTILISÉ: <id>

📊 DÉTAILS FINANCIERS AVANT FINALISATION:
   - Solde bancaire: <montant>€
   - Revenus estimés: <montant>€
   - Revenus réels: <montant>€
   - Budgets estimés: <montant>€
   - Dépenses réelles: <montant>€
   - Solde disponible: <montant>€
🏁🏁🏁 ========================================================
```

#### Frontend (Composant)
```
🏁🏁🏁 ========================================================
🏁🏁🏁 [FRONTEND] FINALISATION DU RÉCAP
🏁🏁🏁 ========================================================
🏁 Action: carry_forward
🏁🏁🏁 ========================================================

... (après appel API) ...

🏁🏁🏁 ========================================================
🏁🏁🏁 [FRONTEND] FINALISATION RÉUSSIE
🏁🏁🏁 ========================================================
💰 RAV initial: <montant>€
💰 RAV final: <montant>€
📊 Surplus total: <montant>€
📉 Déficit total: <montant>€
🏁🏁🏁 ========================================================
```

---

## 🔍 Comment utiliser ces logs

### Pour débugger un problème de RAV :

1. **Ouvrez la console du navigateur** (F12 → Console)
2. **Effectuez le monthly recap** étape par étape
3. **Cherchez les blocs de logs** avec les emojis distinctifs :
   - 🎯🎯🎯 = Étape 1
   - 🔄🔄🔄 = Rééquilibrage
   - 📊📊📊 = Étape 2
   - 🏁🏁🏁 = Finalisation

### Points de vérification clés :

✅ **Le RAV doit être cohérent** entre les étapes (sauf après rééquilibrage)
✅ **Après rééquilibrage**, vérifier que le "Match" est ✅ OUI
✅ **À la finalisation**, vérifier que le RAV correspond à l'attendu

### Exemples de scénarios :

#### Scénario 1 : RAV négatif → Rééquilibrage → Étape 2
```
Étape 1 : RAV = -100€
Rééquilibrage : Récupère 150€ → RAV = 50€
Étape 2 : RAV = 50€ ✅ (cohérent)
Finalisation : RAV final = 50€ ✅
```

#### Scénario 2 : RAV positif → Pas de rééquilibrage
```
Étape 1 : RAV = 200€
(pas de rééquilibrage nécessaire)
Étape 2 : RAV = 200€ ✅ (cohérent)
Finalisation : RAV final = 200€ ✅
```

---

## 🐛 Debugging

Si le RAV n'est pas cohérent entre les étapes :

1. **Vérifier le timestamp** - Les appels sont-ils dans le bon ordre ?
2. **Vérifier le context ID** - Est-ce le même profil/groupe ?
3. **Vérifier les détails financiers** - Quels chiffres ont changé ?
4. **Vérifier la vérification mathématique** - Le calcul est-il correct ?

---

## 📝 Notes

- Tous les montants sont en euros (€)
- Les timestamps sont en ISO 8601
- Le contexte peut être "PROFILE" ou "GROUP"
- Les logs backend apparaissent dans la console du serveur
- Les logs frontend apparaissent dans la console du navigateur
