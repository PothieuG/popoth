# 📦 Dépendances Manquantes à Installer

Pour que le système de gestion financière fonctionne correctement, vous devez installer les dépendances Radix UI manquantes.

## Installation via pnpm

Exécutez cette commande dans le terminal :

```bash
pnpm add @radix-ui/react-progress @radix-ui/react-tabs @radix-ui/react-switch @radix-ui/react-select
```

## Détail des dépendances

- **@radix-ui/react-progress** - Pour les barres de progression des budgets
- **@radix-ui/react-tabs** - Pour les onglets du dashboard financier  
- **@radix-ui/react-switch** - Pour le basculement Personnel/Groupe
- **@radix-ui/react-select** - Pour les listes déroulantes (liaison revenus/budgets)

## Vérification

Après installation, le dashboard financier devrait se compiler sans erreur et être accessible via :

1. **Dashboard principal** → Bouton "Accéder à la gestion financière"
2. **Footer navigation** → Boutons "Personnel" et "Groupe" (si dans un groupe)

## Alternative temporaire

Si vous ne pouvez pas installer les dépendances maintenant, vous pouvez temporairement commenter les imports problématiques dans les composants pour tester le reste du système.