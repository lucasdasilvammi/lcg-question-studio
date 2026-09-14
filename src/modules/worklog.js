export const WORKLOG_STORAGE_KEY = 'lcg-worklog-patches-v1'
export const POC_BASELINE_MINUTES = 300 * 60

const FORMAT = 'lcg-worklog/v1'
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

export function normalizePatch(value) {
  if (!value || typeof value !== 'object' || value.format !== FORMAT) throw new Error('Format de patch non reconnu.')
  const version = String(value.version || '').trim()
  const title = String(value.title || '').trim()
  if (!VERSION_PATTERN.test(version)) throw new Error('La version doit suivre le format 0.1.0.')
  if (!title) throw new Error('Le nom du patch est requis.')
  if (!Array.isArray(value.sessions) || !Array.isArray(value.changes)) throw new Error('Sessions ou changements invalides.')
  const sessions = value.sessions.map((session) => {
    const startedAt = String(session?.startedAt || '')
    const endedAt = session?.endedAt ? String(session.endedAt) : null
    const start = Date.parse(startedAt)
    const end = endedAt ? Date.parse(endedAt) : null
    if (!Number.isFinite(start) || (endedAt && (!Number.isFinite(end) || end < start))) {
      throw new Error('Horodatage de session invalide.')
    }
    return { startedAt, endedAt }
  })
  if (sessions.filter((session) => !session.endedAt).length > 1) throw new Error('Plusieurs sessions sont ouvertes.')
  if (sessions.some((session, index) => !session.endedAt && index !== sessions.length - 1)) {
    throw new Error('Une session ouverte doit être la dernière.')
  }
  const status = value.status === 'released' ? 'released' : 'draft'
  if (status === 'released' && sessions.some((session) => !session.endedAt)) throw new Error('Un patch clos ne peut pas avoir une session ouverte.')
  return {
    format: FORMAT,
    id: String(value.id || '').trim() || `patch-${version}`,
    version,
    title,
    status,
    summary: String(value.summary || '').trim(),
    initialMinutes: Math.max(0, Number(value.initialMinutes) || 0),
    changes: value.changes.map((item) => String(item).trim()).filter(Boolean),
    sessions,
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || value.createdAt || new Date().toISOString()),
  }
}

export function createPatch(version, title, now = new Date().toISOString()) {
  return normalizePatch({ format: FORMAT, id: `patch-${version}`, version, title, status: 'draft', summary: '', initialMinutes: 0, changes: [], sessions: [], createdAt: now, updatedAt: now })
}

export function createPocPatch() {
  return normalizePatch({
    format: FORMAT,
    id: 'patch-0.0.0',
    version: '0.0.0',
    title: 'POC',
    status: 'released',
    summary: '',
    initialMinutes: POC_BASELINE_MINUTES,
    changes: [],
    sessions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}
export function activeSession(patch) {
  return patch.sessions.find((session) => !session.endedAt) || null
}

export function startSession(patch, now = new Date().toISOString()) {
  if (patch.status === 'released') throw new Error('Ce patch est clos.')
  if (activeSession(patch)) throw new Error('Une session est déjà en cours.')
  return normalizePatch({ ...patch, sessions: [...patch.sessions, { startedAt: now, endedAt: null }], updatedAt: now })
}

export function endSession(patch, now = new Date().toISOString()) {
  if (!activeSession(patch)) throw new Error('Aucune session en cours.')
  const sessions = patch.sessions.map((session) => session.endedAt ? session : { ...session, endedAt: now })
  return normalizePatch({ ...patch, sessions, updatedAt: now })
}

export function patchMinutes(patch, now = null) {
  const milliseconds = patch.sessions.reduce((sum, session) => {
    const end = session.endedAt || now
    return end ? sum + Math.max(0, Date.parse(end) - Date.parse(session.startedAt)) : sum
  }, 0)
  return Math.max(0, Number(patch.initialMinutes) || 0) + Math.round(milliseconds / 60000)
}

export function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(minutes))
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`
}

export function serializePatchMarkdown(patch) {
  const current = normalizePatch(patch)
  const changes = current.changes.length ? current.changes.map((change) => `- ${change}`).join('\n') : '- A renseigner'
  const sessions = current.sessions.length
    ? current.sessions.map((session) => `| ${session.startedAt} | ${session.endedAt || 'En cours'} | ${formatMinutes(patchMinutes({ sessions: [session] }))} |`).join('\n')
    : '| Aucune session | | |'
  const reported = current.initialMinutes ? `\nTemps initial reporte : ${formatMinutes(current.initialMinutes)}\n` : ''
  return `# ${current.version} - ${current.title}\n\nStatut : ${current.status === 'released' ? 'Clos' : 'En cours'}\n${reported}\n## Resume\n\n${current.summary || 'A renseigner'}\n\n## Changements\n\n${changes}\n\n## Sessions\n\n| Debut (ISO) | Fin (ISO) | Duree |\n| --- | --- | --- |\n${sessions}\n\n**Temps du patch : ${formatMinutes(patchMinutes(current))}**\n\n<!-- lcg-worklog:v1 ; les donnees JSON ci-dessous font foi pour la reimportation -->\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\`\n`
}

export function parsePatchMarkdown(markdown) {
  const marker = '<!-- lcg-worklog:v1'
  const start = markdown.indexOf(marker)
  if (start < 0) throw new Error('Ce Markdown ne contient pas de patch LCG importable.')
  const match = markdown.slice(start).match(/```json\s*([\s\S]*?)\s*```/)
  if (!match) throw new Error('Bloc JSON du patch introuvable.')
  try {
    return normalizePatch(JSON.parse(match[1]))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Bloc JSON du patch invalide.')
    throw error
  }
}
