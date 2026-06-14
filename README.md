# LCG Question Studio

Outil editorial partage pour preparer les questions du Cube Graphique.

Le Studio et le jeu restent deux applications independantes :

- le Studio stocke les cartes, validations, commentaires et historiques dans Supabase ;
- le jeu continue de lire ses propres fichiers `quiz.json` et `duels.json` ;
- l'export du Studio propose le fichier a generer, sans ecrire directement dans le jeu.

## Fonctionnement

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

Supabase fournit la base de donnees, l'authentification et le temps reel. Un projet gratuit suffit pour ce Studio.

1. Creer un projet sur [Supabase](https://supabase.com/dashboard).
2. Ouvrir `SQL Editor` dans le projet.
3. Executer tout le fichier [`supabase/schema.sql`](supabase/schema.sql).
4. Copier `.env.example` vers `.env.local`.
5. Renseigner les variables suivantes :

```env
VITE_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLIQUE
SUPABASE_SECRET_KEY=VOTRE_CLE_SECRETE
```

La cle publique se trouve dans les reglages API du projet. La cle secrete sert uniquement au script local de creation des comptes et ne doit jamais etre ajoutee a Netlify ou a Git.

Installer les dependances puis creer les deux comptes et le catalogue initial :

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

Le bootstrap peut etre relance sans recreer les comptes. Attention : il resynchronise le catalogue canonique, remet toutes les cartes en attente, efface les validations existantes et reinitialise les marqueurs d'export.

Apres un bootstrap reussi :

1. Verifier dans `Authentication > Users` que seuls Lucas et Awen existent.
2. Ouvrir la configuration Auth des fournisseurs de connexion.
3. Conserver la connexion Email active.
4. Desactiver `Allow new users to sign up`.
5. Laisser les connexions anonymes desactivees.

Cette fermeture des inscriptions est importante : les politiques de la base autorisent les utilisateurs authentifies, qui doivent donc rester limites aux deux comptes prevus.

## Developpement local

```bash
npm run dev
```

Le mode de previsualisation sans Supabase est disponible uniquement en developpement sur `?preview=1`. Il sert aux tests visuels et ne sauvegarde pas les modifications.

## Deploiement Netlify

Dans les variables d'environnement Netlify, ajouter seulement :

```env
VITE_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLIQUE
```

Ne jamais ajouter `SUPABASE_SECRET_KEY` a Netlify.

Le fichier `netlify.toml` configure :

- la commande `npm run build` ;
- le dossier publie `dist` ;
- Node.js 22.

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
