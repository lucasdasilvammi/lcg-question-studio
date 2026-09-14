# Todo LCG Studio

Etat de preparation avant connexion de la base Supabase existante et publication Netlify.

## Termine dans le code

- Backlog/Kanban utilise comme ecran d'accueil, avec vues Priorite et Flux.
- Creation, edition, suppression, filtres et drag and drop des tickets.
- Gestion centralisee des tags et des sources.
- Modules Idees, Playtests et Worklog fonctionnels en mode local.
- Question Studio conserve avec validations, commentaires, historique et exports.
- Donnees fictives centralisees et mode local actif par defaut.
- Documents partages Supabase versionnes avec detection des conflits.
- Edition des profils partagee en mode Supabase.
- Export d'un snapshot JSON des quatre modules depuis le menu du compte.
- Initialisation non destructive de Supabase depuis un snapshot ou les mocks.
- Port local unique `5174`, build Netlify et en-tetes de securite.
- Tests automatises et audit des dependances sans vulnerabilite connue.

## Connexion Supabase

1. Exporter le snapshot depuis la version locale actuellement utilisee.
2. Sauvegarder la base Question Studio existante.
3. Creer `.env.local` avec l'URL, la cle publique et la cle secrete du projet.
4. Executer `supabase/studio-modules.sql` dans le SQL Editor.
5. Previsualiser l'import avec `npm run supabase:studio:plan -- --input="CHEMIN.json"`.
6. Initialiser les documents absents avec `npm run supabase:studio:apply:snapshot -- --input="CHEMIN.json"`.
7. Tester les comptes Lucas et Awen en parallele selon `docs/publication-checklist.md`.

## Publication

1. Relire les donnees partagees et les profils.
2. Faire une recette desktop et mobile des cinq modules.
3. Creer un commit de stabilisation sur le depot principal.
4. Configurer les trois variables publiques dans Netlify.
5. Deployer puis refaire la recette sur l'URL publique.

## Apres la premiere publication

- Deplacer les pieces jointes du Backlog vers Supabase Storage si leur usage augmente.
- Continuer l'extraction progressive de `src/main.js` et `src/styles.css` par module.
- Ajouter des tests navigateur automatises pour les parcours critiques.
- Decider si les snapshots doivent aussi pouvoir restaurer des documents deja existants.