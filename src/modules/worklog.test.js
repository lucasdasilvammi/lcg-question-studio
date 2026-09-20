import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPatch, createPocPatch, endSession, formatMinutes, parsePatchMarkdown, patchMinutes, serializePatchMarkdown, startSession } from './worklog.js'
import { worklogCreateModalMarkup, worklogViewMarkup } from './worklogView.js'

test('session time is derived from timestamps, including multiple sessions', () => {
  let patch = createPatch('0.1.0', 'Premier patch', '2026-09-14T08:00:00.000Z')
  patch = startSession(patch, '2026-09-14T08:00:00.000Z')
  patch = endSession(patch, '2026-09-14T09:30:00.000Z')
  patch = startSession(patch, '2026-09-15T10:00:00.000Z')
  assert.equal(patchMinutes(patch), 90)
  assert.equal(patchMinutes(patch, '2026-09-15T10:45:00.000Z'), 135)
  patch = endSession(patch, '2026-09-15T10:45:00.000Z')
  assert.equal(formatMinutes(patchMinutes(patch)), '2 h 15 min')
})

test('markdown round trip preserves patch sessions and notes', () => {
  let patch = createPatch('1.0.0', 'Lancement', '2026-09-14T08:00:00.000Z')
  patch = startSession(patch, '2026-09-14T08:00:00.000Z')
  patch = endSession(patch, '2026-09-14T08:23:00.000Z')
  patch = { ...patch, summary: 'Navigation finale', changes: ['Nouvelle sidebar', 'Correction Playtest'] }
  assert.deepEqual(parsePatchMarkdown(serializePatchMarkdown(patch)), patch)
})

test('invalid or overlapping session states are rejected', () => {
  const patch = startSession(createPatch('0.2.0', 'Essai'), '2026-09-14T08:00:00.000Z')
  assert.throws(() => startSession(patch, '2026-09-14T09:00:00.000Z'))
  assert.throws(() => endSession(patch, '2026-09-14T07:00:00.000Z'))
  assert.throws(() => parsePatchMarkdown('# Simple note'))
})

test('worklog view exposes the patch workflow', () => {
  const patch = createPatch('0.3.0', 'Worklog')
  const markup = worklogViewMarkup({ worklogPatches: [patch, createPocPatch()], worklogSelectedId: patch.id, worklogFileId: null }, String)
  assert.match(markup, /Début de session/)
  assert.match(markup, /Importer un \.md/)
  assert.match(markup, /300 h/)
  assert.match(worklogCreateModalMarkup(), /Télécharger le modèle \.md/)
})
test('POC is represented as a 300 hour historical patch', () => {
  const poc = createPocPatch()
  assert.equal(poc.version, '0.0.0')
  assert.equal(poc.status, 'released')
  assert.equal(patchMinutes(poc), 18000)
})
test('downloadable template can be imported', () => {
  const template = readFileSync(new URL('../../public/templates/worklog-patch-template.md', import.meta.url), 'utf8')
  const patch = parsePatchMarkdown(template)
  assert.equal(patch.version, '0.1.0')
  assert.equal(patchMinutes(patch), 90)
  assert.equal(patch.sessions[0].description, 'Mise en place du workflow')
})

test('readable markdown without JSON imports rich content and session descriptions', () => {
  const markdown = `# 0.1.0 - Consolidation V1

Statut : Terminé

## Resume

Une base plus sûre et maintenable.

## Changements

### Sécurité

- Validation des commandes.
- Protection des réponses privées.

## Sessions

| Debut (ISO) | Fin (ISO) | Duree | Objet |
| --- | --- | --- | --- |
| 2026-09-17T22:39:00+02:00 | 2026-09-17T23:14:00+02:00 | 35 min | Mise en place du workflow V1 |

Répartition synthétique du travail.`
  const patch = parsePatchMarkdown(markdown)
  assert.equal(patch.status, 'released')
  assert.equal(patch.sessions[0].description, 'Mise en place du workflow V1')
  assert.match(patch.contentMarkdown, /### Sécurité/)
  assert.equal(patch.sessionNotesMarkdown, 'Répartition synthétique du travail.')
})

test('worklog renders in reading mode before explicit editing', () => {
  const patch = parsePatchMarkdown(`# 0.2.0 - Lecture\n\nStatut : Terminé\n\n## Resume\n\nLecture seule.\n\n## Sessions\n\n| Debut (ISO) | Fin (ISO) | Duree | Objet |\n| --- | --- | --- | --- |\n| 2026-09-17T22:39:00+02:00 | 2026-09-17T23:14:00+02:00 | 35 min | Workflow V1 |`)
  const reading = worklogViewMarkup({ worklogPatches: [patch], worklogSelectedId: patch.id, worklogFileId: null, worklogEditingId: null }, String)
  assert.match(reading, /Modifier le patch/)
  assert.match(reading, /worklog-patch-reader/)
  assert.doesNotMatch(reading, /id="worklog-patch-notes"/)
  const editing = worklogViewMarkup({ worklogPatches: [patch], worklogSelectedId: patch.id, worklogFileId: null, worklogEditingId: patch.id }, String)
  assert.match(editing, /id="worklog-patch-notes"/)
})

test('visible rich content enriches an older structured JSON block', () => {
  const visible = `# 0.4.0 - Patch enrichi\n\nStatut : Terminé\n\n## Resume\n\nContenu détaillé.\n\n## Sessions\n\n| Debut (ISO) | Fin (ISO) | Duree | Objet |\n| --- | --- | --- | --- |\n| 2026-09-17T22:39:00+02:00 | 2026-09-17T23:14:00+02:00 | 35 min | Workflow V1 |`
  const oldPatch = createPatch('0.4.0', 'Patch enrichi', '2026-09-17T22:39:00+02:00')
  oldPatch.status = 'released'
  oldPatch.sessions = [{ startedAt: '2026-09-17T22:39:00+02:00', endedAt: '2026-09-17T23:14:00+02:00' }]
  delete oldPatch.contentMarkdown
  delete oldPatch.sessionNotesMarkdown
  const markdown = `${visible}\n\n<!-- lcg-worklog:v1 -->\n\`\`\`json\n${JSON.stringify(oldPatch)}\n\`\`\``
  const patch = parsePatchMarkdown(markdown)
  assert.match(patch.contentMarkdown, /Contenu détaillé/)
  assert.equal(patch.sessions[0].description, 'Workflow V1')
})
