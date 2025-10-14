# Documentation du Projet Popoth App

## 📋 Index de la Documentation

### 🏗️ Architecture et Systèmes

- **[Financial Planning System](./FINANCIAL_PLANNING_SYSTEM.md)** - Système de planification financière globale
- **[Financial Rules](./FINANCIAL_RULES.md)** - Règles de calcul financier et logique métier
- **[Expense Allocation System](./EXPENSE_ALLOCATION_SYSTEM.md)** - Système d'allocation des dépenses (tirelire → économies → budget)
- **[Monthly Recap System](./MONTHLY_RECAP_SYSTEM.md)** - Système de récapitulatif mensuel (déficits/surplus)
- **[Salary Contribution System](./SALARY_CONTRIBUTION_SYSTEM.md)** - Système de contribution aux revenus de groupe

### 🎨 Interface et UX

- **[Avatar System Guide](./AVATAR_SYSTEM_GUIDE.md)** - Système d'avatars utilisateur
- **[Progress Indicators Design](./PROGRESS_INDICATORS_DESIGN.md)** - Design des indicateurs de progression

### 🔧 Technique et Développement

- **[Context Profile vs Group Issue](./CONTEXT_PROFILE_VS_GROUP_ISSUE.md)** - Problématiques de contexte profil/groupe
- **[Financial Calculations](./financial-calculations.md)** - Détails techniques des calculs financiers

## 🗂️ Documentation Principale (Racine)

Consultez d'abord ces fichiers pour comprendre le projet :

- **[CLAUDE.md](../CLAUDE.md)** - Instructions principales pour Claude
- **[FEATURES.md](../FEATURES.md)** - Liste complète des fonctionnalités
- **[DATABASE.md](../DATABASE.md)** - Structure de base de données
- **[TECH_STACK.md](../TECH_STACK.md)** - Stack technique et outils
- **[DEVELOPMENT_GUIDELINES.md](../DEVELOPMENT_GUIDELINES.md)** - Guidelines de développement
- **[SESSION_STATUS.md](../SESSION_STATUS.md)** - État actuel du projet

## 📊 Base de Données

- **[Database Documentation](../database/DATABASE_DOCUMENTATION.md)** - Documentation complète de la DB
- **[Database Relationships](../database/DATABASE_RELATIONSHIPS.md)** - Relations entre tables
- **[Logging System](../database/LOGGING_SYSTEM.md)** - Système de logging

## 📝 Logs de Développement

Historique des sessions de développement dans le dossier [`../logs/`](../logs/)

## 🔗 Navigation Rapide

### Pour les Développeurs
1. Commencez par [CLAUDE.md](../CLAUDE.md) pour les instructions générales
2. Consultez [TECH_STACK.md](../TECH_STACK.md) pour l'environnement
3. Suivez [DEVELOPMENT_GUIDELINES.md](../DEVELOPMENT_GUIDELINES.md) pour les conventions

### Pour Comprendre les Fonctionnalités
1. Lisez [FEATURES.md](../FEATURES.md) pour une vue d'ensemble
2. Explorez les systèmes spécifiques dans ce dossier `docs/`
3. Consultez [DATABASE.md](../DATABASE.md) pour la structure des données

### Pour les Aspects Financiers
1. [Financial Planning System](./FINANCIAL_PLANNING_SYSTEM.md) - Vue globale
2. [Financial Rules](./FINANCIAL_RULES.md) - Règles métier
3. [Monthly Recap System](./MONTHLY_RECAP_SYSTEM.md) - Processus mensuel
4. [Financial Calculations](./financial-calculations.md) - Implémentation technique

## 📦 Structure du Projet

```
/
├── docs/                    # Documentation détaillée (ce dossier)
├── database/               # Documentation base de données
├── logs/                   # Historique des sessions de développement
├── CLAUDE.md              # Instructions principales pour Claude
├── FEATURES.md            # Liste des fonctionnalités
├── DATABASE.md            # Structure de base de données
├── TECH_STACK.md          # Stack technique
├── DEVELOPMENT_GUIDELINES.md # Guidelines de développement
└── SESSION_STATUS.md      # État actuel du projet
```

---

**Dernière mise à jour** : Décembre 2024
**Version** : 1.0.0 - Système de Monthly Recap simplifié