# Checklist de publication LCG Studio

## 1. Base existante

1. Ouvrir le projet Supabase deja utilise par Question Studio.
2. Executer `supabase/studio-modules.sql` dans le SQL Editor.
3. Conserver les tables Question Studio existantes : la migration ajoute uniquement les champs de profil et `studio_documents`.
4. Depuis le menu du compte en mode local, utiliser `Sauvegarder les donnees` et conserver le snapshot JSON.
5. Lancer `npm run supabase:studio:plan -- --input="CHEMIN_DU_SNAPSHOT.json"` pour verifier la source et les documents absents, sans ecriture.
6. Apres sauvegarde de la base, lancer `npm run supabase:studio:apply:snapshot -- --input="CHEMIN_DU_SNAPSHOT.json"`. Cette commande insere seulement les documents absents.

Pour repartir volontairement des donnees fictives du code, utiliser `npm run supabase:studio:apply:mock` a la place.

Ne pas lancer `npm run supabase:bootstrap` sur cette base existante : il reinitialise les validations et les marqueurs d'export de Question Studio.

## 2. Donnees a valider

- Ouvrir le snapshot JSON et verifier le backlog, les tags, les idees, les playtests et le Worklog avant l'initialisation.
- Le Worklog est initialise avec `0.0.0 - POC`, ferme, et 300 h reportees.
- Les pieces jointes du backlog restent integrees au document JSON. Avant un usage intensif, elles devront passer dans Supabase Storage.

## 3. Recette partagee

- Se connecter avec Lucas dans un navigateur et Awen dans un autre.
- Creer, deplacer, modifier puis supprimer un ticket et verifier le rafraichissement de l'autre navigateur.
- Creer et modifier une idee.
- Planifier un playtest, le passer a documenter, annuler ce passage, puis terminer son compte rendu.
- Modifier avatar, couleur et nom de chaque profil.
- Creer un patch Worklog, ouvrir et fermer deux sessions, exporter puis reimporter le `.md`.
- Provoquer volontairement deux modifications simultanees du meme module et verifier le message de conflit.
- Verifier Question Studio : validation croisee, commentaires, historique, corbeille et exports.

## 4. Netlify

Configurer sur le site Netlify existant :

```env
VITE_USE_SUPABASE=true
VITE_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=VOTRE_CLE_PUBLIQUE
```

Ne jamais configurer `SUPABASE_SECRET_KEY` sur Netlify. Publier le commit stabilise, verifier les headers de securite, puis refaire la recette sur l'URL publique.

## 5. Validation finale

```bash
npm ci
npm test
npm run build
```

La publication est validee quand les tests passent, que les deux comptes partagent les memes donnees et qu'aucune operation courante ne repose encore sur le `localStorage` en mode Supabase.
