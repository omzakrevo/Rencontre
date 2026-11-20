# 🔥 GazFlow — SaaS de commande et livraison de gaz multi-villes

GazFlow est une plateforme SaaS **multi-entreprises** : chaque distributeur de gaz s'abonne, configure ses villes, ses prix, son stock et ses livreurs. Ensuite, les clients commandent en ligne et suivent leur livraison.

## Pour le client : trouver du gaz en quelques secondes

Dès son arrivée, le client voit une **barre de recherche** et la carte :

1. Il tape sa marque, par exemple **« Oryx »**. Les fautes sont tolérées : « ori », « totale », « tradx » fonctionnent. Il peut ajouter la taille, par exemple « Total 12,5 ».
2. Les **points de vente qui ont cette marque** s'affichent sur la carte et en liste. Avec « 📍 Autour de moi », ils sont triés **du plus proche au plus loin** (« Le plus proche · 600 m »). Les points en rupture passent après.
3. Sur chaque point, il peut **📞 appeler**, **🗺️ s'y rendre** (itinéraire Google Maps), **🛵 se faire livrer** ou **♻️ faire une demande de recharge**.

### Les demandes : « qui peut venir chercher ma bouteille ? »
Le client publie une demande et choisit parmi trois services :
- **Recharge (échange)** : le livreur apporte une bouteille pleine et reprend la vide.
- **Collecte et recharge** : on vient chercher sa bouteille, on la recharge, on la ramène.
- **Bouteille neuve** : achat d'une bouteille avec la consigne.

La demande précise aussi la marque, la taille, la quantité, l'adresse et éventuellement la position GPS.

**Tous les distributeurs de la ville** la reçoivent dans « Demandes », triée par distance par rapport à leurs points de vente. Le produit correspondant est proposé en premier. Le premier qui clique sur « Prendre la demande » l'obtient ; les autres voient « déjà prise ». La demande devient une commande confirmée, avec un livreur et un suivi.

Le client voit **qui a pris sa demande**, peut **appeler le distributeur ou le livreur** et suit la livraison. Avant la prise en charge, son téléphone est masqué aux distributeurs.

Un visiteur peut remplir une demande sans compte. Elle est conservée pendant qu'il se connecte ou crée son compte.

## Les 4 espaces

| Rôle | Ce qu'il peut faire |
|---|---|
| **Client** | Choisir sa ville, comparer les distributeurs, remplir un panier (recharges, bouteilles neuves, accessoires), choisir un créneau et un paiement (espèces, Mobile Money, carte), suivre sa commande, annuler tant qu'aucun livreur n'est assigné |
| **Distributeur** (admin) | Demandes des clients proches, points de vente géolocalisés (placés en cliquant sur la carte), tableau de bord (CA par ville, commandes en cours, alertes de stock bas), confirmer et assigner les commandes (les livreurs de la ville sont proposés en premier), gérer prix et stock **par ville**, gérer ses villes (frais et délai de livraison) et ses livreurs, changer d'abonnement |
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

Au premier lancement, la base `gazflow.db` est créée avec des données de démonstration : 8 villes, 3 distributeurs, 10 points de vente géolocalisés (Abidjan, Bouaké, Dakar, Douala) et les marques Total, Oryx, Petro Ivoire et Tradex. Ces données sont des exemples.

Une base créée avec une version précédente est mise à jour automatiquement au démarrage. Il faut seulement ajouter les points de vente dans « Points de vente ».

La carte utilise Leaflet et les fonds OpenStreetMap, chargés depuis Internet. Sans connexion, la recherche fonctionne sans carte.

Mot de passe de tous les comptes de démonstration : **`demo1234`**

| Email | Rôle |
|---|---|
| `client@demo.app` | Client |
| `admin@gazexpress.ci` | Distributeur GazExpress (Abidjan, Bouaké, Dakar) |
| `livreur@gazexpress.ci` | Livreur à Abidjan |
| `admin@oryxpoint.ci` | Distributeur Oryx Point (Abidjan) |
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
  app.js      API REST Express (auth, recherche, demandes, catalogue, commandes, espaces distributeur et plateforme)
  search.js   recherche tolérante aux fautes et calcul de distance GPS
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
- Stock par point de vente : aujourd'hui, la disponibilité affichée est celle du distributeur dans la ville
- Facturation automatique des abonnements
- Passage à PostgreSQL pour une forte volumétrie
