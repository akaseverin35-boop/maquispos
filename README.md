# Gesta+ — logiciel de caisse et de gestion (version web)

Application web de gestion complète pour commerces de détail, restaurants, bars et
boutiques, reprenant la structure du logiciel **Gesta+** (gesta-plus.com) : catégories,
articles, stocks, ventes, dépenses, gestion commerciale, reçus, employés et paramétrage.

Contrairement à Gesta+ qui se compose de deux applications mobiles séparées
(*Gesta+ POS* et *Gesta+ Tableau de bord*), cette version réunit la caisse et le tableau
de bord dans une seule application web utilisable au téléphone comme au PC.

## Démarrage

```bash
npm install     # installe le serveur et l'interface
npm run seed    # crée la base et les données de démonstration
npm run dev     # API sur :4000, interface sur :5173
```

Ouvrez <http://localhost:5173>.

Pour un déploiement en un seul service (l'API sert aussi l'interface compilée) :

```bash
npm run build && npm start   # tout sur http://localhost:4000
```

### Comptes de démonstration

| Identifiant | Mot de passe | Rôle | Accès |
|---|---|---|---|
| `admin` | `admin` | Administrateur | Tout |
| `gerant` | `gerant` | Gérant | Gestion, rapports, stocks, annulations |
| `caissier` | `caissier` | Caissier | Caisse, reçus, dépenses, clients |
| `serveur` | `serveur` | Serveur | Prise de commande uniquement |

**Changez ces mots de passe avant toute utilisation réelle**, ainsi que `JWT_SECRET`
(voir `.env.example`).

## Modules

Le découpage suit le sommaire du guide Gesta+ :

| § | Module | État |
|---|---|---|
| 3 | Gestion des catégories | création, modification, suppression, couleur, point de vente |
| 4 | Gestion des articles | libellé, catégorie, vendu par, prix, coût, alerte, suivi de stock, image |
| 5 | Gestion des stocks | niveaux, entrées, sorties, ajustements d'inventaire, historique |
| 6 | Faire la vente | période de travail, panier, remise en montant ou en pourcentage |
| 7 | Les dépenses | saisie, catégories, filtre par période, totaux |
| 8 | Gestion commerciale | clients, créances, règlements, factures |
| 9 | Reçu de vente | historique, consultation, impression, annulation |
| 10 | Gestion des employés | comptes, rôles, rattachement à un point de vente |
| 11 | Paramétrage | entreprise, devise, TVA, points de vente, tables, historique de caisse |
| 12 | Synchronisation | **non implémenté** — voir « Limites » |

### Règles métier reprises du guide

- **Prix de vente à 0** → article à prix libre : le prix est demandé pendant la vente.
- **Vendu par « Poids / Volume »** → la quantité est décimale (1,5 kg) et demandée à la
  vente. Un article « Chaque » refuse une quantité non entière.
- **Suivi de stock activé** → la vente est bloquée quand le stock atteint zéro, et refusée
  au-delà du stock disponible.
- **Multi-points de vente** : catégories, articles, tables et employés sont rattachés à un
  point de vente, sélectionnable en haut de l'écran.
- **Période de travail** : aucune vente n'est possible sans caisse ouverte. La fermeture
  compare les espèces comptées au montant attendu (fond + encaissements − dépenses).

## Architecture

```
server/          API Node + Express + SQLite (better-sqlite3)
  src/lib/db.js       schéma et paramètres
  src/routes/         une route par domaine métier
  src/seed.js         données de démonstration
client/          Interface React + TypeScript + Vite + Tailwind
  src/pages/          une page par module
  src/components/     composants partagés et reçu imprimable
```

Points de conception :

- Les **montants sont des entiers** dans l'unité de base de la devise (le franc CFA n'a
  pas de sous-unité). Aucun flottant n'intervient dans un calcul d'argent.
- Les **quantités sont réelles**, pour les articles vendus au poids ou au volume.
- Chaque vente et chaque mouvement de stock est écrit dans une **transaction** : une
  vente est enregistrée en totalité ou pas du tout.
- Le **coût d'achat est figé dans la ligne de vente**, pour que la marge historique reste
  exacte même si le coût de l'article change plus tard.
- Un article ou un employé déjà utilisé est **désactivé plutôt que supprimé**, afin de ne
  jamais casser l'historique.

## Limites connues

- **La synchronisation (§12) n'est pas implémentée.** Gesta+ fonctionne hors connexion
  puis synchronise ; ici les données vivent sur le serveur et l'application requiert une
  connexion à celui-ci. C'est le chantier le plus important restant.
- Les sections 6 à 12 du guide n'ont pas été fournies en captures : leur comportement a
  été déduit du sommaire et des usages courants d'un logiciel de caisse. Les écrans
  correspondants sont donc à confronter à l'original.
- L'image d'un article est choisie parmi une série d'émojis ; l'envoi de photos n'est pas
  encore possible.
- Pas de test automatisé pour l'instant : la vérification a été faite manuellement, par
  pilotage du navigateur.
