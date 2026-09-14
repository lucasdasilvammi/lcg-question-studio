# 0.1.0 - Nom du patch

Statut : En cours

## Resume

Objectif et resultat principal du patch.

## Changements

- Premier changement
- Deuxieme changement

## Sessions

Les sessions sont ajoutees automatiquement par les boutons Debut de session et Fin de session du Worklog.

| Debut (ISO) | Fin (ISO) | Duree |
| --- | --- | --- |
| 2026-09-14T08:00:00.000Z | 2026-09-14T09:30:00.000Z | 1 h 30 min |

**Temps du patch : 1 h 30 min**

> Le fichier reel exporte par LCG Studio contient aussi un bloc JSON structure qui permet sa reimportation fiable.

<!-- lcg-worklog:v1 ; les donnees JSON ci-dessous font foi pour la reimportation -->
```json
{
  "format": "lcg-worklog/v1",
  "id": "patch-0.1.0",
  "version": "0.1.0",
  "title": "Nom du patch",
  "status": "draft",
  "summary": "Objectif et resultat principal du patch.",
  "initialMinutes": 0,
  "changes": [
    "Premier changement",
    "Deuxieme changement"
  ],
  "sessions": [
    {
      "startedAt": "2026-09-14T08:00:00.000Z",
      "endedAt": "2026-09-14T09:30:00.000Z"
    }
  ],
  "createdAt": "2026-09-14T08:00:00.000Z",
  "updatedAt": "2026-09-14T09:30:00.000Z"
}
```