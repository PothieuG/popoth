# 💰 Système de Gestion des Salaires et Contributions Proportionnelles

## 🎯 Vue d'ensemble

Le système de gestion des salaires et contributions permet aux membres d'un groupe de partager équitablement les dépenses selon leurs revenus respectifs. Chaque membre peut définir son salaire, et l'application calcule automatiquement la contribution proportionnelle de chacun au budget du groupe.

## 🚀 Fonctionnalités

### ✅ Gestion des Salaires
- **Saisie du salaire** : Chaque utilisateur peut définir son salaire mensuel dans les paramètres
- **Modification en temps réel** : Le salaire peut être modifié à tout moment
- **Validation** : Saisie sécurisée avec validation (0 à 999,999.99 €)
- **Optionnel** : Le salaire est optionnel, un système de répartition égale est appliqué par défaut

### ✅ Calcul Automatique des Contributions
- **Proportionnel** : Les contributions sont calculées au prorata des salaires
- **Recalcul automatique** : Mise à jour instantanée lors des changements
- **Gestion des cas limites** : Répartition équitable si aucun salaire n'est défini

### ✅ Interface Utilisateur
- **Section profil** : Modification du salaire dans les paramètres
- **Contribution personnelle** : Affichage de sa propre contribution et pourcentage
- **Vue d'ensemble du groupe** : Liste des membres avec leurs contributions respectives
- **Statistiques** : Résumé du budget et des contributions totales

## 📊 Logique de Calcul

### Formule de Base
```
Contribution utilisateur = (Salaire utilisateur / Total salaires groupe) × Budget groupe
Pourcentage contribution = (Contribution / Salaire utilisateur) × 100
```

### Exemple Concret
**Groupe "Famille Martin"** - Budget : 2000€/mois
- **Marie** : Salaire 2500€ → Contribution 1250€ (50%)
- **Paul** : Salaire 1500€ → Contribution 750€ (37.5%)
- **Total** : 4000€ de salaires → 2000€ de contributions

### Cas Particuliers
- **Aucun salaire défini** : Répartition équitable entre tous les membres
- **Salaires partiels** : Les membres sans salaire participent à la répartition équitable du reste
- **Nouveau membre** : Recalcul automatique pour tous les membres du groupe

## 🔧 Guide d'Utilisation

### 1. Définir votre Salaire
1. Accédez aux **Paramètres** depuis le menu principal
2. Dans la section **"Informations personnelles"**, cliquez sur **"Modifier"**
3. Saisissez votre **salaire mensuel** en euros
4. Cliquez sur **"Enregistrer"**

### 2. Consulter votre Contribution
1. Dans les **Paramètres**, la section **"Votre contribution"** apparaît si vous êtes dans un groupe
2. Consultez :
   - Votre **contribution mensuelle** en euros
   - Le **pourcentage** de votre salaire
   - Les **statistiques du groupe**

### 3. Voir les Contributions du Groupe
1. Dans **"Mon groupe"**, cliquez sur **"Voir membres"**
2. La modal affiche tous les membres avec :
   - Leur **contribution respective**
   - Le **pourcentage** de participation
   - Le **salaire de base** (si défini)

### 4. Actualiser les Calculs
- Les calculs se font **automatiquement** lors des changements
- Bouton **"Actualiser"** disponible pour forcer un recalcul
- Les modifications sont **instantanées** pour tous les membres

## 🏗️ Architecture Technique

### Base de Données
- **Table `profiles`** : Champ `salary` ajouté
- **Table `group_contributions`** : Stockage des calculs
- **Triggers PostgreSQL** : Recalcul automatique
- **RLS Policies** : Sécurité des données

### API Endpoints
- `PUT /api/profile` : Mise à jour du salaire
- `GET /api/groups/contributions` : Récupération des contributions
- `POST /api/groups/contributions` : Recalcul forcé

### Composants Frontend
- `ProfileSettingsCard` : Gestion du profil et salaire
- `UserContributionCard` : Affichage contribution personnelle
- `GroupMembersWithContributionsModal` : Vue d'ensemble du groupe

## 🔐 Sécurité et Confidentialité

### Protection des Données
- **RLS (Row Level Security)** : Accès limité aux membres du groupe
- **Validation des saisies** : Contrôle des montants saisis
- **Chiffrement** : Communications sécurisées HTTPS

### Confidentialité
- **Visibilité limitée** : Seuls les membres du groupe voient les contributions
- **Données personnelles** : Salaires visibles uniquement par les membres du même groupe
- **Anonymisation** : Possibilité de ne pas définir de salaire

## 🚨 Gestion des Erreurs

### Erreurs Communes
- **Salaire invalide** : Message d'erreur avec format attendu
- **Groupe introuvable** : Redirection vers la création de groupe
- **Calcul impossible** : Fallback sur répartition équitable

### Messages d'Information
- **Contribution non calculée** : Indication claire avec bouton d'action
- **Membre sans salaire** : Avertissement visuel dans la liste
- **Recalcul en cours** : Indicateur de chargement

## 📱 Expérience Mobile

### Interface Adaptive
- **Design mobile-first** : Optimisé pour smartphones
- **Navigation intuitive** : Accès facile aux fonctionnalités
- **Formulaires tactiles** : Saisie optimisée sur écrans tactiles

### Performances
- **Calculs côté serveur** : Réactivité optimisée
- **Cache intelligent** : Réduction des requêtes répétées
- **Loading states** : Feedback visuel pendant les opérations

## 🔄 Évolutions Futures Possibles

### Fonctionnalités Avancées
- **Historique des contributions** : Suivi dans le temps
- **Prédictions budgétaires** : Projections basées sur l'historique
- **Notifications** : Alertes lors des changements de contribution
- **Export des données** : PDF ou CSV pour la comptabilité

### Améliorations UX
- **Graphiques** : Visualisation des répartitions
- **Comparaisons** : Évolution des contributions
- **Suggestions** : Optimisation du budget de groupe

---

## 📞 Support

Pour toute question ou problème concernant le système de contributions :

1. **Interface** : Vérifiez les messages d'erreur affichés
2. **Recalcul** : Utilisez le bouton "Actualiser" si les données semblent incorrectes
3. **Documentation** : Consultez cette documentation pour les cas d'usage
4. **Issues GitHub** : Reportez les bugs sur le repository du projet

---

*Documentation mise à jour le 14 septembre 2025*