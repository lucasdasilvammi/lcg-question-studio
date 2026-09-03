import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

try {
  process.loadEnvFile('.env.local')
} catch {
  // Environment variables may already be provided by the shell.
}

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const dryRun = process.argv.includes('--dry-run')

if (!url || !secretKey) {
  throw new Error(
    'Ajoute VITE_SUPABASE_URL et SUPABASE_SECRET_KEY dans .env.local avant de lancer ce script.',
  )
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const studioDir = path.resolve(scriptDir, '..')
const questionsPath = path.join(studioDir, 'data', 'pyramide-qcm-questions.json')
const questions = JSON.parse(await readFile(questionsPath, 'utf8'))

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: profiles, error: profilesError } = await supabase
  .from('profiles')
  .select('id, username')
if (profilesError) throw profilesError

const defaultActor = profiles.find((profile) => profile.username === 'lucas')?.id
  || profiles[0]?.id
  || null

const ids = questions.map((question) => question.id)
const existingIds = new Set()

for (const idChunk of chunks(ids, 100)) {
  const { data, error } = await supabase
    .from('questions')
    .select('id')
    .in('id', idChunk)
  if (error) throw error
  data.forEach((row) => existingIds.add(row.id))
}

const rows = questions.map((question) => ({
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
  source: question.source,
  source_page: question.sourcePage || '',
  revision_notes: question.revisionNotes || '',
  favorite: Boolean(question.favorite),
  confidence: Number(question.confidence) || 0.95,
  last_exported_version: null,
  last_exported_at: null,
  deleted_at: null,
  created_by: defaultActor,
  updated_by: defaultActor,
  created_at: question.createdAt,
  updated_at: question.updatedAt,
}))

const createdRows = rows.filter((row) => !existingIds.has(row.id))
const updatedRows = rows.filter((row) => existingIds.has(row.id))

if (dryRun) {
  printSummary({ createdRows, updatedRows, rows })
  process.exit(0)
}

for (const rowChunk of chunks(rows, 100)) {
  const { error } = await supabase
    .from('questions')
    .upsert(rowChunk, { onConflict: 'id' })
  if (error) throw error
}

for (const idChunk of chunks(ids, 100)) {
  const { error } = await supabase
    .from('question_approvals')
    .delete()
    .in('question_id', idChunk)
  if (error) throw error
}

const historyRows = rows.map((row) => ({
  question_id: row.id,
  actor_id: defaultActor,
  action: existingIds.has(row.id) ? 'edited' : 'catalog_seeded',
  detail: existingIds.has(row.id)
    ? 'Question Pyramide QCM resynchronisée'
    : 'Question Pyramide QCM ajoutée au catalogue',
  snapshot_after: row,
  created_at: row.created_at,
}))

for (const rowChunk of chunks(historyRows, 100)) {
  const { error } = await supabase.from('question_history').insert(rowChunk)
  if (error) throw error
}

printSummary({ createdRows, updatedRows, rows })

function printSummary({ createdRows, updatedRows, rows }) {
  const byCategory = rows.reduce((acc, row) => {
    acc[row.category] = (acc[row.category] || 0) + 1
    return acc
  }, {})

  console.log(JSON.stringify({
    total: rows.length,
    created: createdRows.length,
    updated: updatedRows.length,
    source: 'pyramide QCM',
    status: 'pending',
    byCategory,
    dryRun,
  }, null, 2))
}

function chunks(items, size) {
  const result = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}
