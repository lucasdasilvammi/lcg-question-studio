import './styles.css'
import { createClient } from '@supabase/supabase-js'
import {
  createDuelsJson,
  createQuizJson,
  downloadJson,
  validateExport,
} from './gameExport.js'
import { createMockWorkspace } from './mockWorkspace.js'
import { moduleNavMarkup, playtestEditorMarkup, projectModuleMarkup, sidebarContextMarkup } from './modules/projectModules.js'
import {
  activeSession,
  createPatch,
  createPocPatch,
  endSession,
  formatMinutes,
  normalizePatch,
  parsePatchMarkdown,
  serializePatchMarkdown,
  startSession,
  WORKLOG_STORAGE_KEY,
} from './modules/worklog.js'
import { worklogCreateModalMarkup } from './modules/worklogView.js'
import { createWorkspaceSnapshot, documentMap, documentPayload, invalidDocumentKeys, missingDocumentKeys, resolvedRevision } from './modules/studioDocuments.js'
import {
  AUTH_EMAILS,
  BACKLOG_PRIORITIES,
  BACKLOG_SOURCES,
  BACKLOG_STATUSES,
  DEFAULT_BACKLOG_TAGS,
  CATEGORIES,
  CATEGORY_ASSETS,
  CHALLENGES,
  CHALLENGE_ASSETS,
  DIFFICULTIES,
  DIFFICULTY_BY_MILESTONE,
  FEATURE_AREAS,
  GAME_MODES,
  MODULES,
  STATUS_LABELS,
  STATUS_ORDER,
  STORAGE_KEYS,
  USER_AVATARS,
  USER_COLORS,
} from './studioConfig.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const previewMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')
const mockMode = import.meta.env.VITE_USE_SUPABASE !== 'true' || previewMode
const configured = mockMode || Boolean(SUPABASE_URL && SUPABASE_KEY)
const supabase = !mockMode && configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

const VIEW_KEY = STORAGE_KEYS.questionView
const SIDEBAR_KEY = STORAGE_KEYS.sidebarCollapsed
const BACKLOG_KEY = STORAGE_KEYS.backlog
const PROFILES_KEY = STORAGE_KEYS.profiles
const BACKLOG_COLUMNS_KEY = STORAGE_KEYS.backlogColumns
const BACKLOG_VIEW_KEY = STORAGE_KEYS.backlogView
const BACKLOG_TAGS_KEY = STORAGE_KEYS.backlogTags
const IDEAS_KEY = STORAGE_KEYS.ideas
const PLAYTESTS_KEY = STORAGE_KEYS.playtests

const state = {
  loading: configured,
  syncError: null,
  session: null,
  profile: null,
  profiles: [],
  questions: [],
  approvals: [],
  comments: [],
  exports: [],
  backlog: [],
  ideas: [],
  ideasSearch: '',
  editingIdeaId: null,
  backlogTags: readBacklogTags(),
  playtests: [],
  playtestEditingId: null,
  playtestEditorPhase: null,
  worklogPatches: readWorklogPatches(),
  worklogSelectedId: null,
  worklogFileHandle: null,
  worklogFileId: null,
  studioDocumentRevisions: {},
  presence: {},
  activeModule: 'backlog',
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === 'true',
  draggedTicketId: null,
  lastMovedTicketId: null,
  dragInsertStatus: null,
  dragInsertBeforeId: null,
  visibleBacklogStatuses: readVisibleBacklogStatuses(),
  backlogView: localStorage.getItem(BACKLOG_VIEW_KEY) === 'priority' ? 'priority' : 'flow',
  backlogSearch: '',
  backlogOwnerFilter: 'all',
  backlogFeatureFilter: 'all',
  backlogTagFilter: 'all',
  backlogSourceFilter: 'all',
  backlogPriorityFilter: 'all',
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  statusFilter: 'all',
  categoryFilter: 'all',
  difficultyFilter: 'all',
  modeFilter: 'all',
  sourceFilter: 'all',
  favoriteOnly: false,
  trashMode: false,
  accountMenuOpen: false,
  mobileFiltersOpen: false,
  lastUndo: null,
  undoing: false,
  modal: null,
  realtimeChannel: null,
  presenceChannel: null,
  reloadTimer: null,
  toastTimer: null,
  worklogTimer: null,
}

const app = document.querySelector('#app')
const studioDocumentQueues = new Map()
const studioDocumentEpochs = new Map()

start()
document.addEventListener('keydown', handleGlobalKeydown)


async function start() {
  if (mockMode) {
    await startMockWorkspace()
    return
  }
  if (!configured) {
    render()
    return
  }

  const { data, error } = await supabase.auth.getSession()
  if (error) {
    state.loading = false
    state.syncError = `Connexion impossible : ${friendlyError(error)}`
    render()
    return
  }
  await applySession(data.session)

  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => applySession(session), 0)
  })
}

async function startMockWorkspace() {
  const workspace = createMockWorkspace()
  state.profiles = hydrateProfiles(workspace.profiles)
  state.profile = state.profiles.find((profile) => profile.id === workspace.profile.id) || workspace.profile
  state.session = workspace.session
  state.approvals = workspace.approvals
  state.comments = workspace.comments
  state.exports = workspace.exports
  state.backlog = hydrateBacklog(workspace.backlog)
  state.ideas = readIdeas(workspace.ideas)
  state.playtests = readPlaytests(workspace.playtests)
  state.worklogSelectedId = state.worklogPatches[0]?.id || null
  state.questions = workspace.questionRows.map(mapQuestion)
  state.loading = false
  render()
}

function queueStudioDocument(key) {
  if (mockMode || !supabase || !state.session) return Promise.resolve()
  const content = structuredClone(documentPayload(key, state))
  const epoch = studioDocumentEpochs.get(key) || 0
  const previous = studioDocumentQueues.get(key) || Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    if (epoch !== (studioDocumentEpochs.get(key) || 0)) return
    const expectedRevision = state.studioDocumentRevisions[key] ?? null
    const { data, error } = await supabase.rpc('save_studio_document', {
      p_key: key,
      p_content: content,
      p_expected_revision: expectedRevision,
    })
    if (error) {
      if (error.code === '40001' || /revision conflict/i.test(error.message || '')) {
        studioDocumentEpochs.set(key, epoch + 1)
        showToast('Ce module a été modifié ailleurs. La version partagée va être rechargée.')
        await loadWorkspace({ quiet: true })
        return
      }
      showToast('Synchronisation ' + key + ' impossible : ' + friendlyError(error))
      return
    }
    const revision = resolvedRevision(data)
    if (revision !== null) state.studioDocumentRevisions[key] = revision
  })
  studioDocumentQueues.set(key, next)
  return next.finally(() => {
    if (studioDocumentQueues.get(key) === next) studioDocumentQueues.delete(key)
  })
}

function applyStudioDocuments(rows) {
  const documents = documentMap(rows)
  state.studioDocumentRevisions = Object.fromEntries(
    Object.entries(documents).map(([key, row]) => [key, Number(row.revision)]),
  )

  state.backlog = documents.backlog.content.tickets.map(sanitizeBacklogTicket)
  state.backlogTags = mergeBacklogTags(documents.backlog.content.tags)
  state.ideas = documents.ideas.content.items.map(sanitizeIdea)
  state.playtests = documents.playtests.content.sessions.map(sanitizePlaytest)

  const poc = createPocPatch()
  const patches = documents.worklog.content.patches.map(normalizePatch)
  state.worklogPatches = patches.some((patch) => patch.id === poc.id) ? patches : [...patches, poc]
  if (!state.worklogPatches.some((patch) => patch.id === state.worklogSelectedId)) {
    state.worklogSelectedId = state.worklogPatches[0]?.id || null
  }
}
function readWorklogPatches() {
  const poc = createPocPatch()
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKLOG_STORAGE_KEY) || '[]')
    const patches = Array.isArray(parsed) ? parsed.map(normalizePatch) : []
    return patches.some((patch) => patch.id === poc.id) ? patches : [...patches, poc]
  } catch {
    return [poc]
  }
}

function persistWorklogPatches() {
  if (mockMode) localStorage.setItem(WORKLOG_STORAGE_KEY, JSON.stringify(state.worklogPatches))
  return queueStudioDocument('worklog')
}

function selectedWorklogPatch() {
  return state.worklogPatches.find((patch) => patch.id === state.worklogSelectedId) || null
}

async function storeWorklogPatch(patch) {
  const normalized = normalizePatch({ ...patch, updatedAt: new Date().toISOString() })
  const index = state.worklogPatches.findIndex((item) => item.id === normalized.id)
  state.worklogPatches = index < 0
    ? [normalized, ...state.worklogPatches]
    : state.worklogPatches.map((item) => item.id === normalized.id ? normalized : item)
  state.worklogSelectedId = normalized.id
  await persistWorklogPatches()
  if (state.worklogFileHandle && state.worklogFileId === normalized.id) await writeWorklogFile(normalized)
  render()
  return normalized
}
function readPlaytests(defaultPlaytests = []) {
  try {
    const stored = localStorage.getItem(PLAYTESTS_KEY)
    if (stored === null) return defaultPlaytests.map(sanitizePlaytest)
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.map(sanitizePlaytest) : defaultPlaytests.map(sanitizePlaytest)
  } catch {
    return defaultPlaytests.map(sanitizePlaytest)
  }
}

function persistPlaytests() {
  if (mockMode) localStorage.setItem(PLAYTESTS_KEY, JSON.stringify(state.playtests.map(sanitizePlaytest)))
  return queueStudioDocument('playtests')
}

function sanitizePlaytest(session) {
  const list = (value) => Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
  return {
    id: String(session?.id || '').trim(),
    date: String(session?.date || '').trim(),
    status: session?.status === 'Analysée' ? 'Terminée'
      : ['À analyser', 'En cours'].includes(session?.status) ? 'À documenter'
        : ['Planifiée', 'À documenter', 'Terminée'].includes(session?.status) ? session.status : 'Planifiée',
    prototype: String(session?.prototype || '').trim(),
    facilitatorId: String(session?.facilitatorId || '').trim(),
    participants: list(session?.participants),
    duration: String(session?.duration || '').trim(),
    scenario: String(session?.scenario || '').trim(),
    scores: session?.scores || {},
    sentiment: String(session?.sentiment || '').trim(),
    learnings: list(session?.learnings),
    issues: list(session?.issues),
    decisions: list(session?.decisions),
    nextActions: list(session?.nextActions),
    relatedTicketIds: list(session?.relatedTicketIds),
    driveUrl: String(session?.driveUrl || '').trim(),
  }
}
function readIdeas(defaultIdeas = []) {
  try {
    const stored = localStorage.getItem(IDEAS_KEY)
    if (stored === null) return defaultIdeas.map(sanitizeIdea)
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.map(sanitizeIdea) : defaultIdeas.map(sanitizeIdea)
  } catch {
    return defaultIdeas.map(sanitizeIdea)
  }
}

function persistIdeas() {
  if (mockMode) localStorage.setItem(IDEAS_KEY, JSON.stringify(state.ideas))
  return queueStudioDocument('ideas')
}

function sanitizeIdea(idea) {
  const allowedColors = ['white', 'yellow', 'blue', 'pink', 'green', 'orange']
  return {
    id: String(idea.id || createIdeaId()),
    title: String(idea.title || 'Idée sans titre').trim(),
    content: String(idea.content || '').trim(),
    colorKey: allowedColors.includes(idea.colorKey) ? idea.colorKey : 'white',
    pinned: Boolean(idea.pinned),
    createdAt: idea.createdAt || new Date().toISOString(),
    updatedAt: idea.updatedAt || new Date().toISOString(),
  }
}

function createIdeaId() {
  const next = state.ideas.reduce((max, idea) => {
    const value = Number(/^IDEA-(\d+)$/.exec(idea.id)?.[1] || 0)
    return Math.max(max, value)
  }, 0) + 1
  return 'IDEA-' + String(next).padStart(2, '0')
}

function hydrateProfiles(profiles) {
  const savedProfiles = readStoredProfiles()
  if (!savedProfiles.length) return profiles.map((profile) => sanitizeProfile(profile))

  const savedById = new Map(savedProfiles.map((profile) => [profile.id, profile]))
  return profiles.map((profile) => sanitizeProfile({
    ...profile,
    ...(savedById.get(profile.id) || {}),
  }))
}

function sanitizeProfile(profile) {
  const avatarKey = USER_AVATARS.some((avatar) => avatar.id === profile.avatar_key)
    ? profile.avatar_key
    : USER_AVATARS[0].id
  const color = profileColor(profile)
  const { focus: _focus, ...safeProfile } = profile
  return {
    ...safeProfile,
    display_name: String(profile.display_name || profile.username || 'Compte').trim(),
    role: String(profile.role || '').trim(),
    avatar_url: '',
    avatar_key: avatarKey,
    accent_key: color.id,
    accent_color: color.primary,
    accent_secondary: color.secondary,
  }
}

function profileColor(profile) {
  const byKey = USER_COLORS.find((color) => color.id === profile?.accent_key)
  if (byKey) return byKey

  const rawColor = String(profile?.accent_color || '').toUpperCase()
  return USER_COLORS.find((color) => color.primary.toUpperCase() === rawColor) || USER_COLORS[0]
}

function readStoredProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((ticket) => !/^LCG-(0[1-9]|1[0-2])$/i.test(ticket?.id || ''))
      : []
  } catch {
    return []
  }
}

function persistProfiles() {
  if (mockMode) localStorage.setItem(PROFILES_KEY, JSON.stringify(state.profiles.map((profile) => sanitizeProfile(profile))))
}

function readVisibleBacklogStatuses() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKLOG_COLUMNS_KEY) || '[]')
    if (!Array.isArray(parsed)) return [...BACKLOG_STATUSES]
    const statuses = parsed.filter((status) => BACKLOG_STATUSES.includes(status))
    return statuses.length ? statuses : [...BACKLOG_STATUSES]
  } catch {
    return [...BACKLOG_STATUSES]
  }
}

function persistVisibleBacklogStatuses() {
  localStorage.setItem(BACKLOG_COLUMNS_KEY, JSON.stringify(state.visibleBacklogStatuses))
}

function readBacklogTags() {
  try {
    const stored = localStorage.getItem(BACKLOG_TAGS_KEY)
    if (stored === null) return mergeBacklogTags(DEFAULT_BACKLOG_TAGS)
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? mergeBacklogTags(parsed).filter((tag) => !BACKLOG_SOURCES.includes(tag.name)) : mergeBacklogTags(DEFAULT_BACKLOG_TAGS)
  } catch {
    return mergeBacklogTags(DEFAULT_BACKLOG_TAGS)
  }
}

function mergeBacklogTags(tags) {
  const byName = new Map()
  tags.forEach((tag) => {
    const normalized = normalizeBacklogTag(tag)
    if (normalized) byName.set(normalized.name, normalized)
  })
  return [...byName.values()]
}

function persistBacklogTags() {
  if (mockMode) localStorage.setItem(BACKLOG_TAGS_KEY, JSON.stringify(state.backlogTags))
  return queueStudioDocument('backlog')
}

function formatTagName(name) {
  const formatted = name.replace(/(^|[\s/])([a-zà-ÿ])/g, (match, separator, letter) => separator + letter.toUpperCase())
  return formatted.replace(/\bVs\b/g, 'vs')
}

function normalizeBacklogTag(tag) {
  const name = formatTagName(String(tag?.name || tag || '').trim())
  if (!name) return null
  const paletteColor = USER_COLORS.find((color) => color.id === tag?.colorKey)
    || USER_COLORS.find((color) => color.primary.toLowerCase() === String(tag?.primary || tag?.color || '').toLowerCase())

  return {
    name,
    colorKey: paletteColor?.id || 'white',
    primary: paletteColor?.primary || '#f4f1ea',
    secondary: paletteColor?.secondary || '#262a31',
  }
}

function hydrateBacklog(backlog) {
  const savedTickets = readStoredBacklog()
  if (!savedTickets.length) return backlog

  const defaultIds = new Set(backlog.map((ticket) => ticket.id))
  const savedById = new Map(savedTickets.map((ticket, index) => [
    ticket.id,
    {
      ...ticket,
      status: BACKLOG_STATUSES.includes(ticket.status) ? ticket.status : null,
      order: Number.isFinite(Number(ticket.order)) ? Number(ticket.order) : index,
      updatedAt: ticket.updatedAt || null,
    },
  ]))

  const mergedTickets = backlog
    .map((ticket, index) => {
      const saved = savedById.get(ticket.id)
      return {
        ...ticket,
        ...(saved || {}),
        id: ticket.id,
        status: saved?.status || ticket.status,
        updatedAt: saved?.updatedAt || ticket.updatedAt || null,
        fallbackOrder: 1000 + index,
        savedOrder: saved?.order,
      }
    })

  savedTickets
    .filter((ticket) => ticket.id && !defaultIds.has(ticket.id))
    .forEach((ticket, index) => {
      mergedTickets.push({
        ...sanitizeBacklogTicket(ticket),
        fallbackOrder: 2000 + index,
        savedOrder: Number.isFinite(Number(ticket.order)) ? Number(ticket.order) : undefined,
      })
    })

  return mergedTickets
    .sort((left, right) => (left.savedOrder ?? left.fallbackOrder) - (right.savedOrder ?? right.fallbackOrder))
    .map(({ fallbackOrder, savedOrder, order, ...ticket }) => sanitizeBacklogTicket(ticket))
}

function readStoredBacklog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKLOG_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((ticket) => !/^LCG-(0[1-9]|1[0-2])$/i.test(ticket?.id || ''))
      : []
  } catch {
    return []
  }
}

function persistBacklog() {
  if (mockMode) localStorage.setItem(BACKLOG_KEY, JSON.stringify(state.backlog.map((ticket, index) => ({
    ...sanitizeBacklogTicket(ticket),
    order: index,
  }))))
  return queueStudioDocument('backlog')
}

function sanitizeBacklogTicket(ticket) {
  const ownerProfile = state.profiles.find((profile) => profile.id === ticket.ownerId)
  const fallbackOwner = state.profiles.find((profile) => profile.display_name === ticket.owner)
  const ownerId = ownerProfile?.id || fallbackOwner?.id || state.profile?.id || 'lucas-preview'
  const owner = state.profiles.find((profile) => profile.id === ownerId)?.display_name || ticket.owner || 'Lucas'
  const createdById = ticket.createdById || ownerId
  const rawTagNames = (Array.isArray(ticket.tags) ? ticket.tags : [ticket.tag])
    .map((tag) => String(tag?.name || tag || '').trim())
    .filter(Boolean)
  const sourceCandidate = String(ticket.source || rawTagNames.find((name) => BACKLOG_SOURCES.some((source) => source.toLowerCase() === name.toLowerCase())) || '').trim()
  const source = BACKLOG_SOURCES.find((item) => item.toLowerCase() === sourceCandidate.toLowerCase()) || ''
  const tags = sanitizeTicketTags(ticket.tags || ticket.tag).filter((tag) => !BACKLOG_SOURCES.includes(tag.name))

  return {
    id: String(ticket.id || createBacklogTicketId()).trim(),
    title: String(ticket.title || 'Ticket sans titre').trim(),
    description: String(ticket.description || ticket.objective || '').trim(),
    status: BACKLOG_STATUSES.includes(ticket.status) ? ticket.status : 'Backlog',
    owner,
    ownerId,
    createdById,
    priority: BACKLOG_PRIORITIES.includes(ticket.priority) ? ticket.priority : 'Moyenne',
    source,
    tag: tags[0]?.name || '',
    tags,
    due: String(ticket.due || 'À cadrer').trim(),
    feature: FEATURE_AREAS.includes(ticket.feature) ? ticket.feature : 'Backlog / Kanban',
    objective: String(ticket.objective || '').trim(),
    risk: String(ticket.risk || '').trim(),
    validation: String(ticket.validation || '').trim(),
    attachment: sanitizeTicketAttachment(ticket.attachment),
    updatedAt: ticket.updatedAt || null,
  }
}

function sanitizeTicketTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || '').split('|').map((name) => ({ name }))
  const legacyNames = {
    Backlog: 'App',
    Kanban: 'Features',
    Documentation: 'App',
    Playtests: 'Test Utilisateur',
    Compte: 'App',
    'Question Studio': 'Questions / Contenu',
    Worklog: 'App',
    Données: 'App',
  }

  const byName = new Map()
  rawTags
    .map((tag) => {
      const originalName = String(tag.name || tag || '').trim()
      const name = formatTagName(legacyNames[originalName] || originalName)
      if (!name) return null
      const knownTag = state.backlogTags.find((item) => item.name.toLowerCase() === name.toLowerCase())
      if (knownTag) return normalizeBacklogTag(knownTag)
      return normalizeBacklogTag({
        name,
        colorKey: tag.colorKey,
        primary: tag.primary || tag.color,
      })
    })
    .filter(Boolean)
    .forEach((tag) => {
      byName.set(tag.name, tag)
    })

  return [...byName.values()]
}

function sanitizeTicketAttachment(attachment) {
  if (!attachment?.dataUrl) return null
  return {
    name: String(attachment.name || 'piece-jointe').trim(),
    type: String(attachment.type || '').trim(),
    dataUrl: String(attachment.dataUrl || '').trim(),
  }
}

async function retryConnection() {
  state.loading = true
  state.syncError = null
  render()
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    state.loading = false
    state.syncError = `Connexion impossible : ${friendlyError(error)}`
    render()
    return
  }
  await applySession(data.session)
}
async function applySession(session) {
  state.session = session
  state.loading = Boolean(session)
  if (!session) {
    state.profile = null
    state.questions = []
    teardownRealtime()
    render()
    return
  }

  await loadWorkspace()
  setupRealtime()
}

async function loadWorkspace({ quiet = false } = {}) {
  if (!quiet) state.loading = true
  state.syncError = null
  if (!quiet) render()

  const [
    profilesResult,
    questionsResult,
    approvalsResult,
    commentsResult,
    exportsResult,
    studioDocumentsResult,
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('display_name'),
    supabase.from('questions').select('*').order('updated_at', { ascending: false }),
    supabase.from('question_approvals').select('*'),
    supabase.from('question_comments').select('*').order('created_at'),
    supabase.from('export_batches').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('studio_documents').select('*'),
  ])

  const error = [
    profilesResult.error,
    questionsResult.error,
    approvalsResult.error,
    commentsResult.error,
    exportsResult.error,
    studioDocumentsResult.error,
  ].find(Boolean)

  if (error) {
    state.loading = false
    state.syncError = `Synchronisation impossible : ${friendlyError(error)}`
    render()
    return
  }

  const missingDocuments = missingDocumentKeys(studioDocumentsResult.data)
  const invalidDocuments = invalidDocumentKeys(studioDocumentsResult.data)
  if (missingDocuments.length || invalidDocuments.length) {
    state.loading = false
    const details = [
      missingDocuments.length ? `absents : ${missingDocuments.join(', ')}` : '',
      invalidDocuments.length ? `invalides : ${invalidDocuments.join(', ')}` : '',
    ].filter(Boolean).join(' ; ')
    state.syncError = `Les documents partagés ne sont pas prêts (${details}). Exécute la migration et l'initialisation décrites dans la checklist.`
    render()
    return
  }

  state.profiles = profilesResult.data.map(sanitizeProfile)
  state.profile = state.profiles.find((profile) => profile.id === state.session.user.id) || null
  if (!state.profile) {
    state.loading = false
    state.syncError = 'Le compte connecté ne possède pas de profil Studio. Vérifie la table profiles avant de réessayer.'
    render()
    return
  }
  state.approvals = approvalsResult.data
  state.comments = commentsResult.data
  state.exports = exportsResult.data
  applyStudioDocuments(studioDocumentsResult.data)
  state.questions = questionsResult.data.map(mapQuestion)
  state.loading = false
  state.syncError = null
  render()
}

function setupRealtime() {
  if (state.realtimeChannel || !state.profile) return

  state.realtimeChannel = supabase
    .channel('question-studio-database')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'question_approvals' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'studio_documents' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'question_comments' }, scheduleReload)
    .subscribe()

  state.presenceChannel = supabase.channel('question-studio-presence', {
    config: { presence: { key: state.profile.id } },
  })
  state.presenceChannel
    .on('presence', { event: 'sync' }, syncPresence)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await updatePresence()
    })
}

function teardownRealtime() {
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel)
  if (state.presenceChannel) supabase.removeChannel(state.presenceChannel)
  state.realtimeChannel = null
  state.presenceChannel = null
  state.presence = {}
}

function scheduleReload() {
  window.clearTimeout(state.reloadTimer)
  state.reloadTimer = window.setTimeout(() => loadWorkspace({ quiet: true }), 180)
}

function syncPresence() {
  const raw = state.presenceChannel?.presenceState() || {}
  const presence = {}
  Object.values(raw).flat().forEach((entry) => {
    if (!entry.questionId || entry.userId === state.profile?.id) return
    presence[entry.questionId] ||= []
    presence[entry.questionId].push(entry.displayName)
  })
  state.presence = presence
  render()
}

async function updatePresence(questionId = modalQuestionId()) {
  if (!state.presenceChannel || !state.profile) return
  await state.presenceChannel.track({
    userId: state.profile.id,
    displayName: state.profile.display_name,
    questionId: questionId || null,
    onlineAt: new Date().toISOString(),
  })
}

function mapQuestion(row) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    wrongAnswers: row.wrong_answers || [],
    explanation: row.explanation || '',
    category: row.category,
    difficulty: row.difficulty,
    milestones: Number(row.milestones),
    mode: row.mode,
    challengeType: row.challenge_type,
    status: row.status,
    tags: row.tags || [],
    source: row.source || '',
    sourcePage: row.source_page || '',
    revisionNotes: row.revision_notes || '',
    favorite: Boolean(row.favorite),
    confidence: Number(row.confidence) || 0,
    version: Number(row.version) || 1,
    lastExportedVersion: row.last_exported_version,
    lastExportedAt: row.last_exported_at,
    deletedAt: row.deleted_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvals: state.approvals
      .filter((approval) => approval.question_id === row.id)
      .map((approval) => ({
        reviewerId: approval.reviewer_id,
        reviewer: profileName(approval.reviewer_id),
        at: approval.created_at,
      })),
    commentCount: state.comments.filter((comment) => comment.question_id === row.id).length,
  }
}

function render() {
  if (!configured) {
    app.innerHTML = setupRequiredMarkup()
    return
  }
  if (state.syncError) {
    app.innerHTML = syncErrorMarkup()
    document.querySelector('[data-action="retry-sync"]')?.addEventListener('click', retryConnection)
    return
  }
  if (!state.session) {
    app.innerHTML = loginMarkup()
    bindLogin()
    return
  }
  if (state.loading || !state.profile) {
    app.innerHTML = loadingMarkup()
    return
  }

  const visible = filteredQuestions()
  const active = state.questions.filter((question) => !question.deletedAt)
  const validated = active.filter((question) => question.status === 'validated').length
  const review = active.filter((question) => question.status === 'review').length
  const awaitingMe = active.filter((question) => matchesStatus(question, 'awaiting-me')).length
  const exported = active.filter((question) => exportState(question) === 'exported').length

  app.innerHTML = `
    <div class="app-shell module-${escapeHtml(state.activeModule)} ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''} ${state.mobileFiltersOpen ? 'mobile-filters-open' : ''}">
      <header class="topbar">
        <div class="brand">
          <div class="brand-main">
            <div class="brand-mark">LCG</div>
            <div class="brand-copy">
              <strong>LCG Studio</strong>
              <span>${escapeHtml(activeModuleLabel())}</span>
            </div>
          </div>
          <button class="sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${state.sidebarCollapsed ? 'Déplier la navigation' : 'Replier la navigation'}" title="${state.sidebarCollapsed ? 'Déplier la navigation' : 'Replier la navigation'}">${state.sidebarCollapsed ? '&gt;' : '&lt;'}</button>
        </div>
        ${moduleNavMarkup({ modules: MODULES, activeModule: state.activeModule, escapeHtml })}
        ${sidebarContextMarkup({ state, escapeHtml })}
        <button class="mobile-filter-button ${state.mobileFiltersOpen ? 'active' : ''}" type="button" data-action="mobile-filters" aria-expanded="${state.mobileFiltersOpen ? 'true' : 'false'}">Filtres</button>
        <div class="account-menu ${state.accountMenuOpen ? 'open' : ''}">
          <button class="account-button" data-action="account-menu" aria-expanded="${state.accountMenuOpen ? 'true' : 'false'}">
            ${profileAvatarMarkup(state.profile, 'account-avatar')}
            <span class="account-name">${escapeHtml(state.profile.display_name)}</span>
            <span class="account-menu-icon">☰</span>
          </button>
          <div class="account-dropdown">
            <button type="button" data-action="edit-profile">Modifier le compte</button>
            <button type="button" data-action="export-workspace">Sauvegarder les données</button>
            <button type="button" data-action="new-ticket">Créer un ticket</button>
            <button type="button" data-action="new">Créer une question</button>
            <button type="button" data-action="export">Exporter JSON</button>
            <button type="button" data-action="status-help">Comprendre les états</button>
            <button type="button" data-action="logout">Se déconnecter</button>
          </div>
        </div>
      </header>

        ${projectModuleMarkup({ state, escapeHtml, profileBadgeMarkup })}

      <div class="mobile-filter-panel">
        <div class="mobile-filter-surface">
          <section class="sidebar-section">
            <p class="sidebar-label">État</p>
            <div class="state-filter">
              ${statusButton('all', 'Toutes', countStatus('all'))}
              ${statusButton('pending', 'En attente', countStatus('pending'))}
              ${statusButton('review', 'En révision', review)}
              ${statusButton('awaiting-me', 'À valider par moi', awaitingMe)}
              ${statusButton('approved-lucas', 'Validées par Lucas', countStatus('approved-lucas'))}
              ${statusButton('approved-awen', 'Validées par Awen', countStatus('approved-awen'))}
              ${statusButton('validated', 'Validées par les deux', validated)}
            </div>
          </section>

          <section class="sidebar-section">
            <p class="sidebar-label">Répartition</p>
            <div class="balance-card">${balanceMarkup()}</div>
          </section>

          <section class="sidebar-section trash-section">
            <button class="trash-button ${state.trashMode ? 'active' : ''}" data-action="trash">
              Corbeille <span>${state.questions.filter((question) => question.deletedAt).length}</span>
            </button>
          </section>

          <div class="filters-panel mobile-filters-panel">
            ${state.trashMode ? '' : `
              <select class="select" data-filter="category">
                <option value="all">Toutes les catégories</option>
                ${CATEGORIES.map((value) => option(value, state.categoryFilter)).join('')}
              </select>
              <select class="select" data-filter="difficulty">
                <option value="all">Toutes les difficultés</option>
                ${DIFFICULTIES.map((value) => option(value, state.difficultyFilter)).join('')}
              </select>
              <select class="select" data-filter="mode">
                <option value="all">Quiz et défis</option>
                ${GAME_MODES.map((value) => option(value, state.modeFilter)).join('')}
              </select>
              <select class="select" data-filter="source">
                <option value="all">Toutes les sources</option>
                ${allSources().map((value) => option(value, state.sourceFilter)).join('')}
              </select>
              <button class="favorite-filter-button ${state.favoriteOnly ? 'active' : ''}" type="button" data-action="favorite-filter" title="Favoris uniquement" aria-label="Favoris uniquement" aria-pressed="${state.favoriteOnly ? 'true' : 'false'}">★</button>
            `}
            ${state.trashMode && visible.length
              ? '<button class="button danger" data-action="empty-trash">Vider la corbeille</button>'
              : ''}
            <button class="undo-button" type="button" data-action="undo-last" ${state.lastUndo && !state.undoing ? '' : 'disabled'} title="${state.lastUndo ? `Annuler : ${escapeHtml(state.lastUndo.label)}` : 'Aucune action à annuler'}">↶ Annuler</button>
            <div class="view-switch">
              <button class="icon-button ${state.view === 'grid' ? 'active' : ''}" data-view="grid" title="Vue grille">▦</button>
              <button class="icon-button ${state.view === 'list' ? 'active' : ''}" data-view="list" title="Vue liste">☷</button>
            </div>
          </div>
        </div>
      </div>

      <div class="workspace">


        <main class="main">
          <header class="page-head question-head">
            <div>
              <p class="eyebrow">Question Studio</p>
              <h1>${state.trashMode ? 'Corbeille des cartes' : 'Catalogue de cartes'}</h1>
              <p class="subhead">${mockMode ? 'Mode prototype actif : les questions restent locales et fictives.' : 'Base synchronisée : validations, commentaires et exports sont partagés.'}</p>
            </div>
            <div class="page-head-actions">
              <button class="button" type="button" data-action="status-help">États</button>
              <button class="button primary" type="button" data-action="new">Nouvelle question</button>
            </div>
          </header>

          <section class="summary-strip" aria-label="Synthèse Question Studio">
            <div class="summary-item"><strong>${active.length}</strong><span>cartes actives</span></div>
            <div class="summary-item"><strong>${awaitingMe}</strong><span>à valider</span></div>
            <div class="summary-item"><strong>${review}</strong><span>en révision</span></div>
            <div class="summary-item"><strong>${validated}</strong><span>validées</span></div>
            <div class="summary-item"><strong>${exported}</strong><span>exportées</span></div>
          </section>

          <div class="filters-panel">
            ${state.trashMode ? '' : `
              <select class="select" data-filter="category">
                <option value="all">Toutes les catégories</option>
                ${CATEGORIES.map((value) => option(value, state.categoryFilter)).join('')}
              </select>
              <select class="select" data-filter="difficulty">
                <option value="all">Toutes les difficultés</option>
                ${DIFFICULTIES.map((value) => option(value, state.difficultyFilter)).join('')}
              </select>
              <select class="select" data-filter="mode">
                <option value="all">Quiz et défis</option>
                ${GAME_MODES.map((value) => option(value, state.modeFilter)).join('')}
              </select>
              <select class="select" data-filter="source">
                <option value="all">Toutes les sources</option>
                ${allSources().map((value) => option(value, state.sourceFilter)).join('')}
              </select>
              <button class="favorite-filter-button ${state.favoriteOnly ? 'active' : ''}" type="button" data-action="favorite-filter" title="Favoris uniquement" aria-label="Favoris uniquement" aria-pressed="${state.favoriteOnly ? 'true' : 'false'}">★</button>
            `}
            ${state.trashMode && visible.length
              ? '<button class="button danger" data-action="empty-trash">Vider la corbeille</button>'
              : ''}
            <button class="undo-button" type="button" data-action="undo-last" ${state.lastUndo && !state.undoing ? '' : 'disabled'} title="${state.lastUndo ? `Annuler : ${escapeHtml(state.lastUndo.label)}` : 'Aucune action à annuler'}">↶ Annuler</button>
            <div class="view-switch">
              <button class="icon-button ${state.view === 'grid' ? 'active' : ''}" data-view="grid" title="Vue grille">▦</button>
              <button class="icon-button ${state.view === 'list' ? 'active' : ''}" data-view="list" title="Vue liste">☷</button>
            </div>
          </div>

          <div class="results-line">
            <span>${visible.length} résultat${visible.length > 1 ? 's' : ''} · tri automatique par état</span>
            ${hasActiveFilters() && !state.trashMode
              ? '<button class="text-button" data-action="clear-filters">Effacer les filtres</button>'
              : ''}
          </div>

          ${visible.length
            ? `<div class="questions ${state.view}">${visible.map(questionCard).join('')}</div>`
            : emptyMarkup()}
        </main>
      </div>
      ${state.modal ? modalMarkup() : ''}
    </div>
  `

  bindEvents()
}

function activeModuleLabel() {
  return MODULES.find((module) => module.id === state.activeModule)?.label || 'Backlog'
}

function profileAvatarMarkup(profile, className) {
  const name = profile?.display_name || 'Compte'
  const color = profileColor(profile)
  const avatar = USER_AVATARS.find((item) => item.id === profile?.avatar_key) || USER_AVATARS[0]
  return `
    <span class="${className}" role="img" aria-label="${escapeHtml(name)}" style="--avatar-primary: ${escapeHtml(color.primary)}; --avatar-secondary: ${escapeHtml(color.secondary)}; --avatar-icon: url('${escapeHtml(avatar.icon || '')}')">
      ${avatar.icon
        ? '<span class="profile-avatar-icon" aria-hidden="true"></span>'
        : `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`}
    </span>
  `
}

function profileBadgeMarkup(profileId, fallbackName = '') {
  const profile = state.profiles.find((item) => item.id === profileId)
  const label = profile?.display_name || fallbackName || 'Non assigné'
  return `
    <span class="profile-badge">
      ${profileAvatarMarkup(profile || { display_name: label }, 'profile-badge-avatar')}
      <span>${escapeHtml(label)}</span>
    </span>
  `
}

function loginMarkup() {
  return `
    <main class="auth-page">
      <section class="auth-panel">
        <div class="brand-mark auth-logo">LCG</div>
        <p class="eyebrow">Le Cube Graphique</p>
        <h1>LCG Studio</h1>
        <p class="subhead">Connecte-toi avec ton compte Lucas ou Awen.</p>
        <form id="login-form" class="login-form">
          <label>
            Identifiant
            <select name="username" required>
              <option value="lucas">Lucas</option>
              <option value="awen">Awen</option>
            </select>
          </label>
          <label>
            Mot de passe
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <p class="form-error" id="login-error"></p>
          <button class="button accent" type="submit">Se connecter</button>
        </form>
      </section>
    </main>
  `
}

function setupRequiredMarkup() {
  return `
    <main class="auth-page">
      <section class="auth-panel setup-panel">
        <div class="brand-mark auth-logo">LCG</div>
        <p class="eyebrow">Configuration requise</p>
        <h1>Supabase n’est pas encore relié</h1>
        <p class="subhead">Ajoute ces deux variables dans Netlify et dans un fichier <code>.env.local</code> pour le développement :</p>
        <pre>VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY</pre>
        <p class="field-help">Les instructions complètes se trouvent dans le README du projet.</p>
      </section>
    </main>
  `
}

function syncErrorMarkup() {
  return `
    <main class="auth-page">
      <section class="auth-panel setup-panel">
        <div class="brand-mark auth-logo">LCG</div>
        <p class="eyebrow">Connexion interrompue</p>
        <h1>Le Studio n'a pas pu se synchroniser</h1>
        <p class="subhead">${escapeHtml(state.syncError)}</p>
        <button class="button primary" type="button" data-action="retry-sync">Réessayer</button>
      </section>
    </main>
  `
}
function loadingMarkup() {
  return `
    <main class="auth-page">
      <section class="auth-panel loading-panel">
        <div class="brand-mark auth-logo">LCG</div>
        <div class="loading-bar"><span></span></div>
        <p>Synchronisation du studio…</p>
      </section>
    </main>
  `
}

function bindLogin() {
  document.querySelector('#login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const submit = form.querySelector('button')
    const errorNode = form.querySelector('#login-error')
    const data = Object.fromEntries(new FormData(form))
    submit.disabled = true
    errorNode.textContent = ''

    const { error } = await supabase.auth.signInWithPassword({
      email: AUTH_EMAILS[data.username],
      password: data.password,
    })

    if (error) {
      errorNode.textContent = 'Identifiant ou mot de passe incorrect.'
      submit.disabled = false
    }
  })
}

function filteredQuestions() {
  return state.questions
    .filter((question) => state.trashMode ? question.deletedAt : !question.deletedAt)
    .filter((question) => {
      if (state.trashMode) return true
      if (!matchesStatus(question, state.statusFilter)) return false
      if (state.categoryFilter !== 'all' && question.category !== state.categoryFilter) return false
      if (state.difficultyFilter !== 'all' && question.difficulty !== state.difficultyFilter) return false
      if (state.modeFilter !== 'all' && question.mode !== state.modeFilter) return false
      if (state.sourceFilter !== 'all' && sourceLabel(question) !== state.sourceFilter) return false
      if (state.favoriteOnly && !question.favorite) return false
      return true
    })
    .sort((left, right) =>
      (STATUS_ORDER[left.status] || 0) - (STATUS_ORDER[right.status] || 0)
      || new Date(right.updatedAt) - new Date(left.updatedAt))
}

function matchesStatus(question, filter) {
  if (filter === 'all') return true
  if (filter === 'approved-lucas') return hasApproval(question, 'Lucas')
  if (filter === 'approved-awen') return hasApproval(question, 'Awen')
  if (filter === 'awaiting-me') {
    return question.status !== 'review'
      && question.status !== 'validated'
      && !question.approvals.some((approval) => approval.reviewerId === state.profile.id)
  }
  return question.status === filter
}

function countStatus(filter) {
  return state.questions.filter((question) => !question.deletedAt && matchesStatus(question, filter)).length
}

function hasApproval(question, name) {
  return question.approvals.some((approval) => approval.reviewer === name)
}

function hasMyApproval(question) {
  return question.approvals.some((approval) => approval.reviewerId === state.profile.id)
}

function questionCard(question) {
  const viewing = state.presence[question.id] || []
  const exported = exportState(question)
  const updater = profileName(question.updatedBy)

  return `
    <article class="question-card ${state.view}" data-open-card="${escapeHtml(question.id)}">
      <div class="card-main">
        <div class="card-top">
          <span class="card-id">${escapeHtml(question.id)}</span>
          <button class="favorite-button ${question.favorite ? 'active' : ''}" data-card-action="favorite" data-id="${escapeHtml(question.id)}" title="Favorite">★</button>
        </div>
        <h2 class="question-text">${escapeHtml(question.question)}</h2>
        <div class="card-answers">
          <p class="answer correct-answer"><span class="answer-label">Bonne réponse</span><span>${escapeHtml(question.answer || 'À compléter')}</span></p>
          ${question.wrongAnswers.length
            ? `<div class="wrong-answer-list">
                <span class="answer-label">Fausses réponses</span>
                ${question.wrongAnswers.map((answer) => `<span>${escapeHtml(answer)}</span>`).join('')}
              </div>`
            : '<p class="answer muted-answer"><span class="answer-label">Fausses réponses</span><span>Aucune</span></p>'}
        </div>
        <div class="game-tags">${gameTags(question)}</div>
        <div class="tags secondary-tags">
          ${exported === 'exported' ? '<span class="tag exported">Déjà exportée</span>' : ''}
          ${exported === 'modified' ? '<span class="tag modified">Modifiée depuis l’export</span>' : ''}
          ${question.commentCount ? `<span class="tag comment-tag">${question.commentCount} commentaire${question.commentCount > 1 ? 's' : ''}</span>` : ''}
        </div>
        ${question.revisionNotes ? `<p class="card-note"><b>Révision :</b> ${escapeHtml(question.revisionNotes)}</p>` : ''}
        ${viewing.length ? `<p class="presence-note"><i></i>${escapeHtml(viewing.join(' et '))} consulte cette carte</p>` : ''}
      </div>
      <div class="card-side">
        <div class="card-side-top">
          <div>
            <span class="status ${question.status}">${statusLabel(question)}</span>
            ${approvalMarkup(question)}
          </div>
          <div class="card-meta">
            <span>${escapeHtml(question.source || 'Source non renseignée')}${question.sourcePage ? ` · p. ${escapeHtml(question.sourcePage)}` : ''}</span>
            <span>Modifiée ${formatRelative(question.updatedAt)}</span>
            ${question.updatedBy ? profileBadgeMarkup(question.updatedBy, updater) : ''}
          </div>
        </div>
        <div class="card-actions">
          ${state.trashMode
            ? `<button class="button small primary" data-card-action="restore" data-id="${escapeHtml(question.id)}">Restaurer</button>`
            : `
              <button class="button small" data-card-action="comments" data-id="${escapeHtml(question.id)}">Discussion</button>
              <button class="button small" data-card-action="history" data-id="${escapeHtml(question.id)}">Historique</button>
              ${question.status !== 'review'
                ? `<button class="button small" data-card-action="review" data-id="${escapeHtml(question.id)}">Révision</button>`
                : `<button class="button small" data-card-action="pending" data-id="${escapeHtml(question.id)}">En attente</button>`}
              <button class="button small ${hasMyApproval(question) ? '' : 'primary'}" data-card-action="${hasMyApproval(question) ? 'revoke' : 'approve'}" data-id="${escapeHtml(question.id)}">
                ${hasMyApproval(question) ? 'Retirer ma validation' : 'Valider'}
              </button>
            `}
        </div>
      </div>
    </article>
  `
}

function gameTags(question) {
  const category = CATEGORY_ASSETS[question.category]
  const challenge = CHALLENGE_ASSETS[question.challengeType]
  return `
    ${difficultyTagMarkup(question)}
    ${category
      ? `<img class="game-tag-image" src="/game/categorie/${category}.png" alt="${escapeHtml(question.category)}" />`
      : `<span class="game-tag-fallback">${escapeHtml(question.category)}</span>`}
    ${question.mode === 'Défi'
      ? challenge
        ? `<img class="game-tag-image" src="/game/defi-tag/${challenge}.png" alt="${escapeHtml(question.challengeType)}" />`
        : `<span class="game-tag-fallback challenge-fallback">${escapeHtml(question.challengeType)}</span>`
      : '<span class="game-tag-fallback quiz-fallback">Quiz</span>'}
  `
}

function approvalMarkup(question) {
  return `<div class="approval-row">
    ${state.profiles.map((profile) => {
      const approved = question.approvals.some((approval) => approval.reviewerId === profile.id)
      return `
        <span class="approval-chip ${approved ? 'approved' : ''}">
          ${profileAvatarMarkup(profile, 'profile-chip-avatar')}
          <span>${approved ? '✓' : '○'} ${escapeHtml(profile.display_name)}</span>
        </span>
      `
    }).join('')}
  </div>`
}

function statusLabel(question) {
  if (question.status !== 'approved') return STATUS_LABELS[question.status]
  const reviewer = question.approvals[0]?.reviewer
  return reviewer ? `Validée par ${reviewer}` : STATUS_LABELS.approved
}

function exportState(question) {
  if (question.lastExportedVersion === null || question.lastExportedVersion === undefined) return 'never'
  return Number(question.lastExportedVersion) === question.version ? 'exported' : 'modified'
}

function difficultyControlMarkup(question) {
  const milestone = clampMilestones(question.milestones)
  const difficulty = difficultyForMilestone(milestone)

  return `
    <div class="difficulty-stepper" data-difficulty-stepper data-milestone="${milestone}">
      <button class="difficulty-step-button" type="button" data-difficulty-step="-1" ${milestone <= 1 ? 'disabled' : ''} aria-label="Baisser la difficulté">−</button>
      <div class="difficulty-display">
        <img src="/game/categorie/diff-${milestone}.png" alt="${milestone} jalons" />
        <span class="difficulty-copy">
          <strong>${milestone} jalon${milestone > 1 ? 's' : ''}</strong>
          <span>${escapeHtml(difficulty)}</span>
        </span>
      </div>
      <button class="difficulty-step-button" type="button" data-difficulty-step="1" ${milestone >= 5 ? 'disabled' : ''} aria-label="Monter la difficulté">+</button>
      <input type="hidden" name="milestones" value="${milestone}" />
      <input type="hidden" name="difficulty" value="${escapeHtml(difficulty)}" />
    </div>
  `
}

function difficultyTagMarkup(question) {
  const milestone = clampMilestones(question.milestones)
  const canShowControls = !state.trashMode

  return `
    <span class="difficulty-tag-control">
      ${canShowControls
        ? `<button class="tag-step-button" type="button" data-card-action="difficulty" data-id="${escapeHtml(question.id)}" data-direction="-1" ${milestone <= 1 || mockMode ? 'disabled' : ''} aria-label="Baisser la difficulté">−</button>`
        : ''}
      <img class="game-tag-image" src="/game/categorie/diff-${milestone}.png" alt="${milestone} jalons" />
      ${canShowControls
        ? `<button class="tag-step-button" type="button" data-card-action="difficulty" data-id="${escapeHtml(question.id)}" data-direction="1" ${milestone >= 5 || mockMode ? 'disabled' : ''} aria-label="Monter la difficulté">+</button>`
        : ''}
    </span>
  `
}

function statusButton(value, label, count) {
  return `<button class="filter-chip ${state.statusFilter === value && !state.trashMode ? 'active' : ''}" data-status-filter="${value}">
    <span>${label}</span><span class="filter-count">${count}</span>
  </button>`
}

function balanceMarkup() {
  const active = state.questions.filter((question) => !question.deletedAt)
  return CATEGORIES.map((category) => {
    const questions = active.filter((question) => question.category === category)
    return `
      <details class="balance-details">
        <summary><span>${escapeHtml(category)}</span><b>${questions.length}</b></summary>
        <div class="difficulty-counts">
          ${DIFFICULTIES.map((difficulty) => `
            <span>${escapeHtml(difficulty)} <b>${questions.filter((question) => question.difficulty === difficulty).length}</b></span>
          `).join('')}
        </div>
      </details>
    `
  }).join('')
}

function allSources() {
  return [...new Set(
    state.questions.filter((question) => !question.deletedAt).map(sourceLabel),
  )].sort((left, right) => left.localeCompare(right, 'fr'))
}

function hasActiveFilters() {
  return state.statusFilter !== 'all'
    || state.categoryFilter !== 'all'
    || state.difficultyFilter !== 'all'
    || state.modeFilter !== 'all'
    || state.sourceFilter !== 'all'
    || state.favoriteOnly
}

function emptyMarkup() {
  return `
    <div class="empty-state">
      <div class="empty-icon">${state.trashMode ? '×' : '?'}</div>
      <h2>${state.trashMode ? 'La corbeille est vide' : 'Aucune question ici'}</h2>
      <p>${state.trashMode ? 'Les cartes supprimées apparaîtront dans cet espace.' : 'Modifie les filtres ou crée une nouvelle question.'}</p>
    </div>
  `
}

function modalMarkup() {
  if (state.modal.type === 'edit') return editModalMarkup()
  if (state.modal.type === 'ticket') return ticketModalMarkup()
  if (state.modal.type === 'profile') return profileModalMarkup()
  if (state.modal.type === 'comments') return commentsModalMarkup()
  if (state.modal.type === 'history') return historyModalMarkup()
  if (state.modal.type === 'export') return exportModalMarkup()
  if (state.modal.type === 'status-help') return statusHelpMarkup()
  if (state.modal.type === 'playtest') return playtestModalMarkup()
  if (state.modal.type === 'worklog-patch') return worklogCreateModalMarkup()
  return ''
}

function playtestModalMarkup() {
  const session = state.playtests.find((item) => item.id === state.modal.id) || null
  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal playtest-modal">
        ${playtestEditorMarkup(session, state, escapeHtml)}
      </div>
    </div>
  `
}
function ticketModalMarkup() {
  const existing = state.backlog.find((ticket) => ticket.id === state.modal.id)
  const ticket = existing || {
    id: '',
    title: state.modal.prefill?.title || '',
    description: state.modal.prefill?.description || state.modal.prefill?.objective || '',
    status: state.modal.prefill?.status || 'Backlog',
    ownerId: state.profile.id,
    priority: state.modal.prefill?.priority || 'Moyenne',
    source: state.modal.prefill?.source || '',
    tags: sanitizeTicketTags(state.modal.prefill?.tags || state.modal.prefill?.tag || []),
    tag: state.modal.prefill?.tag || '',
    due: state.modal.prefill?.due || 'À cadrer',
    feature: state.modal.prefill?.feature || 'Backlog / Kanban',
    objective: state.modal.prefill?.objective || '',
    risk: state.modal.prefill?.risk || '',
    validation: state.modal.prefill?.validation || '',
    attachment: null,
  }
  const selectedTagNames = new Set(sanitizeTicketTags(ticket.tags || ticket.tag).map((tag) => tag.name))

  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal">
        <div class="modal-head">
          <div>
            <p class="eyebrow">${existing ? escapeHtml(existing.id) : 'Nouveau ticket'}</p>
            <h2>${existing ? 'Modifier le ticket' : 'Créer un ticket'}</h2>
          </div>
          <button class="close" data-action="close-modal">×</button>
        </div>
        <form id="ticket-form">
          <div class="modal-body">
            <div class="form-grid">
              <div class="field full">
                <label for="ticket-title">Nom de tâche</label>
                <input id="ticket-title" name="title" value="${escapeHtml(ticket.title)}" maxlength="120" required />
              </div>
              <div class="field full">
                <label for="ticket-description">Description</label>
                <textarea id="ticket-description" name="description" maxlength="520">${escapeHtml(ticket.description || '')}</textarea>
              </div>
              <div class="field">
                <label for="ticket-owner">Responsable</label>
                <select id="ticket-owner" name="ownerId" required>
                  ${state.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === ticket.ownerId ? 'selected' : ''}>${escapeHtml(profile.display_name)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="ticket-priority">Priorité</label>
                <select id="ticket-priority" name="priority">
                  ${BACKLOG_PRIORITIES.map((value) => option(value, ticket.priority)).join('')}
                </select>
              </div>
              <div class="field full">
                <label for="ticket-source">Source</label>
                <select id="ticket-source" name="source">
                  <option value="">Non renseignée</option>
                  ${BACKLOG_SOURCES.map((value) => option(value, ticket.source || '')).join('')}
                </select>
              </div>
              <div class="field full ticket-tag-field">
                <div class="ticket-tag-section-head">
                  <label>Tags</label>
                  <button class="ticket-tag-manage" type="button" data-action="toggle-ticket-tag-delete-mode" aria-label="Gérer la suppression des tags" title="Supprimer des tags">
                    <span aria-hidden="true">🗑︎</span>
                  </button>
                </div>
                <div class="ticket-tag-delete-bar" aria-live="polite">
                  <span><b data-tag-delete-count>0</b> sélectionné</span>
                  <button type="button" data-action="cancel-ticket-tag-delete">Annuler</button>
                  <button class="danger" type="button" data-action="delete-selected-ticket-tags" disabled>Supprimer</button>
                </div>
                <div class="ticket-tag-picker">
                  ${state.backlogTags.map((tag) => ticketTagChoiceMarkup(tag, selectedTagNames.has(tag.name))).join('')}
                </div>
              </div>
              <div class="field">
                <label for="ticket-new-tag">Nouveau tag</label>
                <div class="ticket-new-tag-control">
                  <input id="ticket-new-tag" name="newTag" maxlength="48" placeholder="Nom du tag" />
                  <button class="button small" type="button" data-action="create-ticket-tag">Créer</button>
                </div>
              </div>
              <div class="field">
                <label>Couleur du nouveau tag</label>
                <div class="ticket-color-picker" role="radiogroup" aria-label="Couleur du nouveau tag">
                  <label class="ticket-color-choice neutral" title="Blanc">
                    <input type="radio" name="newTagColorKey" value="white" aria-label="Blanc" checked />
                    <span aria-hidden="true"></span>
                  </label>
                  ${USER_COLORS.map((color) => `
                    <label class="ticket-color-choice" style="--tag-primary: ${escapeHtml(color.primary)}; --tag-secondary: ${escapeHtml(color.secondary)}" title="${escapeHtml(color.label)}">
                      <input type="radio" name="newTagColorKey" value="${escapeHtml(color.id)}" aria-label="${escapeHtml(color.label)}" />
                      <span aria-hidden="true"></span>
                    </label>
                  `).join('')}
                </div>
              </div>
              <div class="field full">
                <label for="ticket-attachment">Pièce jointe</label>
                <input id="ticket-attachment" name="attachmentFile" type="file" accept="image/*" />
                <input id="ticket-attachment-data" name="attachmentData" type="hidden" value="" />
                <p class="field-help">${ticket.attachment ? `Actuelle : ${escapeHtml(ticket.attachment.name)}` : 'Optionnel. Une image légère est stockée localement en mode prototype.'}</p>
              </div>
              ${ticket.attachment ? `
                <label class="check-field full">
                  <input type="checkbox" name="removeAttachment" />
                  Retirer la pièce jointe actuelle
                </label>
              ` : ''}

            </div>
          </div>
          <div class="modal-footer split-footer">
            <div>
              ${existing ? `<button class="button danger" type="button" data-action="delete-ticket" data-ticket-id="${escapeHtml(existing.id)}">Supprimer</button>` : ''}
            </div>
            <div>
              <button class="button" type="button" data-action="close-modal">Annuler</button>
              <button class="button primary" type="submit">Enregistrer</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `
}

function ticketTagChoiceMarkup(tag, selected = false) {
  return `
    <div class="ticket-tag-item" data-ticket-tag-item="${escapeHtml(tag.name)}">
      <label class="ticket-tag-choice" style="--tag-primary: ${escapeHtml(tag.primary)}; --tag-secondary: ${escapeHtml(tag.secondary)}">
        <input type="checkbox" name="tags" value="${escapeHtml(tag.name)}" ${selected ? 'checked' : ''} />
        <i aria-hidden="true"></i>
        <span>${escapeHtml(tag.name)}</span>
      </label>
    </div>
  `
}

function profileModalMarkup() {
  const profile = state.profile
  const selectedAvatar = USER_AVATARS.some((avatar) => avatar.id === profile.avatar_key)
    ? profile.avatar_key
    : USER_AVATARS[0].id
  const selectedColor = profileColor(profile)
  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal narrow">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Compte prototype</p>
            <h2>Modifier le compte</h2>
          </div>
          <button class="close" data-action="close-modal">×</button>
        </div>
        <form id="profile-form">
          <div class="modal-body">
            <div class="profile-editor-head">
              ${profileAvatarMarkup(profile, 'profile-avatar-preview')}
              <div>
                <strong>${escapeHtml(profile.display_name)}</strong>
                <span>${escapeHtml(profile.role || 'Rôle à préciser')}</span>
              </div>
            </div>
            <div class="form-grid">
              <div class="field">
                <label for="profile-display-name">Nom affiché</label>
                <input id="profile-display-name" name="displayName" value="${escapeHtml(profile.display_name)}" maxlength="60" required />
              </div>
              <div class="field">
                <label for="profile-role">Rôle</label>
                <input id="profile-role" name="role" value="${escapeHtml(profile.role || '')}" maxlength="80" />
              </div>
              <fieldset class="field full avatar-picker">
                <legend>Avatar prédéfini</legend>
                <div class="avatar-choice-grid">
                  ${USER_AVATARS.map((avatar) => `
                    <label class="avatar-choice" title="${escapeHtml(avatar.label)}" aria-label="${escapeHtml(avatar.label)}">
                      <input type="radio" name="avatarKey" value="${escapeHtml(avatar.id)}" ${selectedAvatar === avatar.id ? 'checked' : ''} />
                      <span class="avatar-choice-preview" style="--avatar-primary: ${escapeHtml(selectedColor.primary)}; --avatar-secondary: ${escapeHtml(selectedColor.secondary)}; --avatar-icon: url('${escapeHtml(avatar.icon)}')">
                        <span class="profile-avatar-icon" aria-hidden="true"></span>
                      </span>
                    </label>
                  `).join('')}
                </div>
              </fieldset>
              <fieldset class="field full color-picker">
                <legend>Couleur</legend>
                <div class="color-choice-grid">
                  ${USER_COLORS.map((color) => `
                    <label class="color-choice" title="${escapeHtml(color.label)}" aria-label="${escapeHtml(color.label)}">
                      <input type="radio" name="accentKey" value="${escapeHtml(color.id)}" ${selectedColor.id === color.id ? 'checked' : ''} />
                      <span class="color-choice-swatch" style="--profile-primary: ${escapeHtml(color.primary)}"></span>
                    </label>
                  `).join('')}
                </div>
              </fieldset>
            </div>
          </div>
          <div class="modal-footer">
            <button class="button" type="button" data-action="close-modal">Annuler</button>
            <button class="button primary" type="submit">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  `
}

function editModalMarkup() {
  const existing = state.questions.find((question) => question.id === state.modal.id)
  const question = existing || {
    id: '',
    question: '',
    answer: '',
    wrongAnswers: [],
    explanation: '',
    category: CATEGORIES[0],
    difficulty: 'Moyen',
    milestones: 3,
    mode: 'Quiz',
    challengeType: 'Aucun',
    tags: [],
    source: '',
    sourcePage: '',
    revisionNotes: '',
    favorite: false,
    status: 'pending',
  }
  const viewers = existing ? state.presence[existing.id] || [] : []

  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal">
        <div class="modal-head">
          <div>
            <p class="eyebrow">${existing ? escapeHtml(existing.id) : 'Nouvelle carte'}</p>
            <h2>${existing ? 'Modifier la question' : 'Créer une question'}</h2>
          </div>
          <button class="close" data-action="close-modal">×</button>
        </div>
        <form id="question-form">
          <div class="modal-body">
            ${viewers.length ? `<div class="presence-banner"><i></i>${escapeHtml(viewers.join(' et '))} consulte aussi cette carte en temps réel.</div>` : ''}
            <div class="form-grid">
              <div class="field full">
                <label for="question">Question</label>
                <textarea id="question" name="question" required>${escapeHtml(question.question)}</textarea>
              </div>
              <div class="field">
                <label for="answer">Bonne réponse</label>
                <input id="answer" name="answer" value="${escapeHtml(question.answer)}" required />
              </div>
              <div class="field" id="wrong-answer-1-field">
                <label for="wrongAnswer1">Fausse réponse 1</label>
                <input id="wrongAnswer1" name="wrongAnswer1" value="${escapeHtml(question.wrongAnswers[0] || '')}" />
              </div>
              <div class="field" id="wrong-answer-2-field">
                <label for="wrongAnswer2">Fausse réponse 2</label>
                <input id="wrongAnswer2" name="wrongAnswer2" value="${escapeHtml(question.wrongAnswers[1] || '')}" />
              </div>
              <p class="field-help full" id="wrong-help"></p>
              <div class="field full">
                <label for="explanation">Explication</label>
                <textarea id="explanation" name="explanation">${escapeHtml(question.explanation)}</textarea>
              </div>

              <h3 class="form-section-title">Classement dans le jeu</h3>
              <div class="field">
                <label for="category">Catégorie</label>
                <select id="category" name="category">${CATEGORIES.map((value) => option(value, question.category)).join('')}</select>
              </div>
              <div class="field difficulty-field">
                <label>Difficulté et jalons</label>
                ${difficultyControlMarkup(question)}
              </div>
              <div class="field">
                <label for="mode">Type</label>
                <select id="mode" name="mode">
                  ${option('Quiz', question.mode)}
                  ${option('Défi', question.mode)}
                </select>
              </div>
              <div class="field" id="challenge-field">
                <label for="challengeType">Type de défi</label>
                <select id="challengeType" name="challengeType">${CHALLENGES.map((value) => option(value, question.challengeType)).join('')}</select>
              </div>

              <h3 class="form-section-title">Informations éditoriales</h3>
              <div class="field">
                <label for="source">Source</label>
                <input id="source" name="source" value="${escapeHtml(question.source)}" />
              </div>
              <div class="field">
                <label for="sourcePage">Page source</label>
                <input id="sourcePage" name="sourcePage" value="${escapeHtml(question.sourcePage)}" />
              </div>
              <div class="field full">
                <label for="tags">Tags libres</label>
                <input id="tags" name="tags" value="${escapeHtml(question.tags.join(' | '))}" />
              </div>
              <div class="field full">
                <label for="revisionNotes">Note de révision</label>
                <textarea id="revisionNotes" name="revisionNotes">${escapeHtml(question.revisionNotes)}</textarea>
              </div>
              <label class="check-field">
                <input type="checkbox" name="favorite" ${question.favorite ? 'checked' : ''} />
                Ajouter aux favoris
              </label>
            </div>
          </div>
          <div class="modal-footer split-footer">
            <div>
              ${existing ? `
                <button class="button" type="button" data-card-action="comments" data-id="${escapeHtml(existing.id)}">Discussion (${existing.commentCount})</button>
                <button class="button" type="button" data-card-action="history" data-id="${escapeHtml(existing.id)}">Historique</button>
                <button class="button danger" type="button" data-card-action="trash" data-id="${escapeHtml(existing.id)}">Mettre à la corbeille</button>
              ` : ''}
            </div>
            <div>
              <button class="button" type="button" data-action="close-modal">Annuler</button>
              <button class="button primary" type="submit">Enregistrer</button>
              <button class="button accent" type="submit" name="saveIntent" value="approve">Enregistrer et valider</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `
}

function commentsModalMarkup() {
  const question = state.questions.find((item) => item.id === state.modal.id)
  const comments = state.comments.filter((comment) => comment.question_id === question.id)
  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal narrow">
        <div class="modal-head">
          <div><p class="eyebrow">${escapeHtml(question.id)}</p><h2>Discussion</h2></div>
          <button class="close" data-action="close-modal">×</button>
        </div>
        <div class="modal-body">
          <p class="question-context">${escapeHtml(question.question)}</p>
          <div class="chat-list">
            ${comments.length ? comments.map(commentMarkup).join('') : '<p class="subhead">Aucun message pour le moment.</p>'}
          </div>
          <form id="comment-form" class="comment-form">
            <textarea name="body" maxlength="2000" placeholder="Écrire un message… Tu peux mentionner @Lucas ou @Awen." required></textarea>
            <button class="button primary" type="submit">Envoyer</button>
          </form>
        </div>
        <div class="modal-footer">
          <button class="button" data-card-action="edit" data-id="${escapeHtml(question.id)}">Retour à la carte</button>
        </div>
      </div>
    </div>
  `
}

function commentMarkup(comment) {
  const mine = comment.author_id === state.profile.id
  return `
    <div class="chat-message ${mine ? 'mine' : ''}">
      <div class="chat-meta">
        ${profileBadgeMarkup(comment.author_id, profileName(comment.author_id))}
        <span>${formatDate(comment.created_at)}</span>
      </div>
      <p>${mentionMarkup(comment.body)}</p>
      ${mine ? `<button class="text-button delete-comment" data-delete-comment="${comment.id}">Supprimer</button>` : ''}
    </div>
  `
}

function historyModalMarkup() {
  const question = state.questions.find((item) => item.id === state.modal.id)
  const entries = state.modal.entries
  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal history-modal">
        <div class="modal-head">
          <div><p class="eyebrow">${escapeHtml(question.id)}</p><h2>Historique de la carte</h2></div>
          <button class="close" data-action="close-modal">×</button>
        </div>
        <div class="modal-body">
          ${entries === null
            ? '<div class="loading-bar"><span></span></div>'
            : entries.length
              ? `<div class="history-list">${entries.map(historyEntryMarkup).join('')}</div>`
              : '<p class="subhead">Aucune action enregistrée.</p>'}
        </div>
        <div class="modal-footer">
          <button class="button" data-card-action="edit" data-id="${escapeHtml(question.id)}">Retour à la carte</button>
        </div>
      </div>
    </div>
  `
}

function historyEntryMarkup(entry) {
  const changes = changedFields(entry.snapshot_before, entry.snapshot_after)
  return `
    <article class="history-item">
      <div class="history-head">
        <div>
          <strong>${escapeHtml(historyActionLabel(entry.action))}</strong>
          <span>${escapeHtml(profileName(entry.actor_id) || 'Système')} · ${formatDate(entry.created_at)}</span>
        </div>
        ${entry.detail ? `<em>${escapeHtml(entry.detail)}</em>` : ''}
      </div>
      ${changes.length ? `
        <details class="history-diff">
          <summary>Voir les changements</summary>
          ${changes.map((change) => `
            <div class="diff-field">
              <b>${escapeHtml(change.label)}</b>
              <div class="diff-text">${wordDiffMarkup(change.before, change.after)}</div>
            </div>
          `).join('')}
        </details>
      ` : ''}
    </article>
  `
}

function exportModalMarkup() {
  const validated = state.questions.filter((question) => !question.deletedAt && question.status === 'validated')
  const quiz = validateExport(validated, 'quiz')
  const duels = validateExport(validated, 'duels')
  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal narrow">
        <div class="modal-head">
          <div><p class="eyebrow">Export vers le jeu</p><h2>Quel fichier veux-tu générer ?</h2></div>
          <button class="close" data-action="close-modal">×</button>
        </div>
        <div class="modal-body">
          <p class="subhead export-intro">Chaque export contient toutes les cartes validées du type choisi. Les sources, pages, commentaires et historiques restent dans le studio.</p>
          ${exportChoiceMarkup('quiz', 'quiz.json', quiz, 'Questions classiques regroupées par catégorie.')}
          ${exportChoiceMarkup('duels', 'duels.json', duels, 'Buzzer, Vrai/Faux et Chiffres. Les défis Zoom existants sont préservés.')}
          ${state.exports.length ? `
            <div class="recent-exports">
              <h3>Derniers exports</h3>
              ${state.exports.slice(0, 4).map((batch) => `
                <p><b>${batch.kind === 'quiz' ? 'quiz.json' : 'duels.json'}</b><span>${batch.question_count} cartes · ${formatDate(batch.created_at)} · ${escapeHtml(profileName(batch.created_by))}</span></p>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `
}

function exportChoiceMarkup(kind, filename, validation, description) {
  return `
    <section class="export-choice">
      <div>
        <h3>${filename}</h3>
        <p>${description}</p>
        <span>${validation.questions.length} question${validation.questions.length > 1 ? 's' : ''} validée${validation.questions.length > 1 ? 's' : ''}</span>
      </div>
      <button class="button primary" data-export-kind="${kind}" ${!validation.questions.length || validation.errors.length ? 'disabled' : ''}>Exporter</button>
      ${validation.errors.length ? `
        <details class="export-errors">
          <summary>${validation.errors.length} erreur${validation.errors.length > 1 ? 's' : ''} à corriger</summary>
          ${validation.errors.map((error) => `<p>${escapeHtml(error)}</p>`).join('')}
        </details>
      ` : ''}
    </section>
  `
}

function statusHelpMarkup() {
  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal narrow">
        <div class="modal-head"><h2>Les états du studio</h2><button class="close" data-action="close-modal">×</button></div>
        <div class="modal-body status-guide">
          <div class="status-guide-item pending"><span class="status pending">En attente</span><p>La carte attend une première validation, ou a été remise à zéro.</p></div>
          <div class="status-guide-item review"><span class="status review">En révision</span><p>La carte doit être corrigée. Ses validations sont retirées.</p></div>
          <div class="status-guide-item approved"><span class="status approved">Une validation</span><p>Lucas ou Awen a validé. L’autre compte doit encore donner son avis.</p></div>
          <div class="status-guide-item validated"><span class="status validated">Validée</span><p>Lucas et Awen ont validé. La carte peut être exportée.</p></div>
          <div class="status-guide-item exported-guide"><span class="tag exported">Déjà exportée</span><p>La carte figurait dans le dernier JSON généré. Une modification la marquera automatiquement comme modifiée depuis l’export.</p></div>
        </div>
      </div>
    </div>
  `
}

function bindEvents() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', handleAction)
  })
  document.querySelectorAll('[data-card-action]').forEach((button) => {
    button.addEventListener('click', handleCardAction)
  })
  document.querySelectorAll('[data-status-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.trashMode = false
      state.statusFilter = button.dataset.statusFilter
      render()
    })
  })
  document.querySelectorAll('[data-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      state[`${select.dataset.filter}Filter`] = select.value
      render()
    })
  })
  document.querySelectorAll('[data-backlog-filter]').forEach((field) => {
    const eventName = field.dataset.backlogFilter === 'search' ? 'input' : 'change'
    field.addEventListener(eventName, () => {
      updateBacklogFilter(field.dataset.backlogFilter, field.value)
    })
  })
  document.querySelectorAll('.ticket-tag-choice').forEach((choice) => {
    choice.addEventListener('click', handleTicketTagChoiceClick)
  })
  document.querySelectorAll('[data-worklog-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      state[`${select.dataset.worklogFilter}Filter`] = select.value
      render()
    })
  })
  document.querySelectorAll('[data-column-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      toggleBacklogColumn(input.dataset.columnToggle, input.checked)
    })
  })
  document.querySelectorAll('[data-backlog-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextView = button.dataset.backlogView
      if (!['priority', 'flow'].includes(nextView) || nextView === state.backlogView) return
      state.backlogView = nextView
      localStorage.setItem(BACKLOG_VIEW_KEY, nextView)
      render()
    })
  })
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view
      localStorage.setItem(VIEW_KEY, state.view)
      render()
    })
  })
  document.querySelectorAll('[data-open-card]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea, summary')) return
      state.mobileFiltersOpen = false
      openModal({ type: 'edit', id: card.dataset.openCard })
    })
  })
  document.querySelectorAll('[data-close-modal]').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal()
    })
  })
  document.querySelectorAll('[data-export-kind]').forEach((button) => {
    button.addEventListener('click', () => exportGameFile(button.dataset.exportKind))
  })
  document.querySelectorAll('[data-delete-comment]').forEach((button) => {
    button.addEventListener('click', () => deleteComment(Number(button.dataset.deleteComment)))
  })
  document.querySelectorAll('[data-difficulty-step]').forEach((button) => {
    button.addEventListener('click', () => shiftFormDifficulty(Number(button.dataset.difficultyStep)))
  })
  document.querySelectorAll('[data-ticket-id][draggable="true"]').forEach((card) => {
    card.addEventListener('dragstart', handleTicketDragStart)
    card.addEventListener('dragend', handleTicketDragEnd)
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea')) return
      openModal({ type: 'ticket', id: card.dataset.ticketId })
    })
  })
  document.querySelectorAll('[data-priority-ticket-id]').forEach((item) => {
    const openTicket = (event) => {
      if (event.target.closest('input, button, a, select, textarea, .todo-flow')) return
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return
      if (event.type === 'keydown') event.preventDefault()
      openModal({ type: 'ticket', id: item.dataset.priorityTicketId })
    }
    item.addEventListener('click', openTicket)
    item.addEventListener('keydown', openTicket)
  })
  document.querySelectorAll('.todo-flow').forEach((flow) => {
    const steps = [...flow.querySelectorAll('[data-priority-status-target]')]
    const activeStep = flow.querySelector('.todo-flow-step.active')
    const startIndex = Number(flow.dataset.currentStatusIndex)
    let pointerId = null
    let startX = 0
    let previewIndex = startIndex
    let didDrag = false
    let suppressClick = false

    const clearPreview = () => {
      flow.classList.remove('is-scrubbing')
      steps.forEach((step) => step.classList.remove('drag-origin', 'drag-preview', 'drag-path'))
    }

    const previewAt = (clientX) => {
      let nearestIndex = startIndex
      let nearestDistance = Infinity

      steps.forEach((step, index) => {
        const rect = step.getBoundingClientRect()
        const distance = Math.abs(clientX - (rect.left + rect.width / 2))
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = index
        }
      })

      previewIndex = Math.max(0, Math.min(steps.length - 1, nearestIndex))
      const firstPathIndex = Math.min(startIndex, previewIndex)
      const lastPathIndex = Math.max(startIndex, previewIndex)

      steps.forEach((step, index) => {
        step.classList.toggle('drag-origin', index === startIndex)
        step.classList.toggle('drag-preview', index === previewIndex)
        step.classList.toggle('drag-path', index >= firstPathIndex && index <= lastPathIndex)
      })
    }

    steps.forEach((step) => {
      step.addEventListener('click', (event) => {
        event.stopPropagation()
        if (suppressClick) {
          suppressClick = false
          return
        }

        const ticket = state.backlog.find((item) => item.id === flow.dataset.ticketId)
        const status = step.dataset.status
        if (ticket && BACKLOG_STATUSES.includes(status) && ticket.status !== status) {
          moveBacklogTicket(ticket.id, status)
        }
      })
    })

    activeStep?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.stopPropagation()
      pointerId = event.pointerId
      startX = event.clientX
      previewIndex = startIndex
      didDrag = false
      activeStep.setPointerCapture(pointerId)
      flow.classList.add('is-scrubbing')
      previewAt(event.clientX)
    })

    activeStep?.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return
      event.stopPropagation()
      if (Math.abs(event.clientX - startX) > 3) didDrag = true
      previewAt(event.clientX)
    })

    const finishScrub = (event, commit = true) => {
      if (pointerId !== event.pointerId) return
      event.stopPropagation()

      if (activeStep.hasPointerCapture(pointerId)) activeStep.releasePointerCapture(pointerId)
      const targetIndex = previewIndex
      pointerId = null
      suppressClick = didDrag
      clearPreview()

      if (!commit || !didDrag || targetIndex === startIndex) return
      const status = BACKLOG_STATUSES[targetIndex]
      const ticket = state.backlog.find((item) => item.id === flow.dataset.ticketId)
      if (ticket && status) moveBacklogTicket(ticket.id, status)
    }

    activeStep?.addEventListener('pointerup', (event) => finishScrub(event))
    activeStep?.addEventListener('pointercancel', (event) => finishScrub(event, false))
  })
  document.querySelectorAll('[data-drop-status]').forEach((column) => {
    column.addEventListener('dragover', handleTicketDragOver)
    column.addEventListener('dragleave', handleTicketDragLeave)
    column.addEventListener('drop', handleTicketDrop)
  })

  const questionForm = document.querySelector('#question-form')
  if (questionForm) {
    questionForm.addEventListener('submit', saveQuestion)
    questionForm.elements.mode.addEventListener('change', syncQuestionForm)
    questionForm.elements.challengeType.addEventListener('change', syncQuestionForm)
    syncQuestionForm()
  }

  document.querySelector('#comment-form')?.addEventListener('submit', addComment)
  document.querySelector('#ticket-form')?.addEventListener('submit', saveBacklogTicket)
  document.querySelector('#ticket-attachment')?.addEventListener('change', handleTicketAttachmentFile)
  document.querySelector('#idea-create-form')?.addEventListener('submit', createIdea)
  document.querySelector('[data-idea-edit-form]')?.addEventListener('submit', saveIdeaEdit)
  document.querySelector('[data-ideas-search]')?.addEventListener('input', updateIdeasSearch)
  document.querySelector('#playtest-form')?.addEventListener('submit', savePlaytestSession)
  document.querySelector('#worklog-patch-create')?.addEventListener('submit', createWorklogPatch)
  document.querySelector('#worklog-patch-notes')?.addEventListener('submit', saveWorklogPatchNotes)
  document.querySelector('#worklog-import-input')?.addEventListener('change', importWorklogInput)
  startWorklogTimer()
  const profileForm = document.querySelector('#profile-form')
  if (profileForm) {
    profileForm.addEventListener('submit', saveProfile)
    profileForm.addEventListener('input', syncProfilePreview)
    profileForm.addEventListener('change', syncProfilePreview)
  }
}

async function handleAction(event) {
  const action = event.currentTarget.dataset.action
  if (action !== 'account-menu') state.accountMenuOpen = false
  if (action !== 'mobile-filters') state.mobileFiltersOpen = false
  if (action === 'toggle-sidebar') {
    state.sidebarCollapsed = !state.sidebarCollapsed
    localStorage.setItem(SIDEBAR_KEY, String(state.sidebarCollapsed))
    render()
    return
  }
  if (action === 'pin-idea') {
    toggleIdeaPinned(event.currentTarget.dataset.ideaId)
    return
  }
  if (action === 'cancel-idea-edit') {
    state.editingIdeaId = null
    render()
    return
  }
  if (action === 'edit-idea') {
    editIdea(event.currentTarget.dataset.ideaId)
    return
  }
  if (action === 'delete-idea') {
    deleteIdea(event.currentTarget.dataset.ideaId)
    return
  }
  if (action === 'new-ticket') {
    const status = event.currentTarget.dataset.ticketStatus
    openModal({ type: 'ticket', id: null, prefill: { status: BACKLOG_STATUSES.includes(status) ? status : 'Backlog' } })
    return
  }
  if (action === 'edit-ticket') {
    openModal({ type: 'ticket', id: event.currentTarget.dataset.ticketId })
    return
  }
  if (action === 'create-ticket-tag') {
    createTicketTagFromModal()
    return
  }
  if (action === 'toggle-ticket-tag-delete-mode') {
    setTicketTagDeleteMode(true)
    return
  }
  if (action === 'cancel-ticket-tag-delete') {
    setTicketTagDeleteMode(false)
    return
  }
  if (action === 'delete-selected-ticket-tags') {
    deleteSelectedTicketTags()
    return
  }
  if (action === 'delete-ticket') {
    deleteBacklogTicket(event.currentTarget.dataset.ticketId)
    return
  }
  if (action === 'export-workspace') {
    exportWorkspaceSnapshot()
    return
  }  if (action === 'edit-profile') {
    openModal({ type: 'profile' })
    return
  }
  if (action === 'show-backlog-ticket') {
    showBacklogTicket(event.currentTarget.dataset.ticketId)
    return
  }
  if (action === 'set-backlog-feature') {
    setBacklogFeatureFilter(event.currentTarget.dataset.feature)
    return
  }
  if (action === 'new-playtest-ticket') {
    openModal({ type: 'ticket', id: null, prefill: playtestTicketDraft(event.currentTarget.dataset.playtestId) })
    return
  }

  if (action === 'playtest-create') {
    state.playtestEditingId = 'new'
    state.playtestEditorPhase = 'planning'
    openModal({ type: 'playtest', id: null })
    return
  }
  if (action === 'playtest-edit-plan') {
    const id = event.currentTarget.dataset.playtestId
    state.playtestEditingId = id
    state.playtestEditorPhase = 'planning'
    openModal({ type: 'playtest', id })
    return
  }
  if (action === 'playtest-complete') {
    beginPlaytestReport(event.currentTarget.dataset.playtestId)
    return
  }
  if (action === 'playtest-report') {
    const id = event.currentTarget.dataset.playtestId
    state.playtestEditingId = id
    state.playtestEditorPhase = 'report'
    openModal({ type: 'playtest', id })
    return
  }
  if (action === 'playtest-revert') {
    revertPlaytestReport(event.currentTarget.dataset.playtestId)
    return
  }
  if (action === 'playtest-cancel') {
    closeModal()
    return
  }
  if (action === 'worklog-create') {
    openModal({ type: 'worklog-patch' })
    return
  }
  if (action === 'worklog-select') {
    state.worklogSelectedId = event.currentTarget.dataset.id
    state.worklogFileHandle = null
    state.worklogFileId = null
    render()
    return
  }
  if (action === 'worklog-start') {
    const patch = selectedWorklogPatch()
    if (!patch) return
    try {
      await storeWorklogPatch(startSession(patch))
      showToast('Début de session enregistré.')
    } catch (error) {
      showToast(error.message)
    }
    return
  }
  if (action === 'worklog-end') {
    const patch = selectedWorklogPatch()
    if (!patch) return
    try {
      await storeWorklogPatch(endSession(patch))
      showToast('Fin de session enregistrée. Durée calculée.')
    } catch (error) {
      showToast(error.message)
    }
    return
  }
  if (action === 'worklog-export') {
    const patch = selectedWorklogPatch()
    if (patch) downloadWorklogPatch(patch)
    return
  }
  if (action === 'worklog-link-file') {
    await linkWorklogFile()
    return
  }
  if (action === 'worklog-open-file') {
    await openWorklogFile()
    return
  }
  if (action === 'worklog-close') {
    const patch = selectedWorklogPatch()
    if (!patch) return
    if (activeSession(patch)) return showToast('Termine la session avant de clore le patch.')
    await storeWorklogPatch({ ...patch, status: 'released' })
    showToast('Patch clos.')
    return
  }
  if (action === 'worklog-reopen') {
    const patch = selectedWorklogPatch()
    if (!patch) return
    await storeWorklogPatch({ ...patch, status: 'draft' })
    showToast('Patch rouvert.')
    return
  }
  if (action === 'clear-backlog-filters') {
    clearBacklogFilters()
    return
  }
  if (action === 'module') {
    const nextModule = event.currentTarget.dataset.module
    if (!MODULES.some((module) => module.id === nextModule)) return
    state.activeModule = nextModule
    state.mobileFiltersOpen = false
    state.accountMenuOpen = false
    render()
    return
  }
  if (action === 'account-menu') {
    state.mobileFiltersOpen = false
    state.accountMenuOpen = !state.accountMenuOpen
    render()
  }
  if (action === 'mobile-filters') {
    state.accountMenuOpen = false
    state.mobileFiltersOpen = !state.mobileFiltersOpen
    render()
  }
  if (action === 'new') openModal({ type: 'edit', id: null })
  if (action === 'export') openModal({ type: 'export' })
  if (action === 'status-help') openModal({ type: 'status-help' })
  if (action === 'close-modal') closeModal()
  if (action === 'favorite-filter') {
    state.favoriteOnly = !state.favoriteOnly
    render()
  }
  if (action === 'undo-last') await undoLastAction()
  if (action === 'trash') {
    state.trashMode = !state.trashMode
    render()
  }
  if (action === 'clear-filters') {
    state.statusFilter = state.categoryFilter = state.difficultyFilter = state.modeFilter = state.sourceFilter = 'all'
    state.favoriteOnly = false
    render()
  }
  if (action === 'logout') {
    if (mockMode) showToast('Mode prototype : déconnexion désactivée.')
    else await supabase.auth.signOut()
  }
  if (action === 'empty-trash') await emptyTrash()
}

function createIdea(event) {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(event.currentTarget))
  const now = new Date().toISOString()
  const idea = sanitizeIdea({
    id: createIdeaId(),
    title: data.title,
    content: data.content,
    colorKey: data.colorKey,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  })
  state.ideas = [idea, ...state.ideas]
  persistIdeas()
  event.currentTarget.reset()
  render()
  showToast('Idée ajoutée au carnet.')
}

function updateIdeasSearch(event) {
  const value = event.currentTarget.value
  state.ideasSearch = value
  render()
  const search = document.querySelector('[data-ideas-search]')
  search?.focus({ preventScroll: true })
  search?.setSelectionRange(value.length, value.length)
}

function toggleIdeaPinned(ideaId) {
  state.ideas = state.ideas.map((idea) =>
    idea.id === ideaId ? { ...idea, pinned: !idea.pinned, updatedAt: new Date().toISOString() } : idea,
  )
  persistIdeas()
  render()
}

function editIdea(ideaId) {
  if (!state.ideas.some((idea) => idea.id === ideaId)) return
  state.editingIdeaId = ideaId
  render()
  document.querySelector('[data-idea-edit-form] input[name="title"]')?.focus()
}

function saveIdeaEdit(event) {
  event.preventDefault()
  const id = event.currentTarget.dataset.ideaEditForm
  const data = Object.fromEntries(new FormData(event.currentTarget))
  state.ideas = state.ideas.map((idea) =>
    idea.id === id
      ? sanitizeIdea({ ...idea, title: data.title, content: data.content, colorKey: data.colorKey, updatedAt: new Date().toISOString() })
      : idea,
  )
  state.editingIdeaId = null
  persistIdeas()
  render()
  showToast('Idée mise à jour.')
}

function deleteIdea(ideaId) {
  const idea = state.ideas.find((item) => item.id === ideaId)
  if (!idea || !window.confirm('Supprimer l’idée « ' + idea.title + ' » ?')) return
  state.ideas = state.ideas.filter((item) => item.id !== ideaId)
  persistIdeas()
  render()
  showToast('Idée supprimée.')
}

function handleTicketDragStart(event) {
  const ticketId = event.currentTarget.dataset.ticketId
  if (!ticketId) return
  state.draggedTicketId = ticketId
  event.currentTarget.classList.add('dragging')
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-lcg-ticket', ticketId)
  event.dataTransfer.setData('text/plain', ticketId)
}

function handleTicketDragOver(event) {
  if (!state.draggedTicketId) return
  event.preventDefault()
  const column = event.currentTarget
  column.classList.add('drop-target')
  event.dataTransfer.dropEffect = 'move'
  updateTicketDropPreview(column, event.clientY)
}

function handleTicketDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  clearTicketDropPreview()
}

function handleTicketDrop(event) {
  event.preventDefault()
  event.currentTarget.classList.remove('drop-target')
  const ticketId = event.dataTransfer.getData('application/x-lcg-ticket') || state.draggedTicketId
  moveBacklogTicket(ticketId, event.currentTarget.dataset.dropStatus, state.dragInsertBeforeId)
}

function handleTicketDragEnd(event) {
  event.currentTarget.classList.remove('dragging')
  clearTicketDropPreview()
  state.draggedTicketId = null
  state.dragInsertStatus = null
  state.dragInsertBeforeId = null
}

function updateTicketDropPreview(column, clientY) {
  const status = column.dataset.dropStatus
  const dropzone = column.querySelector('.kanban-dropzone')
  if (!status || !dropzone) return

  const beforeCard = closestTicketAfterPointer(dropzone, clientY)
  const beforeId = beforeCard?.dataset.ticketId || null
  const currentPlaceholder = document.querySelector('.kanban-drop-preview')

  if (state.dragInsertStatus === status && state.dragInsertBeforeId === beforeId && currentPlaceholder) return

  clearTicketDropPreview()
  column.classList.add('drop-target')
  const placeholder = document.createElement('div')
  placeholder.className = 'kanban-drop-preview'
  placeholder.setAttribute('aria-hidden', 'true')
  if (beforeCard) dropzone.insertBefore(placeholder, beforeCard)
  else dropzone.append(placeholder)

  state.dragInsertStatus = status
  state.dragInsertBeforeId = beforeId
}

function closestTicketAfterPointer(dropzone, clientY) {
  return [...dropzone.querySelectorAll('.ticket-row:not(.dragging)')]
    .map((card) => {
      const rect = card.getBoundingClientRect()
      return {
        card,
        offset: clientY - rect.top - rect.height / 2,
      }
    })
    .filter((entry) => entry.offset < 0)
    .sort((left, right) => right.offset - left.offset)[0]?.card || null
}

function clearTicketDropPreview() {
  document.querySelectorAll('.kanban-column.drop-target').forEach((column) => {
    column.classList.remove('drop-target')
  })
  document.querySelectorAll('.kanban-drop-preview').forEach((preview) => {
    preview.remove()
  })
}

function moveBacklogTicket(ticketId, status, beforeTicketId = null) {
  if (!ticketId || !BACKLOG_STATUSES.includes(status)) return
  const ticket = state.backlog.find((item) => item.id === ticketId)
  if (!ticket) return

  const movedTicket = { ...ticket, status, updatedAt: new Date().toISOString() }
  const nextBacklog = state.backlog.filter((item) => item.id !== ticketId)
  const beforeIndex = beforeTicketId
    ? nextBacklog.findIndex((item) => item.id === beforeTicketId)
    : -1

  if (beforeIndex >= 0) nextBacklog.splice(beforeIndex, 0, movedTicket)
  else nextBacklog.push(movedTicket)

  state.backlog = nextBacklog
  state.draggedTicketId = null
  state.dragInsertStatus = null
  state.dragInsertBeforeId = null
  persistBacklog()
  state.lastMovedTicketId = ticketId
  render()
  window.setTimeout(() => {
    if (state.lastMovedTicketId === ticketId) state.lastMovedTicketId = null
  }, 480)
  showToast(`${ticket.id} déplacé vers ${status}.`)
}

function updateBacklogFilter(filter, value) {
  const key = {
    search: 'backlogSearch',
    owner: 'backlogOwnerFilter',
    feature: 'backlogFeatureFilter',
    tag: 'backlogTagFilter',
    source: 'backlogSourceFilter',
    priority: 'backlogPriorityFilter',
  }[filter]
  if (!key) return
  state[key] = value
  render()
  if (filter === 'search') {
    const searchInput = document.querySelector('[data-backlog-filter="search"]')
    searchInput?.focus({ preventScroll: true })
    searchInput?.setSelectionRange(value.length, value.length)
  }
}

function clearBacklogFilters() {
  state.backlogSearch = ''
  state.backlogOwnerFilter = 'all'
  state.backlogFeatureFilter = 'all'
  state.backlogTagFilter = 'all'
  state.backlogSourceFilter = 'all'
  state.backlogPriorityFilter = 'all'
  render()
}

function setBacklogFeatureFilter(feature) {
  if (!feature) return
  state.activeModule = 'backlog'
  state.backlogSearch = ''
  state.backlogFeatureFilter = feature
  render()
}

function toggleBacklogColumn(status, visible) {
  if (!BACKLOG_STATUSES.includes(status)) return
  const nextStatuses = new Set(state.visibleBacklogStatuses)

  if (visible) nextStatuses.add(status)
  else nextStatuses.delete(status)

  if (!nextStatuses.size) {
    showToast('Garde au moins une colonne visible.')
    render()
    return
  }

  state.visibleBacklogStatuses = BACKLOG_STATUSES.filter((item) => nextStatuses.has(item))
  persistVisibleBacklogStatuses()
  render()
}

function showBacklogTicket(ticketId) {
  if (!ticketId) return
  state.activeModule = 'backlog'
  state.backlogSearch = ticketId
  state.backlogOwnerFilter = 'all'
  state.backlogFeatureFilter = 'all'
  state.backlogTagFilter = 'all'
  state.backlogSourceFilter = 'all'
  state.backlogPriorityFilter = 'all'
  render()
}

function playtestTicketDraft(playtestId) {
  const playtest = state.playtests.find((item) => item.id === playtestId)
  if (!playtest) return {}
  return {
    title: 'Action ' + playtest.id + ' - ' + playtest.prototype,
    description: (playtest.nextActions || [])[0] || (playtest.issues || [])[0] || playtest.scenario,
    feature: 'Playtests',
    priority: 'Haute',
    source: '',
    tags: [],
    due: 'Cette semaine',
    objective: (playtest.nextActions || [])[0] || playtest.scenario,
    risk: (playtest.issues || [])[0] || 'Retour de playtest à préciser.',
    validation: 'Le ticket est relié aux constats de ' + playtest.id + ' et produit une action vérifiable.',
    playtestId,
  }
}
function createTicketTagFromModal() {
  const form = document.querySelector('#ticket-form')
  const nameInput = form?.querySelector('#ticket-new-tag')
  const picker = form?.querySelector('.ticket-tag-picker')
  if (!form || !nameInput || !picker) return

  const name = nameInput.value.trim()
  if (!name) {
    nameInput.focus()
    showToast('Donne un nom au nouveau tag.')
    return
  }

  const existingTag = state.backlogTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
  if (existingTag) {
    const existingInput = [...picker.querySelectorAll('input[name="tags"]')]
      .find((input) => input.value === existingTag.name)
    if (existingInput) existingInput.checked = true
    nameInput.value = ''
    showToast(`Le tag "${existingTag.name}" existe déjà et a été sélectionné.`)
    return
  }

  const colorKey = form.querySelector('input[name="newTagColorKey"]:checked')?.value || 'white'
  const tag = normalizeBacklogTag({ name, colorKey })
  state.backlogTags = [...state.backlogTags, tag]
  persistBacklogTags()

  picker.insertAdjacentHTML('afterbegin', ticketTagChoiceMarkup(tag, true))
  picker.firstElementChild?.querySelector('.ticket-tag-choice')
    ?.addEventListener('click', handleTicketTagChoiceClick)
  nameInput.value = ''
  const neutralColor = form.querySelector('input[name="newTagColorKey"][value="white"]')
  if (neutralColor) neutralColor.checked = true
  nameInput.focus()
  showToast(`Tag "${tag.name}" créé.`)
}

function handleTicketTagChoiceClick(event) {
  const field = event.currentTarget.closest('.ticket-tag-field')
  if (!field?.classList.contains('delete-mode')) return
  event.preventDefault()
  event.currentTarget.closest('.ticket-tag-item')?.classList.toggle('marked-for-delete')
  updateTicketTagDeleteBar(field)
}

function setTicketTagDeleteMode(active) {
  const field = document.querySelector('.ticket-tag-field')
  if (!field) return
  field.classList.toggle('delete-mode', active)
  field.querySelector('.ticket-tag-manage')?.setAttribute('aria-pressed', String(active))
  field.querySelectorAll('.ticket-tag-item').forEach((item) => item.classList.remove('marked-for-delete'))
  updateTicketTagDeleteBar(field)
}

function updateTicketTagDeleteBar(field) {
  const count = field.querySelectorAll('.ticket-tag-item.marked-for-delete').length
  const countLabel = field.querySelector('[data-tag-delete-count]')
  const deleteButton = field.querySelector('[data-action="delete-selected-ticket-tags"]')
  if (countLabel) countLabel.textContent = String(count)
  if (deleteButton) {
    deleteButton.disabled = count === 0
    deleteButton.textContent = count ? `Supprimer (${count})` : 'Supprimer'
  }
}

function deleteSelectedTicketTags() {
  const field = document.querySelector('.ticket-tag-field')
  const selectedItems = [...(field?.querySelectorAll('.ticket-tag-item.marked-for-delete') || [])]
  const names = selectedItems.map((item) => item.dataset.ticketTagItem).filter(Boolean)
  if (!names.length) return

  const affectedTickets = state.backlog.filter((ticket) =>
    sanitizeTicketTags(ticket.tags || ticket.tag).some((tag) => names.includes(tag.name)),
  ).length
  const ticketLabel = affectedTickets
    ? ` Ils seront aussi retirés de ${affectedTickets} ticket${affectedTickets > 1 ? 's' : ''}.`
    : ''
  if (!window.confirm(`Supprimer ${names.length} tag${names.length > 1 ? 's' : ''} ?${ticketLabel}`)) return

  state.backlogTags = state.backlogTags.filter((tag) => !names.includes(tag.name))
  state.backlog = state.backlog.map((ticket) => {
    const tags = sanitizeTicketTags(ticket.tags || ticket.tag).filter((tag) => !names.includes(tag.name))
    return { ...ticket, tags, tag: tags[0]?.name || '' }
  })
  persistBacklogTags()
  persistBacklog()
  selectedItems.forEach((item) => item.remove())
  setTicketTagDeleteMode(false)
  showToast(`${names.length} tag${names.length > 1 ? 's supprimés' : ' supprimé'}.`)
}
function saveBacklogTicket(event) {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(event.currentTarget))
  const existing = state.backlog.find((ticket) => ticket.id === state.modal.id)
  const owner = state.profiles.find((profile) => profile.id === data.ownerId) || state.profile
  const now = new Date().toISOString()
  const selectedTagNames = new FormData(event.currentTarget).getAll('tags')
  const newTagName = String(data.newTag || '').trim()
  const newTagColor = USER_COLORS.find((color) => color.id === data.newTagColorKey)
  let nextTags = selectedTagNames
    .map((name) => state.backlogTags.find((tag) => tag.name === name))
    .filter(Boolean)

  if (newTagName) {
    const newTag = normalizeBacklogTag({ name: newTagName, colorKey: newTagColor?.id || 'white' })
    const existingTag = state.backlogTags.find((tag) => tag.name.toLowerCase() === newTagName.toLowerCase())
    if (existingTag) {
      nextTags = [...nextTags, existingTag]
    } else {
      state.backlogTags = mergeBacklogTags([...state.backlogTags, newTag])
      persistBacklogTags()
      nextTags = [...nextTags, newTag]
    }
  }

  nextTags = sanitizeTicketTags(nextTags)
  const attachmentData = String(data.attachmentData || '').trim()
  const shouldRemoveAttachment = data.removeAttachment === 'on'
  const attachment = shouldRemoveAttachment
    ? null
    : attachmentData
      ? {
          name: event.currentTarget.elements.attachmentFile?.files?.[0]?.name || 'piece-jointe',
          type: event.currentTarget.elements.attachmentFile?.files?.[0]?.type || 'image',
          dataUrl: attachmentData,
        }
      : existing?.attachment || null
  const ticket = sanitizeBacklogTicket({
    ...(existing || {}),
    id: existing?.id || createBacklogTicketId(),
    title: data.title,
    description: data.description,
    status: existing ? existing.status : (BACKLOG_STATUSES.includes(state.modal.prefill?.status) ? state.modal.prefill.status : 'Backlog'),
    owner: owner.display_name,
    ownerId: owner.id,
    createdById: existing?.createdById || state.profile.id,
    priority: data.priority,
    source: data.source,
    tags: nextTags,
    due: existing?.due || state.modal.prefill?.due || 'À cadrer',
    feature: existing?.feature || state.modal.prefill?.feature || 'Backlog / Kanban',
    objective: existing?.objective || state.modal.prefill?.objective || '',
    risk: existing?.risk || state.modal.prefill?.risk || '',
    validation: existing?.validation || state.modal.prefill?.validation || '',
    attachment,
    updatedAt: now,
  })

  state.backlog = existing
    ? state.backlog.map((item) => item.id === existing.id ? ticket : item)
    : [...state.backlog, ticket]

  const playtestId = state.modal.prefill?.playtestId
  if (!existing && playtestId) {
    state.playtests = state.playtests.map((session) =>
      session.id === playtestId
        ? { ...session, relatedTicketIds: [...new Set([...(session.relatedTicketIds || []), ticket.id])] }
        : session,
    )
    persistPlaytests()
  }
  state.modal = null
  persistBacklog()
  render()
  showToast(existing ? `${ticket.id} mis à jour.` : `${ticket.id} créé.`)
}

function handleTicketAttachmentFile(event) {
  const file = event.currentTarget.files?.[0]
  if (!file) return
  if (file.size > 900000) {
    event.currentTarget.value = ''
    showToast('Pièce jointe trop lourde pour le mode prototype local.')
    return
  }

  const reader = new FileReader()
  reader.addEventListener('load', () => {
    const input = document.querySelector('#ticket-attachment-data')
    if (input) input.value = String(reader.result || '')
  })
  reader.readAsDataURL(file)
}

function deleteBacklogTicket(ticketId) {
  const ticket = state.backlog.find((item) => item.id === ticketId)
  if (!ticket) return
  if (!window.confirm(`Supprimer ${ticket.id} du backlog prototype ?`)) return
  state.backlog = state.backlog.filter((item) => item.id !== ticketId)
  state.modal = null
  persistBacklog()
  render()
  showToast(`${ticket.id} supprimé du backlog prototype.`)
}

function createBacklogTicketId() {
  const nextNumber = state.backlog.reduce((max, ticket) => {
    const match = /^LCG-(\d+)$/i.exec(ticket.id || '')
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  return `LCG-${String(nextNumber).padStart(2, '0')}`
}

async function saveProfile(event) {
  event.preventDefault()

  const data = Object.fromEntries(new FormData(event.currentTarget))
  const selectedColor = USER_COLORS.find((color) => color.id === data.accentKey) || profileColor(state.profile)
  const updatedProfile = sanitizeProfile({
    ...state.profile,
    display_name: data.displayName,
    role: data.role,
    avatar_url: '',
    avatar_key: data.avatarKey,
    accent_key: selectedColor.id,
    accent_color: selectedColor.primary,
    accent_secondary: selectedColor.secondary,
    updated_at: new Date().toISOString(),
  })

  if (!mockMode) {
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: updatedProfile.display_name,
        role: updatedProfile.role,
        avatar_key: updatedProfile.avatar_key,
        accent_key: updatedProfile.accent_key,
        accent_color: updatedProfile.accent_color,
        accent_secondary: updatedProfile.accent_secondary,
        updated_at: updatedProfile.updated_at,
      })
      .eq('id', updatedProfile.id)
    if (error) return showToast('Mise à jour du compte impossible : ' + friendlyError(error))
  }

  state.profiles = state.profiles.map((profile) =>
    profile.id === updatedProfile.id ? updatedProfile : profile,
  )
  state.profile = updatedProfile
  state.backlog = state.backlog.map((ticket) =>
    ticket.ownerId === updatedProfile.id
      ? { ...ticket, owner: updatedProfile.display_name }
      : ticket,
  )

  persistProfiles()
  persistBacklog()
  state.modal = null
  render()
  showToast('Compte prototype mis à jour.')
}

function syncProfilePreview(event) {
  const form = event.currentTarget
  const data = Object.fromEntries(new FormData(form))
  const selectedColor = USER_COLORS.find((color) => color.id === data.accentKey) || profileColor(state.profile)
  const previewProfile = sanitizeProfile({
    ...state.profile,
    display_name: data.displayName,
    role: data.role,
    avatar_url: '',
    avatar_key: data.avatarKey,
    accent_key: selectedColor.id,
    accent_color: selectedColor.primary,
    accent_secondary: selectedColor.secondary,
  })
  const preview = form.querySelector('.profile-avatar-preview')
  const name = form.querySelector('.profile-editor-head strong')
  const role = form.querySelector('.profile-editor-head span')
  if (preview) preview.outerHTML = profileAvatarMarkup(previewProfile, 'profile-avatar-preview').trim()
  if (name) name.textContent = previewProfile.display_name
  if (role) role.textContent = previewProfile.role || 'Rôle à préciser'
  form.querySelectorAll('.avatar-choice-preview').forEach((item) => {
    item.style.setProperty('--avatar-primary', previewProfile.accent_color)
    item.style.setProperty('--avatar-secondary', previewProfile.accent_secondary)
  })
}

async function handleCardAction(event) {
  event.stopPropagation()
  const { cardAction, id } = event.currentTarget.dataset
  if (cardAction === 'edit') openModal({ type: 'edit', id })
  if (cardAction === 'comments') openModal({ type: 'comments', id })
  if (cardAction === 'history') await openHistory(id)
  if (cardAction === 'approve') await approveQuestion(id)
  if (cardAction === 'revoke') await revokeApproval(id)
  if (cardAction === 'review') await changeStatus(id, 'review')
  if (cardAction === 'pending') await changeStatus(id, 'pending')
  if (cardAction === 'trash') await trashQuestion(id)
  if (cardAction === 'restore') await restoreQuestion(id)
  if (cardAction === 'favorite') await toggleFavorite(id)
  if (cardAction === 'difficulty') await changeQuestionDifficulty(id, Number(event.currentTarget.dataset.direction))
}

function openModal(modal) {
  state.modal = modal
  render()
  updatePresence()
}

function closeModal() {
  if (!state.modal) return
  if (state.modal.type === 'playtest') {
    state.playtestEditingId = null
    state.playtestEditorPhase = null
  }
  state.modal = null
  render()
  updatePresence(null)
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && state.modal) closeModal()
}

async function openHistory(id) {
  state.modal = { type: 'history', id, entries: null }
  render()
  updatePresence(id)
  if (mockMode) {
    const question = state.questions.find((item) => item.id === id)
    state.modal.entries = [{
      action: 'edited',
      actor_id: 'awen-preview',
      detail: 'Formulation simplifiée',
      created_at: new Date().toISOString(),
      snapshot_before: { question: `${question.question} Ancienne formulation.` },
      snapshot_after: { question: question.question },
    }]
    render()
    return
  }
  const { data, error } = await supabase
    .from('question_history')
    .select('*')
    .eq('question_id', id)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) return showToast(friendlyError(error))
  if (state.modal?.type === 'history' && state.modal.id === id) {
    state.modal.entries = data
    render()
  }
}

function syncQuestionForm() {
  const form = document.querySelector('#question-form')
  if (!form) return
  const isChallenge = form.elements.mode.value === 'Défi'
  const challenge = form.elements.challengeType.value
  const usesManualWrongAnswers = !isChallenge || challenge === 'Buzzer'
  const wrongFields = [
    form.querySelector('#wrong-answer-1-field'),
    form.querySelector('#wrong-answer-2-field'),
  ]
  form.querySelector('#challenge-field').hidden = !isChallenge
  wrongFields.forEach((field) => {
    field.hidden = !usesManualWrongAnswers
    field.querySelector('input').required = usesManualWrongAnswers
  })
  form.querySelector('#wrong-help').textContent = usesManualWrongAnswers
    ? 'Exactement 2 mauvaises réponses.'
    : challenge === 'Vrai/Faux'
      ? 'La bonne réponse doit être Vrai ou Faux. La réponse opposée sera générée automatiquement.'
      : 'Aucune mauvaise réponse pour un défi Chiffres.'
}

function shiftFormDifficulty(direction) {
  const stepper = document.querySelector('#question-form [data-difficulty-stepper]')
  if (!stepper) return
  const nextMilestone = clampMilestones(Number(stepper.dataset.milestone) + direction)
  const nextDifficulty = difficultyForMilestone(nextMilestone)
  stepper.dataset.milestone = String(nextMilestone)
  stepper.querySelector('img').src = `/game/categorie/diff-${nextMilestone}.png`
  stepper.querySelector('img').alt = `${nextMilestone} jalons`
  stepper.querySelector('.difficulty-copy strong').textContent = `${nextMilestone} jalon${nextMilestone > 1 ? 's' : ''}`
  stepper.querySelector('.difficulty-copy span').textContent = nextDifficulty
  stepper.querySelector('input[name="milestones"]').value = String(nextMilestone)
  stepper.querySelector('input[name="difficulty"]').value = nextDifficulty
  stepper.querySelector('[data-difficulty-step="-1"]').disabled = nextMilestone <= 1
  stepper.querySelector('[data-difficulty-step="1"]').disabled = nextMilestone >= 5
}

async function saveQuestion(event) {
  event.preventDefault()
  if (mockMode) return showToast('Mode prototype : aucune donnée n’est enregistrée.')
  const form = event.currentTarget
  const data = Object.fromEntries(new FormData(form))
  const shouldApproveAfterSave = event.submitter?.value === 'approve'
  const existing = state.questions.find((question) => question.id === state.modal.id)
  const mode = data.mode
  const challengeType = mode === 'Défi' ? data.challengeType : 'Aucun'
  let wrongAnswers = [data.wrongAnswer1, data.wrongAnswer2]
    .map((answer) => String(answer || '').trim())
    .filter(Boolean)

  if (challengeType === 'Vrai/Faux') {
    const answer = data.answer.trim().toLowerCase()
    if (!['vrai', 'faux', 'true', 'false'].includes(answer)) {
      showToast('Pour un Vrai/Faux, la bonne réponse doit être Vrai ou Faux.')
      return
    }
    wrongAnswers = [['vrai', 'true'].includes(answer) ? 'Faux' : 'Vrai']
  } else if (challengeType === 'Chiffres') {
    wrongAnswers = []
  } else if (wrongAnswers.length !== 2) {
    showToast('Cette question doit contenir exactement 2 mauvaises réponses.')
    return
  }

  const id = existing?.id || createQuestionId()
  const nextVersion = existing ? existing.version + 1 : 1
  const row = {
    id,
    question: data.question.trim(),
    answer: data.answer.trim(),
    wrong_answers: wrongAnswers,
    explanation: data.explanation.trim(),
    category: data.category,
    difficulty: difficultyForMilestone(data.milestones),
    milestones: clampMilestones(data.milestones),
    mode,
    challenge_type: challengeType,
    status: existing?.status === 'review' ? 'review' : 'pending',
    tags: splitPipe(data.tags),
    source: data.source.trim(),
    source_page: data.sourcePage.trim(),
    revision_notes: data.revisionNotes.trim(),
    favorite: data.favorite === 'on',
    confidence: existing?.confidence || 1,
    version: nextVersion,
    created_by: existing?.createdBy || state.profile.id,
    updated_by: state.profile.id,
    updated_at: new Date().toISOString(),
  }

  let saved
  let error
  if (existing) {
    const result = await supabase
      .from('questions')
      .update(row)
      .eq('id', existing.id)
      .eq('version', existing.version)
      .select()
      .maybeSingle()
    saved = result.data
    error = result.error
    if (!error && !saved) {
      showToast('Cette carte a été modifiée ailleurs. Les nouvelles données viennent d’être rechargées.')
      await loadWorkspace({ quiet: true })
      return
    }
    if (!error) {
      const approvalsResult = await supabase
        .from('question_approvals')
        .delete()
        .eq('question_id', existing.id)
      error = approvalsResult.error
    }
  } else {
    const result = await supabase.from('questions').insert(row).select().single()
    saved = result.data
    error = result.error
  }

  if (error) return showToast(friendlyError(error))

  await supabase.from('question_history').insert({
    question_id: id,
    actor_id: state.profile.id,
    action: existing ? 'edited' : 'created',
    detail: existing ? 'Contenu modifié · validations annulées' : 'Nouvelle carte créée',
    snapshot_before: existing ? questionToDatabaseSnapshot(existing) : null,
    snapshot_after: saved,
  })

  if (shouldApproveAfterSave) {
    const approvalResult = await supabase.rpc('approve_question', { p_question_id: id })
    if (approvalResult.error) return showToast(friendlyError(approvalResult.error))
    rememberUndo({ type: 'revoke-approval', id, label: `validation de ${id}` })
  } else {
    forgetUndo()
  }

  state.modal = null
  await loadWorkspace({ quiet: true })
  updatePresence(null)
  showToast(shouldApproveAfterSave
    ? 'Question enregistrée et validée par toi.'
    : existing ? 'Question enregistrée. Les validations ont été réinitialisées.' : 'Question créée.')
}

async function changeQuestionDifficulty(id, direction) {
  if (mockMode) return showToast('Mode prototype : difficulté non enregistrée.')
  const question = state.questions.find((item) => item.id === id)
  if (!question || !direction) return
  const nextMilestone = clampMilestones(question.milestones + direction)
  if (nextMilestone === clampMilestones(question.milestones)) return

  const nextDifficulty = difficultyForMilestone(nextMilestone)
  const { data: saved, error } = await supabase
    .from('questions')
    .update({
      difficulty: nextDifficulty,
      milestones: nextMilestone,
      status: question.status === 'review' ? 'review' : 'pending',
      version: question.version + 1,
      updated_by: state.profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('version', question.version)
    .select()
    .maybeSingle()

  if (error) return showToast(friendlyError(error))
  if (!saved) {
    showToast('Cette carte a été modifiée ailleurs. Les nouvelles données viennent d’être rechargées.')
    await loadWorkspace({ quiet: true })
    return
  }

  const approvalsResult = await supabase
    .from('question_approvals')
    .delete()
    .eq('question_id', id)
  if (approvalsResult.error) return showToast(friendlyError(approvalsResult.error))

  await supabase.from('question_history').insert({
    question_id: id,
    actor_id: state.profile.id,
    action: 'edited',
    detail: 'Difficulté modifiée · validations annulées',
    snapshot_before: questionToDatabaseSnapshot(question),
    snapshot_after: saved,
  })

  rememberUndo({
    type: 'difficulty',
    id,
    label: `difficulté de ${id}`,
    difficulty: question.difficulty,
    milestones: clampMilestones(question.milestones),
    status: question.status,
  })
  await loadWorkspace({ quiet: true })
  showToast(`Difficulté passée en ${nextDifficulty}.`)
}

function rememberUndo(action) {
  state.lastUndo = action
}

function forgetUndo() {
  state.lastUndo = null
}

async function undoLastAction() {
  if (mockMode) return showToast('Mode prototype : annulation non enregistrée.')
  if (!state.lastUndo || state.undoing) return

  const undo = state.lastUndo
  state.undoing = true
  render()

  let error = null

  if (undo.type === 'revoke-approval') {
    const result = await supabase.rpc('revoke_my_approval', { p_question_id: undo.id })
    error = result.error
  }

  if (undo.type === 'approve') {
    const result = await supabase.rpc('approve_question', { p_question_id: undo.id })
    error = result.error
  }

  if (undo.type === 'restore') {
    const result = await supabase.rpc('restore_question', { p_question_id: undo.id })
    error = result.error
  }

  if (undo.type === 'trash') {
    const result = await supabase.rpc('move_question_to_trash', { p_question_id: undo.id })
    error = result.error
  }

  if (undo.type === 'favorite') {
    const result = await supabase
      .from('questions')
      .update({
        favorite: undo.favorite,
        updated_by: state.profile.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', undo.id)
    error = result.error
  }

  if (undo.type === 'difficulty') {
    const question = state.questions.find((item) => item.id === undo.id)
    if (!question) {
      error = { message: 'Question introuvable' }
    } else {
      const result = await supabase
        .from('questions')
        .update({
          difficulty: undo.difficulty,
          milestones: undo.milestones,
          status: undo.status,
          version: question.version + 1,
          updated_by: state.profile.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', undo.id)
        .eq('version', question.version)
        .select()
        .maybeSingle()
      error = result.error
      if (!error && !result.data) {
        state.lastUndo = undo
        state.undoing = false
        await loadWorkspace({ quiet: true })
        showToast('Cette carte a été modifiée ailleurs. Les nouvelles données viennent d’être rechargées.')
        return
      }
      if (!error) {
        await supabase.from('question_history').insert({
          question_id: undo.id,
          actor_id: state.profile.id,
          action: 'edited',
          detail: 'Annulation du changement de difficulté',
          snapshot_before: questionToDatabaseSnapshot(question),
          snapshot_after: result.data,
        })
      }
    }
  }

  if (error) {
    state.lastUndo = undo
    state.undoing = false
    render()
    showToast(friendlyError(error))
    return
  }

  state.lastUndo = null
  state.undoing = false
  await loadWorkspace({ quiet: true })
  showToast('Action annulée.')
}

async function approveQuestion(id) {
  if (mockMode) return showToast('Mode prototype : validation simulée uniquement.')
  const { error } = await supabase.rpc('approve_question', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  rememberUndo({ type: 'revoke-approval', id, label: `validation de ${id}` })
  await loadWorkspace({ quiet: true })
  showToast(`Validation ajoutée par ${state.profile.display_name}.`)
}

async function revokeApproval(id) {
  if (mockMode) return showToast('Mode prototype : validation simulée uniquement.')
  const { error } = await supabase.rpc('revoke_my_approval', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  rememberUndo({ type: 'approve', id, label: `retrait de validation de ${id}` })
  await loadWorkspace({ quiet: true })
  showToast('Ta validation a été retirée.')
}

async function changeStatus(id, status) {
  if (mockMode) return showToast('Mode prototype : changement non enregistré.')
  const label = status === 'review' ? 'en révision' : 'en attente'
  if (!window.confirm(`Passer cette carte ${label} ? Les validations actuelles seront retirées.`)) return
  const { error } = await supabase.rpc('set_question_status', {
    p_question_id: id,
    p_status: status,
  })
  if (error) return showToast(friendlyError(error))
  forgetUndo()
  await loadWorkspace({ quiet: true })
  showToast(`Carte passée ${label}.`)
}

async function trashQuestion(id) {
  if (mockMode) return showToast('Mode prototype : suppression non enregistrée.')
  if (!window.confirm('Déplacer cette carte dans la corbeille ?')) return
  const { error } = await supabase.rpc('move_question_to_trash', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  state.modal = null
  rememberUndo({ type: 'restore', id, label: `mise à la corbeille de ${id}` })
  await loadWorkspace({ quiet: true })
  showToast('Carte placée dans la corbeille.')
}

async function restoreQuestion(id) {
  if (mockMode) return showToast('Mode prototype : restauration non enregistrée.')
  const { error } = await supabase.rpc('restore_question', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  rememberUndo({ type: 'trash', id, label: `restauration de ${id}` })
  await loadWorkspace({ quiet: true })
  showToast('Carte restaurée.')
}

async function emptyTrash() {
  if (mockMode) return showToast('Mode prototype : corbeille non modifiée.')
  const count = state.questions.filter((question) => question.deletedAt).length
  if (!window.confirm(`Supprimer définitivement ${count} carte${count > 1 ? 's' : ''} ? Cette action est irréversible.`)) return
  const { error } = await supabase.rpc('empty_trash')
  if (error) return showToast(friendlyError(error))
  forgetUndo()
  await loadWorkspace({ quiet: true })
  showToast('Corbeille vidée.')
}

async function toggleFavorite(id) {
  if (mockMode) return showToast('Mode prototype : favori non enregistré.')
  const question = state.questions.find((item) => item.id === id)
  if (!question) return
  const { error } = await supabase
    .from('questions')
    .update({
      favorite: !question.favorite,
      updated_by: state.profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return showToast(friendlyError(error))
  rememberUndo({
    type: 'favorite',
    id,
    label: question.favorite ? `retrait du favori ${id}` : `favori ${id}`,
    favorite: question.favorite,
  })
  await loadWorkspace({ quiet: true })
}

function savePlaytestSession(event) {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(event.currentTarget))
  const existing = state.playtests.find((session) => session.id === state.modal?.id)
  const listFromLines = (value) => String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  if (state.playtestEditorPhase === 'report') {
    if (!existing) return
    const session = sanitizePlaytest({
      ...existing,
      status: 'Terminée',
      sentiment: data.sentiment,
      learnings: listFromLines(data.learnings),
      issues: listFromLines(data.issues),
      decisions: listFromLines(data.decisions),
      nextActions: listFromLines(data.nextActions),
      driveUrl: data.driveUrl,
    })
    state.playtests = state.playtests.map((item) => item.id === existing.id ? session : item)
    state.playtestEditingId = null
    state.playtestEditorPhase = null
    state.modal = null
    persistPlaytests()
    render()
    showToast(session.id + ' terminée et documentée.')
    return
  }

  const session = sanitizePlaytest({
    ...(existing || {}),
    id: existing?.id || createPlaytestId(),
    date: data.date,
    status: 'Planifiée',
    prototype: data.prototype,
    facilitatorId: data.facilitatorId,
    participants: String(data.participants || '').split(',').map((item) => item.trim()).filter(Boolean),
    duration: '',
    scenario: data.scenario,
    relatedTicketIds: existing?.relatedTicketIds || [],
  })
  state.playtests = existing
    ? state.playtests.map((item) => item.id === existing.id ? session : item)
    : [...state.playtests, session]
  state.playtestEditingId = null
  state.playtestEditorPhase = null
  state.modal = null
  persistPlaytests()
  render()
  showToast(existing ? session.id + ' replanifiée.' : session.id + ' planifiée.')
}

function beginPlaytestReport(id) {
  const session = state.playtests.find((item) => item.id === id)
  if (!session) return
  state.playtests = state.playtests.map((item) => item.id === id ? { ...item, status: 'À documenter' } : item)
  state.playtestEditingId = id
  state.playtestEditorPhase = 'report'
  persistPlaytests()
  openModal({ type: 'playtest', id })
}

function revertPlaytestReport(id) {
  const session = state.playtests.find((item) => item.id === id)
  if (!session || !window.confirm('Repasser cette session en planifiée ?')) return
  state.playtests = state.playtests.map((item) => item.id === id ? { ...item, status: 'Planifiée' } : item)
  state.playtestEditingId = null
  state.playtestEditorPhase = null
  state.modal = null
  persistPlaytests()
  render()
  showToast(session.id + ' repassée en planifiée.')
}
async function createWorklogPatch(event) {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(event.currentTarget))
  const version = String(data.version || '').trim()
  if (state.worklogPatches.some((patch) => patch.version === version)) return showToast('Cette version existe déjà.')
  try {
    state.modal = null
    await storeWorklogPatch(createPatch(version, String(data.title || '').trim()))
    showToast('Patch créé. Tu peux démarrer la première session.')
  } catch (error) {
    showToast(error.message)
  }
}

async function saveWorklogPatchNotes(event) {
  event.preventDefault()
  const patch = selectedWorklogPatch()
  if (!patch) return
  const data = Object.fromEntries(new FormData(event.currentTarget))
  await storeWorklogPatch({
    ...patch,
    summary: String(data.summary || '').trim(),
    changes: String(data.changes || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
  })
  showToast('Contenu du patch enregistré.')
}

async function importWorklogInput(event) {
  const file = event.currentTarget.files?.[0]
  if (!file) return
  try {
    const imported = importWorklogPatch(parsePatchMarkdown(await file.text()))
    if (imported) showToast('Patch Markdown importé.')
  } catch (error) {
    showToast(error.message)
  }
  event.currentTarget.value = ''
}

function importWorklogPatch(patch, handle = null) {
  const normalized = normalizePatch(patch)
  const existing = state.worklogPatches.find((item) => item.id === normalized.id || item.version === normalized.version)
  if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
    const confirmed = window.confirm('La version ' + normalized.version + ' existe déjà. La remplacer par le fichier importé ?')
    if (!confirmed) return false
  }
  state.worklogPatches = [
    normalized,
    ...state.worklogPatches.filter((item) => item.id !== normalized.id && item.version !== normalized.version),
  ]
  state.worklogSelectedId = normalized.id
  state.worklogFileHandle = handle
  state.worklogFileId = handle ? normalized.id : null
  persistWorklogPatches()
  render()
  return true
}

async function openWorklogFile() {
  if (!window.showOpenFilePicker) {
    document.querySelector('#worklog-import-input')?.click()
    return
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Patch LCG Markdown', accept: { 'text/markdown': ['.md'] } }],
      multiple: false,
    })
    const file = await handle.getFile()
    const imported = importWorklogPatch(parsePatchMarkdown(await file.text()), handle)
    if (imported) showToast('Patch ouvert et fichier lié.')
  } catch (error) {
    if (error.name !== 'AbortError') showToast(error.message)
  }
}

async function linkWorklogFile() {
  const patch = selectedWorklogPatch()
  if (!patch) return
  if (state.worklogFileHandle && state.worklogFileId === patch.id) {
    try {
      await writeWorklogFile(patch)
      showToast('Fichier Markdown actualisé.')
    } catch (error) {
      showToast(error.message)
    }
    return
  }
  if (!window.showSaveFilePicker) {
    downloadWorklogPatch(patch)
    showToast('Liaison indisponible : le Markdown a été téléchargé.')
    return
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: worklogFilename(patch),
      types: [{ description: 'Patch LCG Markdown', accept: { 'text/markdown': ['.md'] } }],
    })
    state.worklogFileHandle = handle
    state.worklogFileId = patch.id
    await writeWorklogFile(patch)
    render()
    showToast('Fichier Markdown lié. Il sera actualisé avec ce patch.')
  } catch (error) {
    if (error.name !== 'AbortError') showToast(error.message)
  }
}

async function writeWorklogFile(patch) {
  if (!state.worklogFileHandle) return
  const writable = await state.worklogFileHandle.createWritable()
  await writable.write(serializePatchMarkdown(patch))
  await writable.close()
}

function downloadWorklogPatch(patch) {
  const blob = new Blob([serializePatchMarkdown(patch)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = worklogFilename(patch)
  anchor.click()
  URL.revokeObjectURL(url)
}

function worklogFilename(patch) {
  const slug = patch.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `patch-${patch.version}-${slug || 'lcg-studio'}.md`
}

function startWorklogTimer() {
  clearInterval(state.worklogTimer)
  state.worklogTimer = null
  const element = document.querySelector('[data-worklog-timer]')
  if (!element) return
  const update = () => {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(element.dataset.start)) / 60000))
    element.textContent = formatMinutes(minutes)
  }
  update()
  state.worklogTimer = window.setInterval(update, 30000)
}
async function addComment(event) {
  event.preventDefault()
  if (mockMode) return showToast('Mode prototype : commentaire non envoyé.')
  const data = Object.fromEntries(new FormData(event.currentTarget))
  const body = data.body.trim()
  if (!body) return
  const { error } = await supabase.from('question_comments').insert({
    question_id: state.modal.id,
    author_id: state.profile.id,
    body,
  })
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  state.modal = { type: 'comments', id: state.modal.id }
  render()
}

async function deleteComment(id) {
  if (mockMode) return showToast('Mode prototype : commentaire non supprimé.')
  if (!window.confirm('Supprimer ce commentaire ?')) return
  const { error } = await supabase.from('question_comments').delete().eq('id', id)
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  render()
}

function exportWorkspaceSnapshot() {
  downloadJson(
    createWorkspaceSnapshot(state),
    `lcg-studio-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
  )
  state.accountMenuOpen = false
  render()
  showToast('Sauvegarde des modules téléchargée.')
}
async function exportGameFile(kind) {
  const validated = state.questions.filter((question) => !question.deletedAt && question.status === 'validated')
  const validation = validateExport(validated, kind)
  if (!validation.questions.length) return showToast('Aucune question validée pour cet export.')
  if (validation.errors.length) return showToast('Corrige les erreurs signalées avant l’export.')

  const payload = kind === 'quiz'
    ? createQuizJson(validation.questions)
    : createDuelsJson(validation.questions)
  const filename = kind === 'quiz' ? 'quiz.json' : 'duels.json'

  downloadJson(payload, filename)

  if (mockMode) {
    state.modal = null
    render()
    showToast(`${filename} généré en mode prototype.`)
    return
  }

  const { error } = await supabase.rpc('record_export', {
    p_kind: kind,
    p_question_ids: validation.questions.map((question) => question.id),
  })
  if (error) {
    showToast(`${filename} téléchargé, mais le suivi d’export n’a pas pu être enregistré.`)
    return
  }

  state.modal = null
  await loadWorkspace({ quiet: true })
  showToast(`${filename} est prêt à remplacer le fichier du jeu.`)
}

function questionToDatabaseSnapshot(question) {
  return {
    id: question.id,
    question: question.question,
    answer: question.answer,
    wrong_answers: question.wrongAnswers,
    explanation: question.explanation,
    category: question.category,
    difficulty: question.difficulty,
    milestones: question.milestones,
    mode: question.mode,
    challenge_type: question.challengeType,
    status: question.status,
    tags: question.tags,
    source: question.source,
    source_page: question.sourcePage,
    revision_notes: question.revisionNotes,
    favorite: question.favorite,
    version: question.version,
  }
}

function changedFields(before, after) {
  if (!before || !after) return []
  const fields = [
    ['question', 'Question'],
    ['answer', 'Bonne réponse'],
    ['wrong_answers', 'Mauvaises réponses'],
    ['explanation', 'Explication'],
    ['category', 'Catégorie'],
    ['difficulty', 'Difficulté'],
    ['milestones', 'Jalons'],
    ['mode', 'Type'],
    ['challenge_type', 'Défi'],
    ['source', 'Source'],
    ['source_page', 'Page'],
    ['revision_notes', 'Note de révision'],
  ]
  return fields.flatMap(([key, label]) => {
    const left = printableValue(before[key])
    const right = printableValue(after[key])
    return left === right ? [] : [{ label, before: left, after: right }]
  })
}

function wordDiffMarkup(before, after) {
  const left = tokenize(before)
  const right = tokenize(after)
  const table = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const output = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      output.push(escapeHtml(left[i]))
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      output.push(`<del>${escapeHtml(left[i])}</del>`)
      i += 1
    } else {
      output.push(`<ins>${escapeHtml(right[j])}</ins>`)
      j += 1
    }
  }
  while (i < left.length) output.push(`<del>${escapeHtml(left[i++])}</del>`)
  while (j < right.length) output.push(`<ins>${escapeHtml(right[j++])}</ins>`)
  return output.join(' ')
}

function tokenize(value) {
  return String(value || '').split(/\s+/).filter(Boolean)
}

function printableValue(value) {
  if (Array.isArray(value)) return value.join(' | ')
  if (value === null || value === undefined) return ''
  return String(value)
}

function historyActionLabel(action) {
  return {
    catalog_seeded: 'Ajout au catalogue',
    created: 'Question créée',
    edited: 'Question modifiée',
    approval: 'Validation ajoutée',
    approval_revoked: 'Validation retirée',
    status_changed: 'État modifié',
    trashed: 'Mise à la corbeille',
    restored: 'Carte restaurée',
    exported: 'Exportée vers le jeu',
  }[action] || action
}

function mentionMarkup(body) {
  return escapeHtml(body).replace(/@(Lucas|Awen)\b/g, '<mark>@$1</mark>').replace(/\n/g, '<br>')
}

function modalQuestionId() {
  return ['edit', 'comments', 'history'].includes(state.modal?.type) ? state.modal.id : null
}

function splitPipe(value = '') {
  return String(value).split('|').map((item) => item.trim()).filter(Boolean)
}

function sourceLabel(question) {
  return question.source || 'Source non renseignée'
}

function clampMilestones(value) {
  return Math.min(5, Math.max(1, Number(value) || 3))
}

function difficultyForMilestone(value) {
  return DIFFICULTY_BY_MILESTONE[clampMilestones(value)]
}

function option(value, selected) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(value)}</option>`
}

function profileName(id) {
  return state.profiles.find((profile) => profile.id === id)?.display_name || ''
}

function createQuestionId() {
  return `Q-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function createPlaytestId() {
  const maxNumber = state.playtests.reduce((max, session) => {
    const match = String(session.id).match(/^PT-(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `PT-${String(maxNumber + 1).padStart(2, '0')}`
}


function capitalize(value) {
  return String(value || '').slice(0, 1).toUpperCase() + String(value || '').slice(1)
}
function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatRelative(value) {
  if (!value) return ''
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000)
  const formatter = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

function friendlyError(error) {
  if (!error) return 'Erreur inconnue'
  if (error.code === '23505') return 'Cette donnée existe déjà.'
  if (error.message?.includes('JWT')) return 'La session a expiré. Reconnecte-toi.'
  return error.message || 'Erreur inconnue'
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function showToast(message) {
  window.clearTimeout(state.toastTimer)
  document.querySelector('.toast')?.remove()
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  document.body.append(toast)
  state.toastTimer = window.setTimeout(() => toast.remove(), 3600)
}
