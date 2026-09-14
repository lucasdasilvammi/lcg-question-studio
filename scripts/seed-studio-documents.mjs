import { readFileSync } from 'node:fs'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { createMockWorkspace } from '../src/mockWorkspace.js'
import { DEFAULT_BACKLOG_TAGS } from '../src/studioConfig.js'
import { createPocPatch } from '../src/modules/worklog.js'
import { snapshotModules } from '../src/modules/studioDocuments.js'

try {
  process.loadEnvFile('.env.local')
} catch {
  // Environment variables may already be provided by the shell.
}

const apply = process.argv.includes('--apply')
const source = process.argv.find((argument) => argument.startsWith('--source='))?.split('=')[1]
const inputPath = process.argv.find((argument) => argument.startsWith('--input='))?.slice('--input='.length)
if (source && source !== 'mock') throw new Error('La seule source nommee disponible est --source=mock.')
if (source && inputPath) throw new Error('Choisir soit --source=mock, soit --input=CHEMIN, pas les deux.')
if (apply && !source && !inputPath) {
  throw new Error('Une ecriture exige une source explicite : --source=mock ou --input=CHEMIN.')
}

const sourceModules = inputPath ? readSnapshot(inputPath) : mockModules()
const sourceLabel = inputPath ? `le snapshot ${inputPath}` : 'les donnees fictives du code'
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
if (!url || !secretKey) {
  throw new Error('Renseigner VITE_SUPABASE_URL et SUPABASE_SECRET_KEY dans .env.local.')
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: profiles, error: profileError } = await supabase
  .from('profiles')
  .select('id,username')
if (profileError) throw profileError

const profileIdByName = Object.fromEntries(profiles.map((profile) => [profile.username, profile.id]))
const defaultActor = profileIdByName.lucas
if (!defaultActor || !profileIdByName.awen) {
  throw new Error('Les profils Lucas et Awen doivent deja exister avant cette initialisation.')
}
const knownProfileIds = new Set(Object.values(profileIdByName))
const actorId = (value, fallbackName = 'lucas') => {
  if (knownProfileIds.has(value)) return value
  if (value === 'awen-preview') return profileIdByName.awen
  if (value === 'lucas-preview') return profileIdByName.lucas
  return profileIdByName[String(fallbackName || '').toLowerCase()] || defaultActor
}

const { data: existingDocuments, error: documentsError } = await supabase
  .from('studio_documents')
  .select('key')
if (documentsError) throw documentsError
const existingKeys = new Set(existingDocuments.map((document) => document.key))
const documents = [
  {
    key: 'backlog',
    content: {
      tickets: sourceModules.backlog.tickets.map((ticket) => ({
        ...ticket,
        ownerId: actorId(ticket.ownerId, ticket.owner),
        createdById: actorId(ticket.createdById, ticket.owner),
      })),
      tags: sourceModules.backlog.tags,
    },
  },
  { key: 'ideas', content: sourceModules.ideas },
  {
    key: 'playtests',
    content: {
      sessions: sourceModules.playtests.sessions.map((session) => ({
        ...session,
        facilitatorId: actorId(session.facilitatorId),
      })),
    },
  },
  { key: 'worklog', content: sourceModules.worklog },
]
const missingDocuments = documents
  .filter((document) => !existingKeys.has(document.key))
  .map((document) => ({ ...document, updated_by: defaultActor }))

console.log(`Base : ${url}`)
console.log(`Source : ${sourceLabel}`)
console.log(`Documents presents : ${[...existingKeys].join(', ') || 'aucun'}`)
console.log(`Documents a initialiser : ${missingDocuments.map((document) => document.key).join(', ') || 'aucun'}`)
if (!apply) {
  console.log('Previsualisation uniquement. Ajoute --apply avec la meme source pour ecrire.')
  process.exit(0)
}
if (!missingDocuments.length) {
  console.log('Aucune ecriture necessaire.')
  process.exit(0)
}

const { error: insertError } = await supabase.from('studio_documents').insert(missingDocuments)
if (insertError) throw insertError
console.log(`${missingDocuments.length} document(s) initialise(s). Aucun document existant modifie.`)

function mockModules() {
  const workspace = createMockWorkspace()
  return {
    backlog: { tickets: workspace.backlog, tags: DEFAULT_BACKLOG_TAGS },
    ideas: { items: workspace.ideas },
    playtests: { sessions: workspace.playtests },
    worklog: { patches: [createPocPatch()] },
  }
}

function readSnapshot(path) {
  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Snapshot illisible : ${error.message}`)
  }
  return snapshotModules(snapshot)
}