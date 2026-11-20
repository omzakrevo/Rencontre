# 🔥 FasoGaz — commande et livraison de gaz au Burkina Faso

FasoGaz est une plateforme SaaS **multi-entreprises**, pensée pour le **Burkina Faso** (Ouagadougou, Bobo-Dioulasso, Banfora, Koudougou…) : chaque distributeur de gaz s'abonne, configure ses villes, ses prix, son stock et ses livreurs. Ensuite, les clients commandent en ligne et suivent leur livraison.

## Pour le client : trouver du gaz en quelques secondes

Dès son arrivée, le client voit une **barre de recherche** et la carte :

1. Il tape sa marque, par exemple **« Oryx »**, « Sodigaz », « Total » ou « Shell ». Les fautes sont tolérées (« ori », « sodigas »), et il peut ajouter la taille (« Sodigaz 12,5 »).
   Il peut aussi ajouter la ville, même abrégée : **« Oryx Bobo »**, « gaz Ouaga », « Sodigaz Banfora ». Des raccourcis 📍 Ouaga · Bobo · Banfora sont affichés sous la recherche.
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

## Design et motion design

- **Une page d'accueil qui présente le projet** :
  - une scène animée où les épingles tombent sur la carte, un livreur roule du dépôt à la maison et des notifications apparaissent ;
  - un titre où la marque change (« Votre gaz Sodigaz / Oryx / Total / Shell… ») ;
  - des chiffres réels qui défilent ;
  - les sections « Comment ça marche » et services, une mosaïque de photos et une section distributeurs avec un tableau de bord animé.
- **Animations dans toute l'application** :
  - transitions entre les pages et apparitions au défilement ;
  - écrans de chargement, états vides illustrés ;
  - suivi de livraison avec un scooter qui avance jusqu'à l'étape en cours.
- **Espace client façon application mobile** :
  - en-tête avec avatar, pastille de position (« Près de Ouaga ») et cloche qui signale une demande ou une livraison en cours ;
  - carrousel de services avec de grandes bouteilles et des boutons en pilule (Recharger, Collecte, Bouteille neuve, Commander) ;
  - panneau « Mes commandes » avec statuts colorés ;
  - barre d'onglets flottante en bas de l'écran sur mobile.
- **Illustrations maison** (`public/art.js`) : en SVG animé, sans droits d'auteur, légères et adaptées au mode sombre. Elles se mettent en pause quand elles ne sont pas à l'écran.
- **Accessibilité** : si l'appareil demande de réduire les animations, tout reste visible et rien ne bouge.
- **Responsive** : menu mobile, recherche et carte empilées, commandes affichées en cartes sur téléphone, aucun défilement horizontal.
- **Photos** (`public/img/`, [licence Unsplash](https://unsplash.com/license) : usage commercial gratuit) :
  - livreur avec bouteille de gaz : [JNY AAA](https://unsplash.com/@ynjatwork) ;
  - livreur à moto : [Ariel Nathan Ada Mbita](https://unsplash.com/@adambita237) ;
  - bouteilles : [Eric Prouzet](https://unsplash.com/@eprouzet) ;
  - cuisine : [Elise Gaumier](https://unsplash.com/@e_g_e_photographie).

  Pour la production, remplacez-les par vos propres photos (vos dépôts, vos livreurs, vos marques).

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

Il faut **Node.js 22.12 ou plus récent**. En local, une base **Postgres embarquée** démarre toute seule : rien d'autre à installer. Ses données sont dans `.data/db`.

```bash
npm install
npm start          # http://localhost:3000
npm test           # tests de l'API
```

Au premier lancement, les migrations de `netlify/database/migrations/` créent les tables et les **données de démonstration du Burkina Faso** :
- 12 villes : Ouagadougou, Bobo-Dioulasso, Banfora, Koudougou, Ouahigouya, Kaya, Tenkodogo, Fada N'Gourma, Dédougou, Gaoua, Dori, Ziniaré.
- 4 distributeurs **fictifs** desservant Ouagadougou, Bobo-Dioulasso, Banfora et Koudougou.
- 11 points de vente dans de vrais quartiers : Ouaga 2000, Zogona, Gounghin, Tampouy, Pissy, Accart-Ville, Sarfalao, Dogona, Banfora centre, Koudougou.
- Les marques vendues au Burkina (Sodigaz, Oryx, Total, Shell), en 6 kg et 12,5 kg.
- Des prix **indicatifs** en FCFA : recharge 12,5 kg ≈ 5 500, 6 kg ≈ 2 500, bouteille neuve 12,5 kg ≈ 22 000. Ils sont légèrement plus élevés à Bobo et Banfora.

Les noms des distributeurs, les prix et les positions GPS des dépôts sont des exemples : remplacez-les par les vrais avant le lancement. Les autres villes n'ont pas encore de distributeur. Un distributeur qui s'inscrit les ajoute dans « Villes ».

Pour repartir de zéro en local, supprimez le dossier `.data/db`.

La carte utilise Leaflet et les fonds OpenStreetMap, chargés depuis Internet. Sans connexion, la recherche fonctionne sans carte.

Mot de passe de tous les comptes de démonstration : **`demo1234`**

| Email | Rôle |
|---|---|
| `client@demo.app` | Client (Ouagadougou) |
| `admin@fasogaz.bf` | Distributeur Faso Gaz Express (Ouagadougou, Bobo-Dioulasso, Banfora) |
| `livreur@fasogaz.bf` | Livreur à Ouagadougou |
| `livreur2@fasogaz.bf` | Livreur à Bobo-Dioulasso |
| `admin@kadiogogaz.bf` | Distributeur Kadiogo Gaz (Ouagadougou) |
| `admin@gazduhouet.bf` | Distributeur Gaz du Houet (Bobo-Dioulasso) |
| `admin@koudougougaz.bf` | Distributeur Koudougou Gaz Services (Koudougou) |
| `super@gazflow.app` | Opérateur plateforme |

### Variables d'environnement
| Variable | Rôle | Par défaut |
|---|---|---|
| `PORT` | Port HTTP | `3000` |
| `DATABASE_URL` | Postgres de production (VPS, Coolify). Les migrations sont appliquées au démarrage. | base embarquée locale |
| `AUTH_SECRET` | Secret de signature des sessions. **Obligatoire en production.** | secret de développement |
| `MIGRATIONS` | `off` pour ne pas appliquer les migrations au démarrage | appliquées |

## Mise en ligne

**Sur un VPS avec Coolify** : voir **[DEPLOIEMENT.md](DEPLOIEMENT.md)**. Le dépôt contient un `Dockerfile` et un `docker-compose.yml` (application + Postgres 17), testés : démarrage, migrations, parcours complet, redéploiement sans perte de données.

Une configuration Netlify (`netlify.toml`, `netlify/server/`) est aussi présente, au cas où.

## Architecture

```
src/
  server.js   démarrage
  app.js      API REST Express (auth, recherche, demandes, catalogue, commandes, espaces distributeur et plateforme)
  search.js   recherche tolérante aux fautes et calcul de distance GPS
  db.js       accès Postgres, transactions, migrations, offres d'abonnement
  auth.js     mots de passe (scrypt) et jetons signés (HMAC)
public/       interface web (HTML/CSS/JS sans framework, responsive, mode sombre)
  art.js      illustrations SVG animées
  img/        photos
test/         tests d'intégration de l'API (node:test, Postgres embarqué)
netlify/database/migrations/  schéma et données de démo (SQL)
Dockerfile, docker-compose.yml  déploiement sur VPS (Coolify)
```

**Isolation des données :** chaque requête est filtrée par le `tenant_id` de l'utilisateur. Un distributeur ne voit jamais les commandes d'un autre, et un livreur ne voit que les courses qui lui sont assignées.

**Stock :** il est décrémenté dans une transaction, avec une condition `stock >= quantité`. Deux clients ne peuvent donc pas acheter la même dernière bouteille.

## Pistes pour la suite
- Paiement réel Orange Money et Moov Money (Burkina), par exemple via un agrégateur comme CinetPay, PayDunya ou Ligdicash
- Notifications SMS/WhatsApp à chaque changement de statut
- Géolocalisation du livreur en temps réel
- Stock par point de vente : aujourd'hui, la disponibilité affichée est celle du distributeur dans la ville
- Facturation automatique des abonnements
