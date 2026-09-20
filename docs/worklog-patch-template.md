# Modele de patch Worklog

Un fichier `.md` correspond a un patch. Dans Worklog, cree le patch avec une version et un nom, puis utilise **Debut de session** et **Fin de session** a chaque plage de travail. Les horaires et la duree sont calcules automatiquement. Renseigne ensuite le resume et un changement par ligne.

Le fichier exporte ressemble a ceci :

```md
# 0.1.0 - Navigation et Playtests

Statut : En cours

## Resume

Navigation commune et preparation des sessions de test.

## Changements

- Ajout des icones de navigation
- Modification des Playtests en modale

## Sessions

| Debut (ISO) | Fin (ISO) | Duree |
| --- | --- | --- |
| 2026-09-14T08:00:00.000Z | 2026-09-14T09:30:00.000Z | 1 h 30 min |

**Temps du patch : 1 h 30 min**
```

L'application ajoute a la fin du vrai fichier un bloc JSON structure pour une reimportation fiable. Elle accepte aussi une note lisible qui suit ce format, puis ajoute le bloc structure au prochain export. La quatrieme colonne du tableau de sessions contient l'objet synthetique de chaque plage. Pour modifier un patch, utilise le bouton **Modifier le patch**, puis reexporte ou lie le fichier. Un debut sans fin reste une session ouverte et n'entre dans le total definitif qu'a la cloture.

Nomenclature proposee : `0.1.0` pour une evolution avant la V1, `0.1.1` pour un correctif, `1.0.0` pour la V1 nommee. Les 300 h du POC sont un point de depart estime, distinct des heures mesurees ensuite.
