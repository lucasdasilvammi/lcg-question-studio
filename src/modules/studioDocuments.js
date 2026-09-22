export const STUDIO_DOCUMENT_KEYS = ['backlog', 'ideas', 'playtests', 'worklog']

export const STUDIO_SNAPSHOT_FORMAT = 'lcg-studio-snapshot'
export const STUDIO_SNAPSHOT_VERSION = 1

export function createWorkspaceSnapshot(state, exportedAt = new Date().toISOString()) {
  return {
    format: STUDIO_SNAPSHOT_FORMAT,
    version: STUDIO_SNAPSHOT_VERSION,
    exportedAt,
    modules: Object.fromEntries(
      STUDIO_DOCUMENT_KEYS.map((key) => [key, structuredClone(documentPayload(key, state))]),
    ),
  }
}

export function snapshotModules(snapshot) {
  if (snapshot?.format !== STUDIO_SNAPSHOT_FORMAT || snapshot?.version !== STUDIO_SNAPSHOT_VERSION) {
    throw new Error('Format de snapshot inconnu. Exporte une sauvegarde depuis LCG Studio.')
  }
  const modules = snapshot.modules
  const valid = Array.isArray(modules?.backlog?.tickets)
    && Array.isArray(modules?.backlog?.tags)
    && Array.isArray(modules?.ideas?.items)
    && Array.isArray(modules?.playtests?.sessions)
    && Array.isArray(modules?.worklog?.patches)
  if (!valid) throw new Error('Le snapshot ne contient pas les quatre modules attendus.')
  return modules
}
export function documentPayload(key, state) {
  if (key === 'backlog') return { tickets: state.backlog, tags: state.backlogTags, sources: state.backlogSources || [] }
  if (key === 'ideas') return { items: state.ideas }
  if (key === 'playtests') return { sessions: state.playtests }
  if (key === 'worklog') return { patches: state.worklogPatches }
  throw new Error(`Document Studio inconnu : ${key}`)
}

export function documentMap(rows = []) {
  return Object.fromEntries(rows.filter((row) => STUDIO_DOCUMENT_KEYS.includes(row.key)).map((row) => [row.key, row]))
}

export function missingDocumentKeys(rows = []) {
  const documents = documentMap(rows)
  return STUDIO_DOCUMENT_KEYS.filter((key) => !documents[key])
}

export function invalidDocumentKeys(rows = []) {
  const documents = documentMap(rows)
  const requiredArrays = { backlog: ['tickets', 'tags'], ideas: ['items'], playtests: ['sessions'], worklog: ['patches'] }
  return STUDIO_DOCUMENT_KEYS.filter((key) => documents[key] && !requiredArrays[key].every((field) => Array.isArray(documents[key].content?.[field])))
}

export function resolvedRevision(result) {
  const row = Array.isArray(result) ? result[0] : result
  const revision = Number(row?.revision)
  return Number.isFinite(revision) ? revision : null
}
