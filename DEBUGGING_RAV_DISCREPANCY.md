# 🐛 Debugging RAV Discrepancy (Écart de 190€)

## 🎯 Problème Identifié

**Symptôme** : Écart de 190€ entre la fin du monthly recap (-1150€) et l'affichage sur le dashboard (-960€)

## 🔍 Points de Vérification

### 1. Vérifier les logs de fin de monthly recap

Cherchez dans la console le bloc suivant :

```
🏁🏁🏁 ========================================================
🏁🏁🏁 FINALISATION - RESTE À VIVRE FINAL
🏁🏁🏁 ========================================================
💰 RESTE À VIVRE AVANT VALIDATION: -1150€
```

**Notez :**
- Le RAV avant validation
- Le solde bancaire
- Les revenus réels
- Les dépenses réelles

### 2. Vérifier les logs du dashboard

Cherchez dans la console le bloc suivant :

```
🏠🏠🏠 ========================================================
🏠🏠🏠 DASHBOARD - CHARGEMENT DONNÉES FINANCIÈRES
🏠🏠🏠 ========================================================
💰 RESTE À VIVRE (RAV): -960€
```

**Notez :**
- Le RAV au chargement
- Le solde bancaire
- Les revenus réels
- Les dépenses réelles

### 3. Vérifier les requêtes de base de données

Cherchez dans la console les logs suivants :

```
💵 [DEBUG DB QUERY] Revenus réels récupérés: X entrées
💵 [DEBUG DB QUERY] Détail des revenus:
   1. XXX€ - Description (Date)
   ...

💸 [DEBUG DB QUERY] Dépenses réelles récupérées: Y entrées
💸 [DEBUG DB QUERY] Détail des dépenses:
   1. XXX€ - Description (Date)
   ...
```

**Comparez :**
- Nombre d'entrées de revenus réels au moment de la finalisation vs dashboard
- Nombre d'entrées de dépenses réelles au moment de la finalisation vs dashboard
- Les montants totaux

### 4. Analyser le résumé des calculs

Cherchez le bloc suivant :

```
📊📊📊 ========================================================
📊📊📊 RÉSUMÉ CALCULS FINANCIERS - PROFILE
📊📊📊 ========================================================
🏦 DONNÉES BASE:
   - Solde bancaire: XXX€
   - Revenus réels (X entrées): XXX€
   - Dépenses réelles (Y entrées): XXX€

📈 CALCULS DÉRIVÉS:
   - Contribution revenus: XXX€
   - Revenus exceptionnels: XXX€
   - Budgets estimés: XXX€
   - Dépenses exceptionnelles: XXX€

💰 RESTE À VIVRE: XXX€
```

## 🧮 Formule du RAV

```
RAV = Contribution revenus + Revenus exceptionnels - Budgets estimés - Dépenses exceptionnelles
```

## 🔎 Hypothèses à Vérifier

### Hypothèse 1 : Déficits reportés

Lors du monthly recap complete, des déficits sont reportés comme dépenses réelles pour le mois suivant.

**À vérifier :**
- Y a-t-il des dépenses avec description "Déficit reporté du récap MM/YYYY" ?
- Quel est le montant total de ces déficits ?

### Hypothèse 2 : Timing de la suppression des données

Le monthly recap supprime les revenus et dépenses réels **après** les calculs de déficit/surplus.

**À vérifier :**
- Le timestamp de la finalisation
- Le timestamp du chargement du dashboard
- Les données entre les deux

### Hypothèse 3 : Revenus exceptionnels du rééquilibrage

Lors du rééquilibrage, un revenu exceptionnel est créé pour remonter le RAV.

**À vérifier :**
- Y a-t-il un revenu avec description "Équilibrage RAV proportionnel" ?
- Ce revenu est-il supprimé lors du monthly recap complete ?

## 📝 Checklist de Debugging

- [ ] Noter le RAV à la fin du monthly recap
- [ ] Noter le RAV au chargement du dashboard
- [ ] Comparer le nombre de revenus réels
- [ ] Comparer le nombre de dépenses réelles
- [ ] Identifier les nouvelles entrées apparues entre les deux
- [ ] Calculer manuellement le RAV avec les données du dashboard
- [ ] Vérifier si le calcul manuel correspond au RAV affiché

## 🎯 Questions à Poser

1. **Est-ce que les 190€ correspondent à un déficit reporté ?**
   - Vérifier les logs de `[Deficit Processing]`

2. **Est-ce que les 190€ correspondent à des dépenses exceptionnelles ?**
   - Vérifier le total des dépenses exceptionnelles

3. **Est-ce que le solde bancaire a changé ?**
   - Comparer le solde bancaire entre finalisation et dashboard

4. **Est-ce que les budgets estimés ont changé ?**
   - Comparer le total des budgets estimés

## 🔧 Actions Correctives

Si l'écart est dû à des déficits reportés :
- Vérifier que les déficits sont correctement pris en compte dans le calcul du RAV
- S'assurer que les déficits reportés sont bien des dépenses exceptionnelles

Si l'écart est dû à un problème de timing :
- Vérifier l'ordre des opérations dans le monthly recap complete
- S'assurer que les données sont bien persistées avant la suppression

Si l'écart est dû à un problème de cache :
- Forcer le rafraîchissement des données après le monthly recap
- Vérifier que le dashboard récupère bien les données à jour

## 📊 Logs à Collecter

Copiez les sections suivantes de la console :

1. **Fin du monthly recap** (🏁🏁🏁)
2. **Chargement du dashboard** (🏠🏠🏠)
3. **Requêtes de base de données** (💵 et 💸)
4. **Résumé des calculs** (📊📊📊)
5. **Traitement des déficits** ([Deficit Processing])
6. **Traitement des économies** ([Savings Processing])

---

## 💡 Note Importante

Le RAV est calculé **en temps réel** à chaque fois qu'on le demande. Il n'est **pas** mis en cache.

Si les données en base sont différentes entre deux moments, le RAV sera différent.

L'écart de 190€ indique que **190€ de différence existe dans les données de base** (revenus, dépenses, budgets) entre la fin du récap et le chargement du dashboard.
