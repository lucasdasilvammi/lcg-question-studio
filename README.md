# LCG Studio

Outil interne pour piloter la creation du Cube Graphique. Le backlog/kanban est l'ecran d'accueil et Question Studio reste le module de production des questions.

Le Studio et le jeu restent deux applications independantes :

- le Studio stocke les cartes, validations, commentaires et historiques dans Supabase ;
- le jeu continue de lire ses propres fichiers `quiz.json` et `duels.json` ;
- l'export du Studio propose le fichier a generer, sans ecrire directement dans le jeu.

## Fonctionnement

- Le mode local demarre en donnees fictives par defaut, sans Supabase.
- Le backlog/kanban est l'ecran d'accueil.
- En mode local, Backlog, Idees, Playtests, profils et Worklog utilisent des donnees fictives conservees dans le navigateur.
- En mode Supabase, ces modules sont partages dans des documents JSON versionnes avec detection des conflits.
- Deux comptes fixes : `Lucas` et `Awen`.
- Les deux utilisateurs voient les memes donnees en temps reel.
- Une carte devient `Validee` uniquement apres les deux validations.
- Une validation peut etre retiree.
- Une carte peut repasser en attente ou en revision dans n'importe quel ordre.
- Les modifications importantes sont conservees dans l'historique avec un diff visuel.
- Chaque carte possede un fil de commentaires avec mentions.
- La suppression place la carte dans une corbeille restaurable.
- Les cartes deja exportees sont identifiees, ainsi que celles modifiees depuis leur dernier export.

## Installer Supabase

Supabase est optionnel pour cette phase. Par defaut, l'application reste en mode prototype local. Pour reconnecter la base, l'authentification et le temps reel, definir explicitement `VITE_USE_SUPABASE=true` avec les variables Supabase. Un projet gratuit suffit pour ce Studio.

1. Pour une nouvelle installation seulement, creer un projet sur [Supabase](https://supabase.com/dashboard).
2. Ouvrir `SQL Editor` dans le projet.
3. Sur un projet neuf, executer tout le fichier [`supabase/schema.sql`](supabase/schema.sql). Ne pas le rejouer sur la base Question Studio existante.
4. Executer [`supabase/studio-modules.sql`](supabase/studio-modules.sql). Cette migration conserve les questions et ajoute les nouveaux modules.
5. Copier `.env.example` vers `.env.local`.
6. Renseigner les variables suivantes :

```env
VITE_USE_SUPABASE=true
VITE_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLIQUE
SUPABASE_SECRET_KEY=VOTRE_CLE_SECRETE
```

La cle publique se trouve dans les reglages API du projet. La cle secrete sert uniquement au script local de creation des comptes et ne doit jamais etre ajoutee a Netlify ou a Git.

Sur un projet neuf uniquement, installer les dependances puis creer les deux comptes et le catalogue initial :

```bash
npm install
npm run supabase:bootstrap
```

Le script affiche les mots de passe generes pour Lucas et Awen. Les identifiants visibles sur la page de connexion sont simplement `Lucas` et `Awen`.

Pour choisir les mots de passe avant l'initialisation, ajouter dans `.env.local` :

```env
LUCAS_PASSWORD=un-mot-de-passe-solide
AWEN_PASSWORD=un-autre-mot-de-passe-solide
```

Il est recommande de definir ces deux mots de passe avant le premier lancement et de les conserver dans un gestionnaire de mots de passe.

Ne pas relancer le bootstrap sur la base existante. Meme sans recreer les comptes, il resynchronise le catalogue canonique, remet toutes les cartes en attente, efface les validations existantes et reinitialise les marqueurs d'export.

Sur la base Question Studio existante, apres la migration SQL et avec les deux profils deja presents, inspecter les documents manquants puis, seulement si les donnees fictives conviennent, les initialiser :

```bash
npm run supabase:studio:plan
npm run supabase:studio:apply
```

La sauvegarde se telecharge depuis le menu du compte avec `Sauvegarder les donnees`. La commande `plan` ne modifie rien. La commande `apply:snapshot` valide le format puis insere uniquement les documents absents. Pour utiliser volontairement les donnees fictives du code, la commande distincte est `npm run supabase:studio:apply:mock`.

Apres un bootstrap reussi :

1. Verifier dans `Authentication > Users` que seuls Lucas et Awen existent.
2. Ouvrir la configuration Auth des fournisseurs de connexion.
3. Conserver la connexion Email active.
4. Desactiver `Allow new users to sign up`.
5. Laisser les connexions anonymes desactivees.

Cette fermeture des inscriptions est importante : les politiques de la base autorisent les utilisateurs authentifies, qui doivent donc rester limites aux deux comptes prevus.

## Developpement local

Le serveur de developpement canonique utilise toujours `http://localhost:5174/` :

```bash
npm run dev
```

Le port est configure en mode strict. Si `5174` est deja utilise, Vite s'arrete avec une erreur au lieu de lancer une autre version sur un autre port. Il faut alors fermer l'ancien serveur avant de relancer la commande depuis le dossier principal du projet.

Un serveur Vite ne rassemble pas automatiquement plusieurs worktrees. Toute fonctionnalite developpee dans un chat isole doit etre integree au dossier principal, puis validee avec `npm run build`, avant d'etre consideree comme disponible sur `5174`.

Le mode prototype sans Supabase est le comportement par defaut tant que `VITE_USE_SUPABASE` n'est pas defini a `true`. Il conserve les modifications dans le `localStorage` du navigateur, mais elles ne sont pas partagees entre appareils. Le parametre `?preview=1` force aussi ce mode en developpement.
## Modules partages

La migration `supabase/studio-modules.sql` ajoute un document versionne pour chacun des modules `backlog`, `ideas`, `playtests` et `worklog`. Les ecritures verifient la revision connue par le navigateur. Une modification concurrente provoque un rechargement de la version partagee au lieu d'un ecrasement silencieux.

Les scripts `supabase:studio:apply:snapshot` et `supabase:studio:apply:mock` initialisent uniquement les documents absents et ne remplacent pas les donnees partagees existantes. Le profil conserve aussi le nom, le role, l'avatar et la palette choisis.

La recette de mise en ligne est detaillee dans [`docs/publication-checklist.md`](docs/publication-checklist.md).
## Deploiement Netlify

Dans les variables d'environnement Netlify, ajouter seulement :

```env
VITE_USE_SUPABASE=true
VITE_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLIQUE
```

Ne jamais ajouter `SUPABASE_SECRET_KEY` a Netlify.

Le fichier `netlify.toml` configure :

- la commande `npm run build` ;
- le dossier publie `dist` ;
- Node.js 22.

## Import Pyramide QCM

Les questions extraites des cartes Pyramide QCM sont versionnees dans :

```text
data/pyramide-qcm-questions.json
```

Elles sont importees dans Supabase avec la source `pyramide QCM`, le type `Quiz`, le statut `En attente` et sans validation Lucas/Awen.

Avant import, verifier que `.env.local` contient :

```env
VITE_USE_SUPABASE=true
VITE_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_SECRET_KEY=VOTRE_CLE_SECRETE
```

Puis lancer une simulation :

```bash
npm run supabase:import:pyramide:dry-run
```

Si le resume est correct, lancer l'import :

```bash
npm run supabase:import:pyramide
```

Cette commande ne relance pas le bootstrap initial et ne vide pas les validations existantes. Elle ajoute ou resynchronise uniquement les questions dont l'identifiant commence par `PYRAMIDE-QCM-`.

Un redeploiement Netlify n'est pas necessaire pour voir ces questions si le Studio pointe deja vers la meme base Supabase. Netlify sert seulement l'interface ; les cartes viennent de Supabase.

## Exports du jeu

Le bouton `Exporter` ouvre un choix :

- `quiz.json` contient uniquement les questions Quiz validees ;
- `duels.json` contient les defis Buzzer, Vrai/Faux et Chiffres valides.

Chaque export est un instantane complet des questions validees du type choisi. Il est donc destine a remplacer directement le fichier correspondant dans le jeu :

```text
server/data/quiz.json
server/data/duels.json
```

Les metadonnees propres au Studio, comme la source, la page du livre, les commentaires et les dates editoriales, ne sont pas envoyees au jeu. Le defi Zoom deja present dans `duels.json` est conserve dans le fichier genere ; le Studio ne permet pas de creer de cartes Zoom ou Pique.

## Etats

- `En attente` : carte a relire ou a valider.
- `En revision` : carte qui demande une correction ou une reformulation.
- `Validation simple` : un seul des deux comptes a valide la carte.
- `Validee` : Lucas et Awen ont tous les deux valide la carte.
- `Corbeille` : carte masquee des listes normales, restaurable tant que la corbeille n'est pas videe.

Une modification editoriale ou un retour en attente/revision retire les validations existantes afin que la nouvelle version soit relue.

## Catalogue initial

Le bootstrap charge 182 cartes :

- 164 questions Quiz ;
- 18 defis : 4 Buzzer, 8 Vrai/Faux et 6 Chiffres.

Les 182 cartes sont toutes chargees en `En attente`, sans validation Lucas/Awen et sans marqueur d'export. Elles doivent donc toutes etre relues et validees par les deux comptes.

L'ancien stockage `localStorage` n'est pas synchronise avec Supabase. Le bootstrap utilise le catalogue canonique versionne dans le depot.
