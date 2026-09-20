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
    return { startedAt, endedAt, description: String(session?.description || '').trim() }
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
    contentMarkdown: String(value.contentMarkdown || '').trim(),
    sessionNotesMarkdown: String(value.sessionNotesMarkdown || '').trim(),
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
  const content = current.contentMarkdown || `## Resume\n\n${current.summary || 'A renseigner'}\n\n## Changements\n\n${changes}`
  const sessions = current.sessions.length
    ? current.sessions.map((session) => `| ${session.startedAt} | ${session.endedAt || 'En cours'} | ${formatMinutes(patchMinutes({ sessions: [session] }))} | ${session.description || ''} |`).join('\n')
    : '| Aucune session | | | |'
  const reported = current.initialMinutes ? `\nTemps initial reporte : ${formatMinutes(current.initialMinutes)}\n` : ''
  const sessionNotes = current.sessionNotesMarkdown ? `\n\n${current.sessionNotesMarkdown}` : ''
  return `# ${current.version} - ${current.title}\n\nStatut : ${current.status === 'released' ? 'Clos' : 'En cours'}\n${reported}\n${content}\n\n## Sessions\n\n| Debut (ISO) | Fin (ISO) | Duree | Objet |\n| --- | --- | --- | --- |\n${sessions}\n\n**Temps du patch : ${formatMinutes(patchMinutes(current))}**${sessionNotes}\n\n<!-- lcg-worklog:v1 ; les donnees JSON ci-dessous font foi pour la reimportation -->\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\`\n`
}

export function parsePatchMarkdown(markdown) {
  const marker = '<!-- lcg-worklog:v1'
  const start = markdown.indexOf(marker)
  if (start >= 0) {
    const match = markdown.slice(start).match(/```json\s*([\s\S]*?)\s*```/)
    if (!match) throw new Error('Bloc JSON du patch introuvable.')
    try {
      const raw = JSON.parse(match[1])
      const structured = normalizePatch(raw)
      const readable = parseReadablePatchMarkdown(markdown.slice(0, start))
      const readableSessions = new Map(readable.sessions.map((session) => [`${session.startedAt}|${session.endedAt || ''}`, session]))
      return normalizePatch({
        ...structured,
        contentMarkdown: Object.hasOwn(raw, 'contentMarkdown') ? structured.contentMarkdown : readable.contentMarkdown,
        sessionNotesMarkdown: Object.hasOwn(raw, 'sessionNotesMarkdown') ? structured.sessionNotesMarkdown : readable.sessionNotesMarkdown,
        sessions: structured.sessions.map((session, index) => ({
          ...session,
          description: Object.hasOwn(raw.sessions?.[index] || {}, 'description')
            ? session.description
            : readableSessions.get(`${session.startedAt}|${session.endedAt || ''}`)?.description || '',
        })),
      })
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Bloc JSON du patch invalide.')
      throw error
    }
  }
  return parseReadablePatchMarkdown(markdown)
}

function parseReadablePatchMarkdown(markdown) {
  const source = String(markdown || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  const heading = source.match(/^#\s+(\d+\.\d+\.\d+)\s+-\s+(.+)$/m)
  if (!heading) throw new Error('Titre de patch introuvable. Format attendu : # 0.1.0 - Nom du patch.')
  const statusLabel = source.match(/^Statut\s*:\s*(.+)$/mi)?.[1]?.trim() || 'En cours'
  const contentStart = source.indexOf(heading[0]) + heading[0].length
  const afterHeading = source.slice(contentStart).replace(/^\s*Statut\s*:[^\n]*\n?/i, '').trim()
  const sessionsHeading = afterHeading.match(/^##\s+Sessions\s*$/mi)
  const beforeSessions = sessionsHeading ? afterHeading.slice(0, sessionsHeading.index).trim() : afterHeading
  const sessionsBody = sessionsHeading ? afterHeading.slice(sessionsHeading.index + sessionsHeading[0].length).trim() : ''
  const { sessions, notes } = parseReadableSessions(sessionsBody)
  const now = new Date().toISOString()
  const createdAt = sessions[0]?.startedAt || now
  const updatedAt = [...sessions].reverse().find((session) => session.endedAt)?.endedAt || createdAt
  return normalizePatch({
    format: FORMAT,
    id: `patch-${heading[1]}`,
    version: heading[1],
    title: heading[2].trim(),
    status: /^(clos|termin[eé]|released)$/i.test(statusLabel) ? 'released' : 'draft',
    summary: sectionBody(beforeSessions, 'Resume'),
    initialMinutes: 0,
    changes: sectionBody(beforeSessions, 'Changements')
      .split('\n')
      .map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim())
      .filter(Boolean),
    contentMarkdown: beforeSessions,
    sessionNotesMarkdown: notes,
    sessions,
    createdAt,
    updatedAt,
  })
}

function sectionBody(markdown, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, 'mi'))?.[1]?.trim() || ''
}

function parseReadableSessions(markdown) {
  const lines = markdown.split('\n')
  const headerIndex = lines.findIndex((line) => /^\s*\|\s*Debut\s*\(ISO\)/i.test(line))
  if (headerIndex < 0) return { sessions: [], notes: markdown.trim() }
  let tableEnd = headerIndex
  while (tableEnd < lines.length && /^\s*\|/.test(lines[tableEnd])) tableEnd += 1
  const sessions = lines.slice(headerIndex + 2, tableEnd).map((line) => {
    const cells = line.replace(/^\s*\||\|\s*$/g, '').split('|').map((cell) => cell.trim())
    if (cells.length < 2 || !Number.isFinite(Date.parse(cells[0]))) return null
    return {
      startedAt: cells[0],
      endedAt: /^(en cours)?$/i.test(cells[1]) ? null : cells[1],
      description: cells.slice(3).join(' | '),
    }
  }).filter(Boolean)
  const notes = [...lines.slice(0, headerIndex), ...lines.slice(tableEnd)]
    .join('\n')
    .replace(/^\s*\*\*Temps du patch\s*:[^\n]*\*\*\s*/mi, '')
    .trim()
  return { sessions, notes }
}
