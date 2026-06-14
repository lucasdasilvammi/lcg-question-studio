const CATEGORIES = [
  'Culture graphique',
  'Typographie',
  'Signe et couleur',
  'Logo',
  'Production',
  'Composition',
]

const ZOOM_QUESTIONS = [
  {
    type: 'zoom',
    question: 'Quel est ce logo ?',
    image: '/game/defi-logo/logo-starbucks.png',
    answer: 'Starbucks',
    options: ['Starbucks', 'Shell', 'Sony'],
    correct: 0,
    explanation: 'Logo Starbucks pour test du zoom linéaire.',
  },
]

export function createQuizJson(questions) {
  const payload = {
    _comment: `Questions validées exportées depuis Question Studio le ${dateLabel()}.`,
  }

  CATEGORIES.forEach((category) => {
    payload[category] = questions
      .filter((question) => question.mode === 'Quiz' && question.category === category)
      .map(toChoiceQuestion)
  })

  return payload
}

export function createDuelsJson(questions) {
  const challengeQuestions = questions.filter((question) => question.mode === 'Défi')
  return {
    _comment: `Défis validés exportés depuis Question Studio le ${dateLabel()}.`,
    buzzer: challengeQuestions
      .filter((question) => question.challengeType === 'Buzzer')
      .map(toBuzzerQuestion),
    vraioufaux: challengeQuestions
      .filter((question) => question.challengeType === 'Vrai/Faux')
      .map(toTrueFalseQuestion),
    chiffres: challengeQuestions
      .filter((question) => question.challengeType === 'Chiffres')
      .map(toNumericQuestion),
    zoom: ZOOM_QUESTIONS,
  }
}

export function validateExport(questions, kind) {
  const relevant = questions.filter((question) =>
    kind === 'quiz' ? question.mode === 'Quiz' : question.mode === 'Défi',
  )
  const errors = []

  relevant.forEach((question) => {
    if (!question.question.trim()) errors.push(`${question.id} : question vide`)
    if (!question.answer.trim()) errors.push(`${question.id} : réponse vide`)
    if (!CATEGORIES.includes(question.category)) errors.push(`${question.id} : catégorie inconnue`)
    if (!Number.isInteger(Number(question.milestones))
      || Number(question.milestones) < 1
      || Number(question.milestones) > 5) {
      errors.push(`${question.id} : jalons invalides`)
    }

    if (
      (question.mode === 'Quiz' || question.challengeType === 'Buzzer')
      && question.wrongAnswers.length !== 2
    ) {
      errors.push(`${question.id} : exactement 2 mauvaises réponses sont requises`)
    }
    if (question.challengeType === 'Vrai/Faux' && !normalizeBooleanAnswer(question.answer)) {
      errors.push(`${question.id} : la bonne réponse doit être Vrai ou Faux`)
    }
    if (question.challengeType === 'Chiffres' && !parseNumericAnswer(question.answer)) {
      errors.push(`${question.id} : réponse chiffrée invalide`)
    }
  })

  return { questions: relevant, errors }
}

export function downloadJson(payload, filename) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function toBuzzerQuestion(question) {
  const choice = toChoiceQuestion(question, true)
  const { q, ...rest } = choice
  return { type: 'buzzer', question: q, ...rest }
}

function toChoiceQuestion(question, includeExplanation = false) {
  const options = distributeAnswers(question)
  const result = {
    q: question.question,
    options,
    correct: options.indexOf(question.answer),
    diff: Number(question.milestones),
    category: question.category,
  }
  if (question.difficulty) result.difficulty = question.difficulty
  if (includeExplanation || question.explanation) result.explanation = question.explanation || ''
  return result
}

function toTrueFalseQuestion(question) {
  const answer = normalizeBooleanAnswer(question.answer)
  return {
    type: 'vraioufaux',
    question: question.question,
    options: ['Vrai', 'Faux'],
    correct: answer === 'Vrai' ? 0 : 1,
    explanation: question.explanation || '',
    category: question.category,
    diff: Number(question.milestones),
    difficulty: question.difficulty,
  }
}

function toNumericQuestion(question) {
  const parsed = parseNumericAnswer(question.answer)
  const result = {
    type: 'chiffres',
    question: question.question,
    correct: Number(parsed.digits),
    digits: parsed.digits.length,
    explanation: question.explanation || '',
    category: question.category,
    diff: Number(question.milestones),
    difficulty: question.difficulty,
  }
  if (parsed.decimalPosition !== null) result.decimalPosition = parsed.decimalPosition
  return result
}

function distributeAnswers(question) {
  const answers = [question.answer, ...question.wrongAnswers]
  const offset = stableHash(`${question.id}:${question.version}`) % answers.length
  return answers.slice(offset).concat(answers.slice(0, offset))
}

function normalizeBooleanAnswer(value) {
  const normalized = String(value).trim().toLowerCase()
  if (['vrai', 'true'].includes(normalized)) return 'Vrai'
  if (['faux', 'false'].includes(normalized)) return 'Faux'
  return null
}

function parseNumericAnswer(value) {
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.')
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  return {
    digits: `${match[1]}${match[2] || ''}`,
    decimalPosition: match[2] ? match[1].length : null,
  }
}

function stableHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function dateLabel() {
  return new Date().toISOString().slice(0, 10)
}
