# Question Studio

Mini-site éditorial autonome pour préparer les questions du Cube Graphique.
Il ne communique pas avec l'application de jeu : le passage de données se fait
uniquement par fichiers CSV.

## Lancer le site

Depuis le dossier `question-studio` :

```bash
npm install
npm run dev
```

Les données sont enregistrées dans le `localStorage` du navigateur utilisé.
Sur un site Netlify, elles restent disponibles après un rechargement et
généralement après un redéploiement conservant le même domaine. Elles ne sont
cependant pas synchronisées entre navigateurs ou appareils et disparaissent si
les données du site sont effacées.

## Catalogue initial

Le site charge automatiquement 182 cartes :

- 128 questions existantes du jeu, déjà validées par Lucas et Awen et sourcées `Socle` ;
- 54 questions issues du livre, `En attente`, avec leur page source ;
- 3 questions par niveau demandé et par catégorie pour le nouveau lot.

Le fichier équivalent est disponible dans `data/questions-initiales.csv`.
Le catalogue peut être régénéré avec `npm run catalog`.

## Parcours conseillé

1. Filtrer et relire les fiches en attente.
2. Modifier les tags, la difficulté, les jalons et le contenu si nécessaire.
3. Passer les questions à reformuler en `En révision` et ajouter une note.
4. Cliquer sur `Exporter les révisions`, faire corriger ce CSV en conservant
   les identifiants, puis réimporter le fichier : les fiches existantes sont
   mises à jour.
5. Lucas ou Awen ajoute une première validation.
6. L'autre personne valide à son tour : la question passe alors en `Validée`.
7. Sélectionner les questions souhaitées et exporter les validées.

Chaque modification importante conserve la version précédente dans
`Historique`. Le bouton `Restaurer cette version` permet d'annuler une
modification ou une mise à jour importée.

## Actions du bandeau

- `Importer un CSV` ajoute un lot ou met à jour les cartes portant le même `id`.
- `Sauvegarder tout` exporte toutes les cartes avec leurs états, notes et dates.
- `Exporter les révisions` produit le fichier à transmettre à l'IA avec tes notes.
- `Exporter les validées` produit le lot final, sans connexion directe au jeu.
- `Créer une question` ajoute manuellement une carte sans passer par un CSV.

Pour restaurer une sauvegarde complète, il suffit de réimporter son CSV. Pour
reprendre le travail avec une IA, transmets-lui cette sauvegarde : elle contient
l'état éditorial complet du site.

## Déploiement Netlify

Le fichier `netlify.toml` configure automatiquement :

- la commande de build : `npm run build` ;
- le dossier publié : `dist` ;
- Node.js 20.

Après avoir connecté le dépôt GitHub dans Netlify, aucune configuration
supplémentaire n'est nécessaire.

## États

- `pending` : En attente
- `review` : En révision
- `approved` : Validation croisée, approuvée par Lucas ou Awen
- `validated` : Validée par Lucas et Awen

Le bouton `Valider` demande qui effectue la validation. Une question ne peut
être exportée dans le lot final qu'après les deux validations. Toute
modification du contenu ou passage en révision annule les validations
précédentes.

Une suppression efface réellement la fiche après confirmation. Il n'existe pas
d'état `refused`, afin d'éviter deux notions ayant le même usage.

## Format CSV

Le fichier doit être encodé en UTF-8 et utiliser une virgule comme séparateur.
Les listes internes emploient ` | `.

| Colonne | Description |
| --- | --- |
| `id` | Identifiant stable. À conserver lors d'une reformulation. |
| `question` | Intitulé affiché au joueur. |
| `answer` | Bonne réponse. |
| `wrong_answers` | Deux mauvaises réponses pour Quiz/Buzzer, une pour Vrai/Faux, aucune pour Chiffres. |
| `explanation` | Explication affichable après la réponse. |
| `category` | Catégorie éditoriale. |
| `difficulty` | Pour les nuls, Facile, Moyen, Difficile ou Expert. |
| `milestones` | Nombre de jalons gagnés. |
| `mode` | Quiz ou Défi. |
| `challenge_type` | `Aucun` pour un Quiz ; Buzzer, Vrai/Faux ou Chiffres pour un Défi. |
| `status` | `pending`, `review`, `approved` ou `validated`. |
| `tags` | Tags libres séparés par ` | `. |
| `source` | Livre, lot ou document source. |
| `source_page` | Page source. |
| `revision_notes` | Consignes de reformulation destinées à l'IA. |
| `favorite` | `true` ou `false`. |
| `confidence` | Indice de confiance entre 0 et 1. |
| `lucas_validation` | Date ISO de validation par Lucas, ou vide. |
| `awen_validation` | Date ISO de validation par Awen, ou vide. |
| `created_at` | Date ISO de création. |
| `updated_at` | Date ISO de dernière modification. |

Pour une mise à jour par IA, celle-ci doit conserver la colonne `id`, modifier
les champs demandés, puis rendre le CSV avec les mêmes colonnes. La réimportation
fusionnera chaque ligne avec sa fiche et ajoutera l'opération à son historique.
