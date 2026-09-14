import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWorkspaceSnapshot, documentMap, documentPayload, invalidDocumentKeys, missingDocumentKeys, resolvedRevision, snapshotModules } from './studioDocuments.js'

test('module state is serialized into isolated documents', () => {
  const state = { backlog: [{ id: 'LCG-1' }], backlogTags: [{ name: 'App' }], ideas: [{ id: 'I-1' }], playtests: [], worklogPatches: [] }
  assert.deepEqual(documentPayload('backlog', state), { tickets: state.backlog, tags: state.backlogTags })
  assert.deepEqual(documentPayload('ideas', state), { items: state.ideas })
  assert.throws(() => documentPayload('unknown', state))
})

test('workspace snapshot round trip preserves every shared module', () => {
  const state = {
    backlog: [{ id: 'LCG-1' }],
    backlogTags: [{ name: 'App' }],
    ideas: [{ id: 'I-1' }],
    playtests: [{ id: 'PT-1' }],
    worklogPatches: [{ id: 'P-1' }],
  }
  const snapshot = createWorkspaceSnapshot(state, '2026-09-14T12:00:00.000Z')
  assert.equal(snapshot.format, 'lcg-studio-snapshot')
  assert.equal(snapshot.version, 1)
  assert.deepEqual(snapshotModules(snapshot), snapshot.modules)
  assert.throws(() => snapshotModules({ ...snapshot, version: 2 }), /Format de snapshot inconnu/)
  assert.throws(() => snapshotModules({ ...snapshot, modules: {} }), /quatre modules attendus/)
})
test('database rows and rpc revisions are normalized', () => {
  const rows = [{ key: 'ideas', content: {}, revision: 2 }, { key: 'ignored', content: {} }]
  assert.deepEqual(documentMap(rows), { ideas: rows[0] })
  assert.equal(resolvedRevision({ revision: 4 }), 4)
  assert.equal(resolvedRevision([{ revision: 5 }]), 5)
  assert.equal(resolvedRevision(null), null)
  assert.deepEqual(missingDocumentKeys(rows), ['backlog', 'playtests', 'worklog'])
  assert.deepEqual(invalidDocumentKeys([{ key: 'backlog', content: { tickets: [] } }]), ['backlog'])
  assert.deepEqual(invalidDocumentKeys([{ key: 'ideas', content: { items: [] } }]), [])
})

test('studio document seed never modifies Question Studio tables', () => {
  const script = readFileSync(new URL('../../scripts/seed-studio-documents.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(script, /from\(['"]questions['"]\)/)
  assert.doesNotMatch(script, /question_approvals|export_batches|export_items/)
  assert.match(script, /from\('studio_documents'\)\.insert\(missingDocuments\)/)
})
test('Supabase migration includes revision checks and authenticated policies', () => {
  const sql = readFileSync(new URL('../../supabase/studio-modules.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.studio_documents/)
  assert.match(sql, /Studio document revision conflict/)
  assert.match(sql, /authenticated studio documents read/)
  assert.match(sql, /grant update \(display_name, role, avatar_key/)
  assert.match(sql, /revoke all on function public\.save_studio_document.+from public, anon/)
})