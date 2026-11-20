# 🔥 GazFlow — SaaS de commande et livraison de gaz multi-villes

GazFlow est une plateforme SaaS **multi-entreprises** : chaque distributeur de gaz s'abonne, configure ses villes, ses prix, son stock et ses livreurs. Ensuite, les clients commandent en ligne et suivent leur livraison.

## Les 4 espaces

| Rôle | Ce qu'il peut faire |
|---|---|
| **Client** | Choisir sa ville, comparer les distributeurs, remplir un panier (recharges, bouteilles neuves, accessoires), choisir un créneau et un paiement (espèces, Mobile Money, carte), suivre sa commande, annuler tant qu'aucun livreur n'est assigné |
| **Distributeur** (admin) | Tableau de bord (CA par ville, commandes en cours, alertes de stock bas), confirmer et assigner les commandes (les livreurs de la ville sont proposés en premier), gérer prix et stock **par ville**, gérer ses villes (frais et délai de livraison) et ses livreurs, changer d'abonnement |
| **Livreur** | Interface mobile : ses courses, appel du client, itinéraire Google Maps, « Démarrer » puis « Livrée » |
| **Opérateur plateforme** | Liste des distributeurs, revenu mensuel (MRR), volume livré, changement d'offre, suspension d'un compte |

### Statuts d'une commande
`En attente → Confirmée → Livreur assigné → En cours de livraison → Livrée` (ou `Annulée`, avec remise en stock automatique). Chaque changement est historisé : on sait qui a fait quoi et quand.

### Offres d'abonnement (modifiables dans `src/db.js`)
| Offre | Prix/mois | Villes | Livreurs |
|---|---|---|---|
| Starter | 15 000 FCFA | 1 | 3 |
| Pro | 45 000 FCFA | 5 | 20 |
| Entreprise | 120 000 FCFA | illimité | illimité |

## Démarrage

Il faut **Node.js 22.13 ou plus récent**. La base SQLite est intégrée à Node, donc rien d'autre à installer.

```bash
npm install
npm start          # http://localhost:3000
npm test           # tests de l'API
```

Au premier lancement, la base `gazflow.db` est créée avec des données de démonstration : 8 villes (Abidjan, Bouaké, Dakar, Thiès, Douala, Yaoundé, Lomé, Cotonou) et 2 distributeurs.

Mot de passe de tous les comptes de démonstration : **`demo1234`**

| Email | Rôle |
|---|---|
| `client@demo.app` | Client |
| `admin@gazexpress.ci` | Distributeur GazExpress (Abidjan, Bouaké, Dakar) |
| `livreur@gazexpress.ci` | Livreur à Abidjan |
| `admin@butane.cm` | Distributeur Butane Services (Douala) |
| `super@gazflow.app` | Opérateur plateforme |

### Variables d'environnement
| Variable | Rôle | Par défaut |
|---|---|---|
| `PORT` | Port HTTP | `3000` |
| `DB_FILE` | Fichier SQLite | `gazflow.db` |
| `AUTH_SECRET` | Secret de signature des sessions. **À définir en production.** | secret de développement |

## Architecture

```
src/
  server.js   démarrage
  app.js      API REST Express (auth, catalogue, commandes, espaces distributeur et plateforme)
  db.js       schéma SQLite, offres d'abonnement, données de démonstration
  auth.js     mots de passe (scrypt) et jetons signés (HMAC)
public/       interface web (HTML/CSS/JS, sans framework, responsive, mode sombre)
test/         tests d'intégration de l'API (node:test)
```

**Isolation des données :** chaque requête est filtrée par le `tenant_id` de l'utilisateur. Un distributeur ne voit jamais les commandes d'un autre, et un livreur ne voit que les courses qui lui sont assignées.

**Stock :** il est décrémenté dans une transaction, avec une condition `stock >= quantité`. Deux clients ne peuvent donc pas acheter la même dernière bouteille.

## Pistes pour la suite
- Paiement Mobile Money réel (Orange Money, MTN MoMo, Wave) via un agrégateur comme CinetPay ou PayDunya
- Notifications SMS/WhatsApp à chaque changement de statut
- Géolocalisation du livreur en temps réel
- Facturation automatique des abonnements
- Passage à PostgreSQL pour une forte volumétrie
