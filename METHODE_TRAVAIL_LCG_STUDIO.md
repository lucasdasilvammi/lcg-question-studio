# Methode de travail - LCG Studio

Ce document sert de reference pendant la creation de LCG Studio. L'objectif est d'avancer vite sans eparpiller le code ni melanger les chantiers.

## Principe general

LCG Studio doit devenir un outil interne pour suivre la creation du jeu de societe jusqu'a sa sortie. Pour l'instant, l'application reste en donnees fictives par defaut, sans Supabase. Les modules, les ecrans et les donnees sont maintenant stabilises. La connexion a la base existante se fait progressivement, apres export d'un snapshot et sauvegarde de Supabase.

On garde un chat principal qui pilote la vision globale, l'architecture, les arbitrages et l'integration. Les autres chats ou sous-agents servent uniquement quand un perimetre est clair et isole.

## Chat principal

Nom conseille : **refactor propre**

Role du chat principal :

- garder la coherence globale de LCG Studio ;
- refactorer proprement l'application avant d'ajouter trop de fonctionnalites ;
- separer les modules sans casser le Question Studio existant ;
- definir les donnees fictives communes ;
- verifier les builds apres chaque changement important ;
- garder une UI coherente entre backlog, Question Studio, playtests et worklog.

Le chat principal doit rester responsable de l'integration finale. Les autres chats ne doivent pas modifier les memes fichiers en parallele sans consigne claire.

## Version locale canonique

- Le dossier principal `LCG Studio` est la source de verite.
- `npm run dev` y sert l'application uniquement sur `http://localhost:5174/`.
- Un chat travaillant dans un worktree ne met pas automatiquement a jour le serveur du dossier principal.
- Apres chaque chantier isole, le chat principal integre les changements, execute `npm run build`, puis controle `5174`.
- On termine l'integration d'un chantier avant d'en ouvrir un autre qui touche les memes fichiers.

## Ordre de travail recommande

1. Stabiliser la base actuelle

- conserver le mode donnees fictives par defaut ;
- supprimer les restes du dashboard inutile ;
- garder le backlog/kanban comme premier ecran ;
- verifier que le Question Studio fonctionne toujours.

2. Refactorer en modules

Structure cible :

```txt
src/
  app/
    state.js
    render.js
    actions.js
  data/
    mockData.js
  modules/
    backlog/
      backlog.js
      backlog.css
    questions/
      questions.js
      questions.css
    playtests/
      playtests.js
      playtests.css
    worklog/
      worklog.js
      worklog.css
```

Cette structure peut etre adaptee si le code existant impose une organisation plus simple, mais l'idee reste de sortir progressivement le gros fichier principal.

3. Construire les modules un par un

- Backlog/Kanban : tickets, colonnes, priorites, responsables, tags, filtres.
- Question Studio : garder l'existant, puis l'isoler proprement.
- Playtests : sessions, date, lieu, joueurs, notes, liens Drive, problemes observes.
- Worklog : historique des versions, changements faits, references aux commits ou fichiers de changelog.

4. Brancher les donnees plus tard

Tant que les ecrans changent beaucoup, on reste sur `mockData.js`. Supabase sera utile seulement quand :

- le modele de donnees est clair ;
- les workflows sont valides ;
- Awen et Lucas savent vraiment quelles informations doivent etre partagees ;
- les formulaires principaux sont stabilises.

## Utilisation des chats et sous-agents

Au debut, ne pas ouvrir quatre grands chats qui codent tous en parallele. Le risque est de creer des conflits ou des styles differents dans le meme code.

Utilisation conseillee :

- 1 chat principal : architecture, refactor, integration, build.
- 1 chat par module seulement quand le dossier du module est bien isole.
- Sous-agents pour audit, revue responsive, recherche de bugs, ou proposition de structure de donnees.

Exemples de sous-agents utiles :

- audit du backlog apres implementation ;
- verification mobile/desktop ;
- revue du modele de donnees fictives ;
- recherche de restes Supabase ou dashboard ;
- proposition de tickets pour le prochain sprint.

## Modeles conseilles

- Chat principal : GPT-5.6 Sol, raisonnement medium ou high.
- Refactor important ou arbitrage complexe : GPT-5.6 Sol en high.
- Sous-agent d'audit ou de revue : GPT-5.6 Terra en low ou medium.
- Petite tache repetable et bien cadree : GPT-5.6 Luna en low.

## Regles de qualite

- Appliquer les migrations Supabase de facon additive et ne jamais relancer le bootstrap destructif sur la base existante.
- Ne pas refaire le design global a chaque module.
- Ne pas creer de nouveau dashboard sans besoin clair.
- Ne pas melanger refactor lourd et nouvelle fonctionnalite dans le meme passage si ce n'est pas necessaire.
- Verifier `npm run build` apres chaque changement important.
- Garder les donnees fictives realistes, proches de l'usage Lucas/Owen.
- Faire evoluer le cahier des charges dans des fichiers Markdown du repo.
```
