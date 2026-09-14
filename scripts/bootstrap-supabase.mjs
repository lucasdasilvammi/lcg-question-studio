import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { initialQuestions } from '../src/initialQuestions.js'
import { createMockWorkspace } from '../src/mockWorkspace.js'
import { DEFAULT_BACKLOG_TAGS } from '../src/studioConfig.js'
import { createPocPatch } from '../src/modules/worklog.js'

try {
  process.loadEnvFile('.env.local')
} catch {
  // Environment variables may already be provided by the shell.
}

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!url || !secretKey) {
  throw new Error(
    'Ajoute VITE_SUPABASE_URL et SUPABASE_SECRET_KEY dans .env.local avant de lancer ce script.',
  )
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const accountDefinitions = [
  {
    username: 'lucas',
    displayName: 'Lucas',
    email: 'lucas@lcg-question-studio.app',
    password: process.env.LUCAS_PASSWORD || generatePassword(),
  },
  {
    username: 'awen',
    displayName: 'Awen',
    email: 'awen@lcg-question-studio.app',
    password: process.env.AWEN_PASSWORD || generatePassword(),
  },
]

const existingUsers = await listAllUsers()
const accounts = []

for (const definition of accountDefinitions) {
  const existing = existingUsers.find((user) => user.email === definition.email)
  let user = existing
  let passwordChanged = false

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: definition.email,
      password: definition.password,
      email_confirm: true,
      user_metadata: {
        username: definition.username,
        display_name: definition.displayName,
      },
    })
    if (error) throw error
    user = data.user
    passwordChanged = true
  } else if (
    (definition.username === 'lucas' && process.env.LUCAS_PASSWORD)
    || (definition.username === 'awen' && process.env.AWEN_PASSWORD)
  ) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: definition.password,
      user_metadata: {
        username: definition.username,
        display_name: definition.displayName,
      },
    })
    if (error) throw error
    passwordChanged = true
  }

  accounts.push({ ...definition, id: user.id, passwordChanged })
}

const { error: profileError } = await supabase.from('profiles').upsert(
  accounts.map((account) => ({
    id: account.id,
    username: account.username,
    display_name: account.displayName,
    avatar_key: 'couronne',
    accent_key: account.username === 'lucas' ? 'cyan' : 'yellow',
    accent_color: account.username === 'lucas' ? '#06C0F9' : '#FFC400',
    accent_secondary: account.username === 'lucas' ? '#103743' : '#4C3E0F',
  })),
  { onConflict: 'id' },
)
if (profileError) throw profileError

const profileIdByName = Object.fromEntries(
  accounts.map((account) => [account.displayName, account.id]),
)
const defaultActor = profileIdByName.Lucas

const workspace = createMockWorkspace()
const ownerId = (name) => profileIdByName[name] || defaultActor
const studioDocuments = [
  {
    key: 'backlog',
    content: {
      tickets: workspace.backlog.map((ticket) => ({
        ...ticket,
        ownerId: ownerId(ticket.owner),
        createdById: ownerId(ticket.owner),
      })),
      tags: DEFAULT_BACKLOG_TAGS,
    },
  },
  { key: 'ideas', content: { items: workspace.ideas } },
  {
    key: 'playtests',
    content: {
      sessions: workspace.playtests.map((session) => ({
        ...session,
        facilitatorId: session.facilitatorId === 'awen-preview' ? profileIdByName.Awen : defaultActor,
      })),
    },
  },
  { key: 'worklog', content: { patches: [createPocPatch()] } },
]

const { data: existingDocuments, error: documentsReadError } = await supabase
  .from('studio_documents')
  .select('key')
if (documentsReadError) throw documentsReadError
const existingDocumentKeys = new Set(existingDocuments.map((document) => document.key))
const missingDocuments = studioDocuments
  .filter((document) => !existingDocumentKeys.has(document.key))
  .map((document) => ({ ...document, updated_by: defaultActor }))
if (missingDocuments.length) {
  const { error } = await supabase.from('studio_documents').insert(missingDocuments)
  if (error) throw error
}
const resetTables = [
  ['export_items', 'question_id'],
  ['export_batches', 'id'],
  ['question_approvals', 'question_id'],
]

for (const [table, column] of resetTables) {
  const { error } = await supabase.from(table).delete().not(column, 'is', null)
  if (error) throw error
}

const questionRows = initialQuestions.map((question) => ({
  id: question.id,
  question: question.question,
  answer: question.answer,
  wrong_answers: question.wrongAnswers,
  explanation: question.explanation || '',
  category: question.category,
  difficulty: question.difficulty,
  milestones: question.milestones,
  mode: question.mode,
  challenge_type: question.challengeType,
  status: question.status,
  tags: question.tags || [],
  source: question.source || '',
  source_page: question.sourcePage || '',
  revision_notes: question.revisionNotes || '',
  favorite: Boolean(question.favorite),
  confidence: Number(question.confidence) || 0,
  last_exported_version: null,
  last_exported_at: null,
  deleted_at: null,
  created_by: defaultActor,
  updated_by: defaultActor,
  created_at: question.createdAt,
  updated_at: question.updatedAt,
}))

for (const rows of chunks(questionRows, 100)) {
  const { error } = await supabase.from('questions').upsert(rows, { onConflict: 'id' })
  if (error) throw error
}

const approvalRows = initialQuestions.flatMap((question) =>
  (question.approvals || []).map((approval) => ({
    question_id: question.id,
    reviewer_id: profileIdByName[approval.reviewer],
    created_at: approval.at,
  })),
)

for (const rows of chunks(approvalRows, 100)) {
  const { error } = await supabase
    .from('question_approvals')
    .upsert(rows, { onConflict: 'question_id,reviewer_id' })
  if (error) throw error
}

const historyRows = initialQuestions.map((question) => ({
  question_id: question.id,
  actor_id: defaultActor,
  action: 'catalog_seeded',
  detail: question.source === 'Socle'
    ? 'Question existante du jeu importée'
    : `Question issue de ${question.source || 'la source éditoriale'}`,
  snapshot_after: questionRows.find((row) => row.id === question.id),
  created_at: question.createdAt,
}))

const { count: historyCount, error: historyCountError } = await supabase
  .from('question_history')
  .select('*', { count: 'exact', head: true })
if (historyCountError) throw historyCountError

if (historyCount === 0) {
  for (const rows of chunks(historyRows, 100)) {
    const { error } = await supabase.from('question_history').insert(rows)
    if (error) throw error
  }
}

console.log('\nSupabase est prêt.')
console.log(`Questions synchronisées : ${questionRows.length}`)
console.log('Documents Studio initialisés : ' + missingDocuments.length)
console.log('Toutes les questions sont en attente, sans validation ni historique d’export.')
console.log('\nIdentifiants du studio :')
for (const account of accounts) {
  console.log(`- ${account.displayName}`)
  console.log(`  Identifiant : ${account.displayName}`)
  console.log(
    account.passwordChanged
      ? `  Mot de passe : ${account.password}`
      : '  Mot de passe : inchangé (compte déjà présent)',
  )
}
console.log('\nConserve ces mots de passe dans un gestionnaire sécurisé.')

function generatePassword() {
  return `${randomBytes(12).toString('base64url')}!7a`
}

function chunks(items, size) {
  const result = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function listAllUsers() {
  const users = []
  let page = 1
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < 100) return users
    page += 1
  }
}
