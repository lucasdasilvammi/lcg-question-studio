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
})