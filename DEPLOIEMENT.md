# Déployer GazFlow sur un VPS avec Coolify

GazFlow tourne dans deux conteneurs :
- **app** : le serveur Node.js (API + site) ;
- **db** : sa base Postgres 17, avec un volume pour garder les données.

[Coolify](https://coolify.io) les construit, les démarre, met le HTTPS (Let's Encrypt) et redéploie à chaque `git push`.

Le fichier `docker-compose.yml` du dépôt est prêt pour Coolify. Les mots de passe sont générés automatiquement.

---

## 1. Le VPS

- Ubuntu 22.04 ou 24.04, **2 vCPU et 4 Go de RAM** conseillés (Coolify + l'application), 40 Go de disque.
- Si possible un hébergeur en Europe (Paris, Francfort) : c'est le plus proche du Burkina pour la plupart des offres.
- Pare-feu : ouvrez les ports **22** (SSH), **80** et **443** (site), et **8000** (interface Coolify, le temps de l'installation).

## 2. Installer Coolify

Connecté en SSH au VPS :

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

Ouvrez ensuite `http://IP_DU_VPS:8000` et **créez immédiatement le compte administrateur** : le premier visiteur de cette page devient administrateur.

## 3. Le nom de domaine (AWS Route 53)

Dans la console AWS → **Route 53** → *Zones hébergées* → votre domaine → *Créer un enregistrement* :

| Nom | Type | Valeur |
|---|---|---|
| `gazflow` (ou vide pour le domaine principal) | A | IP du VPS |
| `coolify` (facultatif, pour l'interface d'admin) | A | IP du VPS |

La propagation prend de quelques minutes à une heure. Vérifiez avec `nslookup gazflow.votredomaine.com`.

## 4. Déployer l'application dans Coolify

1. **Sources** : connectez GitHub (*GitHub App*), en autorisant le dépôt `omzakrevo/Rencontre`.
2. **Projects → + Add → Resource** : choisissez le dépôt.
   - **Branche** : celle qui contient ce code (fusionnez-la dans `main` si vous préférez déployer `main`).
   - **Build Pack** : **Docker Compose**. Fichier : `/docker-compose.yml`.
3. Dans le service **app**, réglez **Domains** sur `https://gazflow.votredomaine.com`. Coolify obtient le certificat HTTPS tout seul.
4. Cliquez sur **Deploy**.

Au premier démarrage, l'application crée les tables et charge les **données de démonstration du Burkina**. Le mot de passe des comptes de démo est `demo1234`, voir le README.

**Vérifier** : `https://gazflow.votredomaine.com/api/health` doit répondre `{"ok":true}`.

### Variables d'environnement (générées par Coolify, visibles dans l'onglet *Environment Variables*)

| Variable | Rôle |
|---|---|
| `SERVICE_PASSWORD_64_AUTH` | Secret qui signe les connexions (`AUTH_SECRET`). **Ne le changez pas après la mise en ligne**, sinon tout le monde est déconnecté. |
| `SERVICE_USER_POSTGRES` / `SERVICE_PASSWORD_POSTGRES` | Identifiants de la base. |
| `MIGRATIONS=off` (facultatif) | Désactive l'application automatique des migrations au démarrage. |

## 5. Mises à jour

À chaque `git push` sur la branche suivie, Coolify reconstruit et redéploie. Pensez à activer *Auto Deploy* dans les réglages de la ressource.

- Les **nouvelles migrations** (fichiers `netlify/database/migrations/*.sql`, appliqués dans l'ordre) sont appliquées au démarrage, une seule fois.
- Les données sont conservées : elles sont dans le volume `gazflow-db`.

## 6. Sauvegardes (indispensable)

Les données des commandes sont dans le volume Postgres du VPS. Mettez en place une sauvegarde **hors du VPS** :
- Dans Coolify, regardez l'onglet **Backups** de la base. Coolify sait envoyer des sauvegardes planifiées vers un stockage S3, donc vers **AWS S3**.
- Sinon, une sauvegarde manuelle depuis le VPS :

```bash
docker exec $(docker ps -qf name=db) sh -c 'pg_dump -U "$POSTGRES_USER" gazflow' | gzip > gazflow-$(date +%F).sql.gz
```

Testez au moins une fois la restauration d'une sauvegarde avant d'ouvrir le site aux clients.

## 7. Avant d'ouvrir aux vrais clients

- Remplacez les distributeurs, prix et dépôts de démonstration par les vrais (depuis l'espace distributeur), ou supprimez les comptes de démo.
- Changez le mot de passe du compte opérateur `super@gazflow.app`.
- Fermez le port 8000 une fois l'interface Coolify accessible par son propre domaine en HTTPS.

## Sans Coolify (docker compose seul)

```bash
cp .env.example .env      # puis changez les mots de passe
docker compose up -d --build
```

Le fichier ne publie aucun port, car Coolify s'en charge. Sans Coolify, ajoutez au service `app` :

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

puis mettez un reverse proxy HTTPS (Caddy, Nginx…) devant `127.0.0.1:3000`.
