import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const studioDir = path.resolve(scriptDir, '..')
const repoDir = path.resolve(studioDir, '..')
const generatedAt = '2026-06-07T00:00:00.000Z'
const sourceTitle = 'Le design graphique — savoirs & savoir-faire'

const readJson = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const quizData = await readJson(path.join(repoDir, 'server/data/quiz.json'))
const duelData = await readJson(path.join(repoDir, 'server/data/duels.json'))
const bookData = await readJson(path.join(studioDir, 'data/book-questions.json'))

const difficultyByLevel = {
  1: 'Pour les nuls',
  2: 'Facile',
  3: 'Moyen',
  4: 'Difficile',
  5: 'Expert',
}

const history = (detail) => [{
  at: generatedAt,
  action: 'Ajout au catalogue initial',
  detail,
}]

const baseQuestion = (input) => ({
  ...input,
  revisionNotes: '',
  favorite: false,
  createdAt: generatedAt,
  updatedAt: generatedAt,
})

const quizQuestions = Object.values(quizData)
  .filter(Array.isArray)
  .flat()
  .filter((item) => !item.q.includes('[À REMPLACER]'))
  .map((item, index) => {
    const answer = item.options[item.correct]
    return baseQuestion({
      id: `SOCLE-QUIZ-${String(index + 1).padStart(3, '0')}`,
      question: item.q,
      answer,
      wrongAnswers: item.options.filter((_, optionIndex) => optionIndex !== item.correct),
      explanation: '',
      category: item.category,
      difficulty: difficultyByLevel[item.diff] || 'Moyen',
      milestones: Number(item.diff) || 3,
      mode: 'Quiz',
      challengeType: 'Aucun',
      status: 'validated',
      tags: ['socle', 'quiz'],
      source: 'Socle',
      sourcePage: '',
      confidence: 1,
      history: history('Question existante du jeu'),
    })
  })

const duelCategory = (question) => {
  const text = question.toLowerCase()
  if (/logo/.test(text)) return 'Logo'
  if (/gestalt|gris typographique|nombre d'or/.test(text)) return 'Composition'
  if (/typograph|serif|crénage|interlettrage/.test(text)) return 'Typographie'
  if (/couleur|rgb|rvb|cmjn|complémentaire/.test(text)) return 'Signe et couleur'
  if (/format|dpi|impression|fond perdu|raccourci|centimètre/.test(text)) return 'Production'
  return 'Culture graphique'
}

const numericAnswer = (item) => {
  if (item.decimalPosition === 1) return `${String(item.correct).slice(0, 1)},${String(item.correct).slice(1)}`
  if (item.decimalPosition === 2) return `${String(item.correct).slice(0, 2)},${String(item.correct).slice(2)}`
  return String(item.correct)
}

const challengeLabels = {
  buzzer: 'Buzzer',
  vraioufaux: 'Vrai/Faux',
  chiffres: 'Chiffres',
}

const duelQuestions = Object.entries(challengeLabels).flatMap(([key, challengeType]) =>
  (duelData[key] || []).map((item, index) => {
    const isNumeric = key === 'chiffres'
    const answer = isNumeric ? numericAnswer(item) : item.options[item.correct]
    const wrongAnswers = isNumeric
      ? []
      : item.options.filter((_, optionIndex) => optionIndex !== item.correct)
    return baseQuestion({
      id: `SOCLE-${key.toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
      question: item.question,
      answer,
      wrongAnswers,
      explanation: item.explanation || '',
      category: duelCategory(item.question),
      difficulty: 'Moyen',
      milestones: 3,
      mode: 'Défi',
      challengeType,
      status: 'validated',
      tags: ['socle', 'défi', challengeType.toLowerCase()],
      source: 'Socle',
      sourcePage: '',
      confidence: 1,
      history: history(`Défi ${challengeType} existant du jeu`),
    })
  }))

const bookQuestions = bookData.map((item) => baseQuestion({
  id: item.id,
  question: item.question,
  answer: item.answer,
  wrongAnswers: item.wrongAnswers,
  explanation: item.explanation,
  category: item.category,
  difficulty: item.difficulty,
  milestones: item.difficulty === 'Pour les nuls' ? 1 : item.difficulty === 'Expert' ? 5 : 3,
  mode: 'Quiz',
  challengeType: 'Aucun',
  status: 'pending',
  tags: item.tags,
  source: sourceTitle,
  sourcePage: item.page,
  confidence: 0.98,
  history: history(`Question créée à partir de la page ${item.page} du livre`),
}))

const questions = [...quizQuestions, ...duelQuestions, ...bookQuestions]
const ids = new Set()

for (const question of questions) {
  if (ids.has(question.id)) throw new Error(`Identifiant dupliqué : ${question.id}`)
  ids.add(question.id)
  const expectedWrongAnswers = question.mode === 'Quiz' || question.challengeType === 'Buzzer'
    ? 2
    : question.challengeType === 'Vrai/Faux' ? 1 : 0
  if (question.wrongAnswers.length !== expectedWrongAnswers) {
    throw new Error(`${question.id} contient ${question.wrongAnswers.length} mauvaises réponses au lieu de ${expectedWrongAnswers}`)
  }
}

const expectedCategories = ['Culture graphique', 'Typographie', 'Signe et couleur', 'Logo', 'Composition', 'Production']
const expectedDifficulties = ['Pour les nuls', 'Moyen', 'Expert']
for (const category of expectedCategories) {
  for (const difficulty of expectedDifficulties) {
    const count = bookQuestions.filter((item) => item.category === category && item.difficulty === difficulty).length
    if (count < 3) throw new Error(`${category} / ${difficulty} ne contient que ${count} question(s)`)
  }
}

const columns = [
  'id', 'question', 'answer', 'wrong_answers', 'explanation', 'category',
  'difficulty', 'milestones', 'mode', 'challenge_type', 'status', 'tags',
  'source', 'source_page', 'revision_notes', 'favorite',
  'confidence', 'created_at', 'updated_at',
]

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
const csvRows = questions.map((item) => ({
  id: item.id,
  question: item.question,
  answer: item.answer,
  wrong_answers: item.wrongAnswers.join(' | '),
  explanation: item.explanation,
  category: item.category,
  difficulty: item.difficulty,
  milestones: item.milestones,
  mode: item.mode,
  challenge_type: item.challengeType,
  status: item.status,
  tags: item.tags.join(' | '),
  source: item.source,
  source_page: item.sourcePage,
  revision_notes: item.revisionNotes,
  favorite: item.favorite,
  confidence: item.confidence,
  created_at: item.createdAt,
  updated_at: item.updatedAt,
}))
const csv = [
  columns.map(csvCell).join(','),
  ...csvRows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
].join('\n')

await mkdir(path.join(studioDir, 'data'), { recursive: true })
await writeFile(
  path.join(studioDir, 'src/catalogQuestions.js'),
  `// Generated by scripts/build-question-catalog.mjs\nexport const CATALOG_VERSION = '2026-06-07-books-v1'\nexport const catalogQuestions = ${JSON.stringify(questions, null, 2)}\n`,
  'utf8',
)
await writeFile(path.join(studioDir, 'data/questions-initiales.csv'), `\uFEFF${csv}\n`, 'utf8')

console.log(JSON.stringify({
  total: questions.length,
  socleQuiz: quizQuestions.length,
  socleChallenges: duelQuestions.length,
  book: bookQuestions.length,
}, null, 2))
