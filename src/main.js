import './styles.css'
import { CATALOG_VERSION, catalogQuestions } from './catalogQuestions.js'

const STORAGE_KEY = 'lcg-question-studio-v1'
const VIEW_KEY = 'lcg-question-studio-view'
const CATALOG_KEY = 'lcg-question-studio-catalog-version'
const CATALOG_DELETED_KEY = 'lcg-question-studio-deleted-catalog-ids'
const CSV_COLUMNS = [
  'id', 'question', 'answer', 'wrong_answers', 'explanation', 'category',
  'difficulty', 'milestones', 'mode', 'challenge_type', 'status', 'tags',
  'source', 'source_page', 'revision_notes', 'favorite',
  'confidence', 'created_at', 'updated_at',
]

const DIFFICULTIES = ['Pour les nuls', 'Facile', 'Moyen', 'Difficile', 'Expert']
const CATEGORIES = ['Culture graphique', 'Signe et couleur', 'Typographie', 'Logo', 'Composition', 'Production']
const CHALLENGES = ['Buzzer', 'Vrai/Faux', 'Chiffres']
const STATUS_ORDER = { pending: 0, review: 1, validated: 2 }
const STATUSES = {
  pending: 'En attente',
  review: 'En révision',
  validated: 'Validée',
}
const CATEGORY_ASSETS = {
  'Culture graphique': 'culture',
  'Signe et couleur': 'couleur',
  Typographie: 'typo',
  Logo: 'logo',
  Composition: 'compo',
  Production: 'prod',
}
const CHALLENGE_ASSETS = {
  Buzzer: 'buzzer',
  'Vrai/Faux': 'vraioufaux',
  Chiffres: 'chiffres',
}

const now = () => new Date().toISOString()
const uid = () => `Q-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

const state = {
  questions: loadQuestions(),
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  statusFilter: 'all',
  categoryFilter: 'all',
  difficultyFilter: 'all',
  tagFilter: 'all',
  selected: new Set(),
  modal: null,
  toastTimer: null,
}

function loadQuestions() {
  let stored = []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY))
    stored = Array.isArray(parsed) ? parsed : []
  } catch {
    stored = []
  }

  const withoutDemos = stored.filter((question) => !String(question.id).startsWith('Q-DEMO-'))
  const shouldSeedCatalog = localStorage.getItem(CATALOG_KEY) !== CATALOG_VERSION

  if (!shouldSeedCatalog) return withoutDemos.map(normalizeQuestion)

  const existingIds = new Set(withoutDemos.map((question) => question.id))
  const deletedIds = readDeletedCatalogIds()
  const merged = [
    ...withoutDemos,
    ...catalogQuestions.filter((question) => !existingIds.has(question.id) && !deletedIds.has(question.id)),
  ].map(normalizeQuestion)

  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  localStorage.setItem(CATALOG_KEY, CATALOG_VERSION)
  return merged
}

function readDeletedCatalogIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(CATALOG_DELETED_KEY))
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

function rememberDeletedCatalogIds(ids) {
  const catalogIds = new Set(catalogQuestions.map((question) => question.id))
  const deletedIds = readDeletedCatalogIds()
  ids.filter((id) => catalogIds.has(id)).forEach((id) => deletedIds.add(id))
  localStorage.setItem(CATALOG_DELETED_KEY, JSON.stringify([...deletedIds]))
}

function saveQuestions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.questions))
}

function normalizeQuestion(input = {}) {
  const createdAt = input.createdAt || input.created_at || now()
  const mode = input.mode === 'Défi' ? 'Défi' : 'Quiz'
  const requestedChallenge = input.challengeType || input.challenge_type
  const challengeType = mode === 'Défi' && CHALLENGES.includes(requestedChallenge)
    ? requestedChallenge
    : mode === 'Défi' ? 'Buzzer' : 'Aucun'
  const rawWrongAnswers = Array.isArray(input.wrongAnswers)
    ? input.wrongAnswers
    : splitPipe(input.wrong_answers)
  const wrongAnswerLimit = mode === 'Quiz' || challengeType === 'Buzzer'
    ? 2
    : challengeType === 'Vrai/Faux' ? 1 : 0
  return {
    id: input.id || uid(),
    question: input.question || '',
    answer: input.answer || '',
    wrongAnswers: rawWrongAnswers.slice(0, wrongAnswerLimit),
    explanation: input.explanation || '',
    category: CATEGORIES.includes(input.category) ? input.category : CATEGORIES[0],
    difficulty: DIFFICULTIES.includes(input.difficulty) ? input.difficulty : 'Moyen',
    milestones: Number(input.milestones) || 1,
    mode,
    challengeType,
    status: Object.hasOwn(STATUSES, input.status) ? input.status : 'pending',
    tags: Array.isArray(input.tags) ? input.tags : splitPipe(input.tags),
    source: input.source || '',
    sourcePage: input.sourcePage || input.source_page || '',
    revisionNotes: input.revisionNotes || input.revision_notes || '',
    favorite: input.favorite === true || String(input.favorite).toLowerCase() === 'true',
    confidence: Number(input.confidence) || 0,
    history: Array.isArray(input.history) ? input.history : [],
    createdAt,
    updatedAt: input.updatedAt || input.updated_at || createdAt,
  }
}

function questionSnapshot(question) {
  if (!question) return null
  const { history, ...snapshot } = question
  return structuredClone(snapshot)
}

function addHistory(question, action, detail = '', snapshot = null) {
  question.history = [{ at: now(), action, detail, snapshot }, ...(question.history || [])].slice(0, 30)
  question.updatedAt = now()
}

function splitPipe(value = '') {
  return String(value).split('|').map((item) => item.trim()).filter(Boolean)
}

function allTags() {
  return [...new Set(state.questions.flatMap((question) => question.tags || []))]
    .sort((a, b) => a.localeCompare(b, 'fr'))
}

function filteredQuestions() {
  return state.questions
    .filter((question) => {
      if (state.statusFilter !== 'all' && question.status !== state.statusFilter) return false
      if (state.categoryFilter !== 'all' && question.category !== state.categoryFilter) return false
      if (state.difficultyFilter !== 'all' && question.difficulty !== state.difficultyFilter) return false
      if (state.tagFilter !== 'all' && !(question.tags || []).includes(state.tagFilter)) return false
      return true
    })
    .sort((left, right) =>
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
      || new Date(right.updatedAt) - new Date(left.updatedAt))
}

function duplicateIds() {
  const duplicates = new Set()
  state.questions.forEach((question, index) => {
    for (let cursor = index + 1; cursor < state.questions.length; cursor += 1) {
      if (similarity(question.question, state.questions[cursor].question) >= 0.72) {
        duplicates.add(question.id)
        duplicates.add(state.questions[cursor].id)
      }
    }
  })
  return duplicates
}

function needsVerification(question) {
  const answer = question.answer.trim().toLowerCase()
  return !answer
    || (question.confidence > 0 && question.confidence < 0.85)
    || question.wrongAnswers.some((wrong) => wrong.trim().toLowerCase() === answer)
    || !hasValidAnswerCount(question)
}

function hasValidAnswerCount(question) {
  if (question.mode === 'Quiz' || question.challengeType === 'Buzzer') return question.wrongAnswers.length === 2
  if (question.challengeType === 'Vrai/Faux') return question.wrongAnswers.length === 1
  return question.wrongAnswers.length === 0
}

function similarity(left, right) {
  const words = (text) => new Set(
    text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter((word) => word.length > 2),
  )
  const a = words(left)
  const b = words(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((word) => b.has(word)).length
  return intersection / (a.size + b.size - intersection)
}

function render() {
  const app = document.querySelector('#app')
  const visible = filteredQuestions()
  const duplicates = duplicateIds()
  const statusCount = (status) => state.questions.filter((question) => status === 'all' || question.status === status).length
  const validated = statusCount('validated')
  const review = statusCount('review')
  const total = state.questions.length
  const favorites = state.questions.filter((question) => question.favorite).length
  const warnings = state.questions.filter(needsVerification).length

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">QS</div>
          <div><strong>Question Studio</strong><span>Le Cube Graphique · outil éditorial autonome</span></div>
        </div>
        <div class="top-actions">
          <button class="button" data-action="import" title="Ajouter ou mettre à jour un lot de questions depuis un fichier CSV"><b>↑</b><span>Importer un CSV</span></button>
          <button class="button" data-action="export-backup" title="Télécharger une sauvegarde complète de toutes les cartes, quels que soient leurs états"><b>↓</b><span>Sauvegarder tout</span></button>
          <button class="button" data-action="export-revisions" title="Exporter les cartes en révision avec tes notes pour les faire retravailler par une IA" ${review ? '' : 'disabled'}><b>↗</b><span>Exporter les révisions</span></button>
          <button class="button primary" data-action="export-validated" title="Exporter uniquement les questions que tu as validées pour les transmettre à l’application" ${validated ? '' : 'disabled'}><b>↓</b><span>Exporter les validées</span></button>
          <button class="button accent" data-action="new" title="Créer manuellement une nouvelle carte"><b>＋</b><span>Créer une question</span></button>
        </div>
      </header>

      <div class="workspace">
        <aside class="sidebar">
          <section class="sidebar-section">
            <p class="sidebar-label">État</p>
            <div class="state-filter">
              ${statusFilterButton('all', 'Toutes', statusCount('all'))}
              ${statusFilterButton('pending', 'En attente', statusCount('pending'))}
              ${statusFilterButton('review', 'En révision', review)}
              ${statusFilterButton('validated', 'Validées', validated)}
            </div>
            <button class="status-help-button" data-action="status-help">Comprendre les états</button>
          </section>
          <section class="sidebar-section">
            <p class="sidebar-label">Filtres par tag</p>
            <select class="select" data-filter="category" aria-label="Filtrer par catégorie">
              <option value="all">Toutes les catégories</option>
              ${uniqueCategories().map((value) => option(value, state.categoryFilter)).join('')}
            </select>
            <select class="select" data-filter="difficulty" aria-label="Filtrer par difficulté" style="margin-top:8px">
              <option value="all">Toutes les difficultés</option>
              ${DIFFICULTIES.map((value) => option(value, state.difficultyFilter)).join('')}
            </select>
            <select class="select" data-filter="tag" aria-label="Filtrer par tag libre" style="margin-top:8px">
              <option value="all">Tous les tags libres</option>
              ${allTags().map((value) => option(value, state.tagFilter)).join('')}
            </select>
          </section>
          <section class="sidebar-section">
            <p class="sidebar-label">Équilibre du lot</p>
            <div class="balance-card">${balanceMarkup()}</div>
            <button class="button small" data-action="stats" style="width:100%;margin-top:9px">Voir les statistiques</button>
          </section>
        </aside>

        <main class="main">
          <div class="page-head">
            <div>
              <p class="eyebrow">${state.statusFilter === 'all' ? 'Toutes les questions' : STATUSES[state.statusFilter]}</p>
              <h1>Atelier des questions</h1>
              <p class="subhead">Relisez, classez et validez votre matière avant export.</p>
            </div>
            <div class="view-switch" aria-label="Mode d’affichage">
              <button class="icon-button ${state.view === 'grid' ? 'active' : ''}" data-view="grid" title="Vue grille">▦</button>
              <button class="icon-button ${state.view === 'list' ? 'active' : ''}" data-view="list" title="Vue liste">☷</button>
            </div>
          </div>

          <div class="summary-strip">
            <div class="summary-item"><strong>${total}</strong><span>questions au total</span></div>
            <div class="summary-item"><strong>${validated}</strong><span>prêtes à exporter</span></div>
            <div class="summary-item"><strong>${review}</strong><span>à reformuler</span></div>
            <div class="summary-item"><strong>${duplicates.size + warnings}</strong><span>alertes à vérifier</span></div>
          </div>

          ${selectionMarkup()}
          <div class="results-line">
            <span>${visible.length} résultat${visible.length > 1 ? 's' : ''}${favorites ? ` · ${favorites} favorite${favorites > 1 ? 's' : ''}` : ''} · tri automatique par état</span>
            ${hasActiveFilters() ? '<button class="text-button" data-action="clear-filters">Effacer les filtres</button>' : ''}
          </div>

          ${visible.length ? `
            <div class="questions ${state.view}">
              ${visible.map((question) => questionCard(question, duplicates.has(question.id))).join('')}
            </div>
          ` : emptyMarkup()}
        </main>
      </div>
      ${state.modal ? modalMarkup() : ''}
    </div>
  `
  bindEvents()
}

function statusFilterButton(value, label, count) {
  return `<button class="filter-chip ${state.statusFilter === value ? 'active' : ''}" data-status-filter="${value}">
    <span>${label}</span><span class="filter-count">${count}</span>
  </button>`
}

function option(value, selected) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`
}

function uniqueCategories() {
  return [...new Set([...CATEGORIES, ...state.questions.map((question) => question.category).filter(Boolean)])]
}

function balanceMarkup() {
  const values = CATEGORIES.map((category) => ({
    category,
    count: state.questions.filter((question) => question.category === category).length,
  }))
  const max = Math.max(...values.map(({ count }) => count), 1)
  return values.slice(0, 4).map(({ category, count }) => `
    <div class="balance-row">
      <div class="balance-meta"><span>${escapeHtml(category)}</span><b>${count}</b></div>
      <div class="progress"><span style="width:${(count / max) * 100}%"></span></div>
    </div>
  `).join('')
}

function selectionMarkup() {
  if (!state.selected.size) return ''
  return `
    <div class="selection-bar">
      <strong>${state.selected.size} sélectionnée${state.selected.size > 1 ? 's' : ''}</strong>
      <div class="selection-actions">
        <button class="button small" data-bulk="pending">Mettre en attente</button>
        <button class="button small" data-bulk="review">Mettre en révision</button>
        <button class="button small" data-bulk="validated">Valider</button>
        <button class="button small danger" data-action="delete-selected">Supprimer</button>
        <button class="button small" data-action="clear-selection">Annuler</button>
      </div>
    </div>`
}

function questionCard(question, duplicate) {
  return `
    <article class="question-card ${state.view} ${state.selected.has(question.id) ? 'selected' : ''}" data-card-select="${escapeHtml(question.id)}">
      <div class="card-main">
        <div class="card-top">
          <span class="card-id">${escapeHtml(question.id)}</span>
          <input class="card-check" type="checkbox" data-select="${escapeHtml(question.id)}" ${state.selected.has(question.id) ? 'checked' : ''} aria-label="Sélectionner la question" />
        </div>
        <h2 class="question-text">${escapeHtml(question.question)}</h2>
        <p class="answer"><span class="answer-label">Réponse</span><span>${escapeHtml(question.answer || 'À compléter')}</span></p>
        <div class="game-tags" aria-label="${escapeHtml(`${question.mode}, ${question.category}, ${question.milestones} jalons`)}">
          ${gameTagMarkup(question)}
        </div>
        <div class="tags secondary-tags">
          ${question.favorite ? '<span class="tag favorite">★ Favorite</span>' : ''}
          ${duplicate ? '<span class="tag duplicate">Doublon potentiel</span>' : ''}
          ${needsVerification(question) ? `<span class="tag duplicate">À vérifier${question.confidence ? ` · ${Math.round(question.confidence * 100)}%` : ''}</span>` : ''}
          ${(question.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        ${question.revisionNotes ? `<p class="card-note"><b>Note de révision :</b> ${escapeHtml(question.revisionNotes)}</p>` : ''}
      </div>
      <div class="card-side">
        <div class="card-side-top">
          <span class="status ${question.status}">${STATUSES[question.status]}</span>
          <div class="card-meta">
            ${question.source ? `<span>Source : ${escapeHtml(question.source)}${question.sourcePage ? `, p. ${escapeHtml(question.sourcePage)}` : ''}</span>` : ''}
          </div>
        </div>
        <div class="card-actions">
          <button class="button small" data-card-action="preview" data-id="${escapeHtml(question.id)}">Aperçu</button>
          <button class="button small" data-card-action="edit" data-id="${escapeHtml(question.id)}">Modifier</button>
          ${question.status !== 'review' ? `<button class="button small" data-card-action="review" data-id="${escapeHtml(question.id)}">Réviser</button>` : ''}
          ${question.status !== 'validated' ? `<button class="button small primary" data-card-action="validate" data-id="${escapeHtml(question.id)}">Valider</button>` : ''}
        </div>
      </div>
    </article>`
}

function gameTagMarkup(question) {
  const categoryAsset = CATEGORY_ASSETS[question.category]
  const challengeAsset = CHALLENGE_ASSETS[question.challengeType]
  const milestoneAsset = Math.min(5, Math.max(1, Number(question.milestones) || 1))
  return `
    <img class="game-tag-image mode-tag" src="/game/categorie/${question.mode === 'Défi' ? 'tag-defis' : 'tag-quizz'}.png" alt="${escapeHtml(question.mode)}" />
    ${categoryAsset
      ? `<img class="game-tag-image" src="/game/categorie/${categoryAsset}.png" alt="${escapeHtml(question.category)}" />`
      : `<span class="game-tag-fallback category-fallback">${escapeHtml(question.category)}</span>`}
    <img class="game-tag-image" src="/game/categorie/diff-${milestoneAsset}.png" alt="${question.milestones} jalon${question.milestones > 1 ? 's' : ''}" />
    ${question.mode === 'Défi' && question.challengeType !== 'Aucun'
      ? challengeAsset
        ? `<img class="game-tag-image" src="/game/defi-tag/${challengeAsset}.png" alt="${escapeHtml(question.challengeType)}" />`
        : `<span class="game-tag-fallback challenge-fallback">${escapeHtml(question.challengeType)}</span>`
      : ''}
  `
}

function emptyMarkup() {
  return `<div class="empty-state">
    <div class="empty-icon">◇</div>
    <h2>Aucune question ici</h2>
    <p>Modifiez les filtres, importez un CSV ou créez une nouvelle question pour alimenter cet espace.</p>
    <button class="button accent" data-action="new">Créer une question</button>
  </div>`
}

function hasActiveFilters() {
  return state.statusFilter !== 'all' || state.categoryFilter !== 'all'
    || state.difficultyFilter !== 'all' || state.tagFilter !== 'all'
}

function modalMarkup() {
  if (state.modal.type === 'edit') return editModalMarkup(state.modal.id, state.modal.reviewMode)
  if (state.modal.type === 'preview') return previewModalMarkup(state.modal.id)
  if (state.modal.type === 'stats') return statsModalMarkup()
  if (state.modal.type === 'history') return historyModalMarkup(state.modal.id)
  if (state.modal.type === 'export') return exportModalMarkup()
  if (state.modal.type === 'status-help') return statusHelpModalMarkup()
  return ''
}

function editModalMarkup(id, reviewMode) {
  const existing = state.questions.find((question) => question.id === id)
  const question = existing || normalizeQuestion({ status: reviewMode ? 'review' : 'pending' })
  return `
    <div class="modal-backdrop" data-close-modal>
      <form class="modal" id="question-form">
        <div class="modal-head">
          <div><p class="eyebrow">${existing ? escapeHtml(question.id) : 'Nouvelle fiche'}</p><h2>${existing ? 'Modifier la question' : 'Créer une question'}</h2></div>
          <button class="close" type="button" data-action="close-modal" aria-label="Fermer">×</button>
        </div>
        <div class="modal-body">
          <input type="hidden" name="id" value="${escapeHtml(existing?.id || '')}" />
          <div class="form-grid">
            <div class="field full">
              <label for="question">Question *</label>
              <textarea id="question" name="question" required autofocus>${escapeHtml(question.question)}</textarea>
            </div>
            <div class="field">
              <label for="answer">Bonne réponse *</label>
              <input id="answer" name="answer" required value="${escapeHtml(question.answer)}" />
            </div>
            <div class="field">
              <label for="wrongAnswers">Mauvaises réponses</label>
              <input id="wrongAnswers" name="wrongAnswers" value="${escapeHtml(question.wrongAnswers.join(' | '))}" />
              <p class="field-help" id="wrong-answers-help">Quiz et Buzzer : exactement 2 mauvaises réponses, séparées avec |.</p>
            </div>
            <div class="field full">
              <label for="explanation">Explication après réponse</label>
              <textarea id="explanation" name="explanation">${escapeHtml(question.explanation)}</textarea>
            </div>

            <h3 class="form-section-title">Classement dans le jeu</h3>
            <div class="field">
              <label for="category">Catégorie</label>
              <select id="category" name="category">${CATEGORIES.map((value) => option(value, question.category)).join('')}</select>
            </div>
            <div class="field">
              <label for="difficulty">Difficulté</label>
              <select id="difficulty" name="difficulty">${DIFFICULTIES.map((value) => option(value, question.difficulty)).join('')}</select>
            </div>
            <div class="field">
              <label for="milestones">Jalons gagnés</label>
              <select id="milestones" name="milestones">${[1, 2, 3, 4, 5].map((value) => option(String(value), String(question.milestones))).join('')}</select>
            </div>
            <div class="field">
              <label for="mode">Mode</label>
              <select id="mode" name="mode"><option ${question.mode === 'Quiz' ? 'selected' : ''}>Quiz</option><option ${question.mode === 'Défi' ? 'selected' : ''}>Défi</option></select>
            </div>
            <div class="field">
              <label for="challengeType">Type de défi</label>
              <select id="challengeType" name="challengeType">${CHALLENGES.map((value) => option(value, question.challengeType === 'Aucun' ? 'Buzzer' : question.challengeType)).join('')}</select>
            </div>
            <div class="field">
              <label for="status">État</label>
              <select id="status" name="status">${Object.entries(STATUSES).map(([value, label]) => option(value, reviewMode ? 'review' : question.status).replace(`>${value}<`, `>${label}<`)).join('')}</select>
            </div>
            <div class="field check-field">
              <input id="favorite" name="favorite" type="checkbox" ${question.favorite ? 'checked' : ''} />
              <label for="favorite">Marquer comme favorite</label>
            </div>

            <h3 class="form-section-title">Suivi éditorial</h3>
            <div class="field full">
              <label for="tags">Tags libres</label>
              <input id="tags" name="tags" value="${escapeHtml(question.tags.join(' | '))}" placeholder="Bauhaus | histoire | à vérifier" />
            </div>
            <div class="field">
              <label for="source">Source</label>
              <input id="source" name="source" value="${escapeHtml(question.source)}" placeholder="Titre du livre ou lot de photos" />
            </div>
            <div class="field">
              <label for="sourcePage">Page</label>
              <input id="sourcePage" name="sourcePage" value="${escapeHtml(question.sourcePage)}" />
            </div>
            <div class="field full">
              <label for="revisionNotes">Notes pour la révision / l’IA</label>
              <textarea id="revisionNotes" name="revisionNotes" placeholder="Ex. Simplifier la formulation sans rendre la réponse évidente.">${escapeHtml(question.revisionNotes)}</textarea>
              <p class="field-help">Ces notes sont incluses dans l’export des révisions destiné à l’IA.</p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          ${existing ? `<button class="button danger" type="button" data-card-action="delete" data-id="${escapeHtml(question.id)}">Supprimer</button>
            <button class="button" type="button" data-card-action="history" data-id="${escapeHtml(question.id)}">Historique</button>` : ''}
          <span style="flex:1"></span>
          <button class="button" type="button" data-action="close-modal">Annuler</button>
          <button class="button accent" type="submit">Enregistrer</button>
        </div>
      </form>
    </div>`
}

function previewModalMarkup(id) {
  const question = state.questions.find((item) => item.id === id)
  const answers = [question.answer, ...question.wrongAnswers]
  return `<div class="modal-backdrop" data-close-modal>
    <div class="modal narrow">
      <div class="modal-head"><h2>Aperçu joueur</h2><button class="close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <div class="preview-frame">
          <div class="preview-category">${escapeHtml(question.category)} · ${escapeHtml(question.difficulty)}</div>
          <h3>${escapeHtml(question.question)}</h3>
          <div class="preview-answers">
            ${answers.map((answer, index) => `<div class="preview-answer ${index === 0 ? 'correct' : ''}">${escapeHtml(answer)}</div>`).join('')}
          </div>
          <div class="preview-foot">${question.milestones} jalon${question.milestones > 1 ? 's' : ''} · la bonne réponse est encadrée pour la relecture</div>
        </div>
      </div>
      <div class="modal-footer"><button class="button" data-action="close-modal">Fermer</button><button class="button primary" data-card-action="edit" data-id="${escapeHtml(id)}">Modifier</button></div>
    </div>
  </div>`
}

function statsModalMarkup() {
  const validated = state.questions.filter((question) => question.status === 'validated').length
  const review = state.questions.filter((question) => question.status === 'review').length
  const chart = (values, field) => {
    const rows = values.map((value) => ({ value, count: state.questions.filter((question) => question[field] === value).length }))
    const max = Math.max(...rows.map(({ count }) => count), 1)
    return rows.map(({ value, count }) => `<div class="chart-row"><span>${escapeHtml(value)}</span><div class="chart-bar"><span style="width:${count / max * 100}%"></span></div><b>${count}</b></div>`).join('')
  }
  return `<div class="modal-backdrop" data-close-modal>
    <div class="modal">
      <div class="modal-head"><div><p class="eyebrow">Qualité du lot</p><h2>Statistiques éditoriales</h2></div><button class="close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <div class="stat-grid">
          <div class="stat-block"><strong>${state.questions.length}</strong><span>questions</span></div>
          <div class="stat-block"><strong>${state.questions.length ? Math.round(validated / state.questions.length * 100) : 0}%</strong><span>validées</span></div>
          <div class="stat-block"><strong>${review}</strong><span>en révision</span></div>
        </div>
        <h3>Répartition par catégorie</h3>${chart(uniqueCategories(), 'category')}
        <h3 style="margin-top:25px">Répartition par difficulté</h3>${chart(DIFFICULTIES, 'difficulty')}
      </div>
      <div class="modal-footer"><button class="button primary" data-action="close-modal">Fermer</button></div>
    </div>
  </div>`
}

function statusHelpModalMarkup() {
  return `<div class="modal-backdrop" data-close-modal>
    <div class="modal narrow">
      <div class="modal-head"><div><p class="eyebrow">Workflow éditorial</p><h2>À quoi servent les états ?</h2></div><button class="close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <div class="status-guide">
          <div class="status-guide-item pending"><span class="status pending">En attente</span><p>Question nouvellement créée ou importée. Elle attend ta première relecture et peut encore être modifiée librement.</p></div>
          <div class="status-guide-item review"><span class="status review">En révision</span><p>La question a du potentiel, mais quelque chose doit changer. Ajoute une note précise pour demander à l’IA de la reformuler, de corriger les réponses ou d’ajuster sa difficulté.</p></div>
          <div class="status-guide-item validated"><span class="status validated">Validée</span><p>La question est relue et prête. C’est le seul état autorisé dans l’export final destiné à l’application.</p></div>
        </div>
        <p class="field-help">Ce ne sont pas des étapes obligatoires : tu peux passer directement une question d’En attente à Validée, ou renvoyer une question validée en révision.</p>
      </div>
      <div class="modal-footer"><button class="button primary" data-action="close-modal">J’ai compris</button></div>
    </div>
  </div>`
}

function historyModalMarkup(id) {
  const question = state.questions.find((item) => item.id === id)
  return `<div class="modal-backdrop" data-close-modal>
    <div class="modal narrow">
      <div class="modal-head"><div><p class="eyebrow">${escapeHtml(id)}</p><h2>Historique</h2></div><button class="close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <div class="history-list">${(question.history || []).length
          ? question.history.map((entry, index) => `<div class="history-item">
              <strong>${escapeHtml(entry.action)}</strong>
              <span>${formatDate(entry.at)}${entry.detail ? ` · ${escapeHtml(entry.detail)}` : ''}</span>
              ${entry.snapshot ? `<button class="text-button" style="display:block;margin-top:8px" data-restore-history="${index}" data-id="${escapeHtml(id)}">Restaurer cette version</button>` : ''}
            </div>`).join('')
          : '<p class="subhead">Aucune modification enregistrée.</p>'}
        </div>
      </div>
      <div class="modal-footer"><button class="button" data-card-action="edit" data-id="${escapeHtml(id)}">Retour à la fiche</button></div>
    </div>
  </div>`
}

function exportModalMarkup() {
  const selectedValidated = state.questions.filter((question) => state.selected.has(question.id) && question.status === 'validated')
  const allValidated = state.questions.filter((question) => question.status === 'validated')
  return `<div class="modal-backdrop" data-close-modal>
    <div class="modal narrow">
      <div class="modal-head"><h2>Exporter les questions validées</h2><button class="close" data-action="close-modal">×</button></div>
      <div class="modal-body">
        <p style="margin-top:0">Le fichier CSV ne contiendra que des questions à l’état <b>Validée</b>. Il restera indépendant de l’application de jeu.</p>
        ${selectedValidated.length ? `<button class="button primary" style="width:100%;margin-bottom:9px" data-export-scope="selected">Exporter les ${selectedValidated.length} validées sélectionnées</button>` : ''}
        <button class="button" style="width:100%" data-export-scope="all">Exporter toutes les validées (${allValidated.length})</button>
        ${state.selected.size && !selectedValidated.length ? '<p class="field-help">La sélection actuelle ne contient aucune question validée.</p>' : ''}
      </div>
    </div>
  </div>`
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function bindEvents() {
  document.querySelectorAll('[data-status-filter]').forEach((button) => button.addEventListener('click', () => {
    state.statusFilter = button.dataset.statusFilter
    render()
  }))
  document.querySelectorAll('[data-filter]').forEach((select) => select.addEventListener('change', () => {
    state[`${select.dataset.filter}Filter`] = select.value
    render()
  }))
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    state.view = button.dataset.view
    localStorage.setItem(VIEW_KEY, state.view)
    render()
  }))
  document.querySelectorAll('[data-select]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    checkbox.checked ? state.selected.add(checkbox.dataset.select) : state.selected.delete(checkbox.dataset.select)
    render()
  }))
  document.querySelectorAll('[data-card-select]').forEach((card) => card.addEventListener('click', (event) => {
    if (event.target.closest('button, input, select, textarea, a, label')) return
    toggleSelection(card.dataset.cardSelect)
  }))
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', handleAction))
  document.querySelectorAll('[data-card-action]').forEach((button) => button.addEventListener('click', handleCardAction))
  document.querySelectorAll('[data-bulk]').forEach((button) => button.addEventListener('click', () => bulkStatus(button.dataset.bulk)))
  document.querySelectorAll('[data-export-scope]').forEach((button) => button.addEventListener('click', () => exportValidated(button.dataset.exportScope)))
  document.querySelectorAll('[data-restore-history]').forEach((button) => button.addEventListener('click', () => {
    restoreHistory(button.dataset.id, Number(button.dataset.restoreHistory))
  }))
  const form = document.querySelector('#question-form')
  if (form) {
    form.addEventListener('submit', saveForm)
    form.querySelector('#mode')?.addEventListener('change', syncAnswerFields)
    form.querySelector('#challengeType')?.addEventListener('change', syncAnswerFields)
    syncAnswerFields()
  }
  document.querySelectorAll('[data-close-modal]').forEach((backdrop) => backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal()
  }))
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action
  if (action === 'new') openModal({ type: 'edit', id: null })
  if (action === 'import') document.querySelector('#csv-input').click()
  if (action === 'export-backup') exportCsv(state.questions, `question-studio-sauvegarde-${dateSlug()}.csv`)
  if (action === 'export-validated') openModal({ type: 'export' })
  if (action === 'export-revisions') exportRevisions()
  if (action === 'stats') openModal({ type: 'stats' })
  if (action === 'status-help') openModal({ type: 'status-help' })
  if (action === 'close-modal') closeModal()
  if (action === 'clear-selection') { state.selected.clear(); render() }
  if (action === 'delete-selected') deleteSelected()
  if (action === 'clear-filters') {
    state.statusFilter = state.categoryFilter = state.difficultyFilter = state.tagFilter = 'all'
    render()
  }
}

function toggleSelection(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id)
  render()
}

function syncAnswerFields() {
  const form = document.querySelector('#question-form')
  if (!form) return
  const mode = form.elements.mode.value
  const challenge = form.elements.challengeType.value
  const challengeField = form.elements.challengeType.closest('.field')
  const wrongField = form.elements.wrongAnswers.closest('.field')
  const help = form.querySelector('#wrong-answers-help')
  challengeField.hidden = mode !== 'Défi'
  if (mode !== 'Défi') {
    form.elements.challengeType.value = 'Buzzer'
    wrongField.hidden = false
    help.textContent = 'Quiz : exactement 2 mauvaises réponses, séparées avec |.'
  } else if (challenge === 'Buzzer') {
    wrongField.hidden = false
    help.textContent = 'Buzzer : exactement 2 mauvaises réponses, séparées avec |.'
  } else if (challenge === 'Vrai/Faux') {
    wrongField.hidden = false
    help.textContent = 'Vrai/Faux : indique l’unique réponse opposée.'
  } else {
    wrongField.hidden = true
    help.textContent = ''
  }
}

function handleCardAction(event) {
  const { cardAction: action, id } = event.currentTarget.dataset
  if (action === 'edit') openModal({ type: 'edit', id })
  if (action === 'preview') openModal({ type: 'preview', id })
  if (action === 'history') openModal({ type: 'history', id })
  if (action === 'review') openModal({ type: 'edit', id, reviewMode: true })
  if (action === 'validate') updateStatus(id, 'validated')
  if (action === 'delete') deleteQuestion(id)
}

function openModal(modal) {
  state.modal = modal
  render()
}

function closeModal() {
  state.modal = null
  render()
}

function saveForm(event) {
  event.preventDefault()
  const data = Object.fromEntries(new FormData(event.currentTarget))
  const challengeType = data.mode === 'Défi' ? data.challengeType : 'Aucun'
  const enteredWrongAnswers = splitPipe(data.wrongAnswers)
  const requiredWrongAnswers = data.mode === 'Quiz' || challengeType === 'Buzzer'
    ? 2
    : challengeType === 'Vrai/Faux' ? 1 : 0
  const wrongAnswers = requiredWrongAnswers ? enteredWrongAnswers : []
  if (wrongAnswers.length !== requiredWrongAnswers) {
    showToast(requiredWrongAnswers
      ? `Cette question doit contenir exactement ${requiredWrongAnswers} mauvaise${requiredWrongAnswers > 1 ? 's' : ''} réponse${requiredWrongAnswers > 1 ? 's' : ''}.`
      : 'Le défi Chiffres ne doit pas contenir de mauvaises réponses.')
    return
  }
  const existing = state.questions.find((question) => question.id === data.id)
  const updated = normalizeQuestion({
    ...existing,
    ...data,
    id: existing?.id || uid(),
    wrongAnswers,
    challengeType,
    tags: splitPipe(data.tags),
    favorite: Boolean(data.favorite),
    history: existing?.history || [],
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
  })
  addHistory(
    updated,
    existing ? 'Question modifiée' : 'Question créée',
    STATUSES[updated.status],
    questionSnapshot(existing),
  )
  if (existing) state.questions[state.questions.indexOf(existing)] = updated
  else state.questions.unshift(updated)
  saveQuestions()
  state.modal = null
  showToast(existing ? 'Question mise à jour.' : 'Question créée.')
  render()
}

function updateStatus(id, status) {
  const question = state.questions.find((item) => item.id === id)
  if (!question) return
  const previous = questionSnapshot(question)
  question.status = status
  addHistory(question, `État changé : ${STATUSES[status]}`, '', previous)
  saveQuestions()
  showToast(status === 'validated' ? 'Question validée.' : 'État mis à jour.')
  render()
}

function bulkStatus(status) {
  state.questions.filter((question) => state.selected.has(question.id)).forEach((question) => {
    const previous = questionSnapshot(question)
    question.status = status
    addHistory(question, `État changé en lot : ${STATUSES[status]}`, '', previous)
  })
  saveQuestions()
  state.selected.clear()
  showToast(`Sélection passée à l’état « ${STATUSES[status]} ».`)
  render()
}

function restoreHistory(id, historyIndex) {
  const question = state.questions.find((item) => item.id === id)
  const entry = question?.history?.[historyIndex]
  if (!question || !entry?.snapshot) return
  const current = questionSnapshot(question)
  const restored = normalizeQuestion({
    ...entry.snapshot,
    id: question.id,
    history: question.history,
    createdAt: question.createdAt,
    updatedAt: now(),
  })
  addHistory(restored, 'Version antérieure restaurée', formatDate(entry.at), current)
  state.questions[state.questions.indexOf(question)] = restored
  saveQuestions()
  state.modal = { type: 'edit', id }
  showToast('Version antérieure restaurée.')
  render()
}

function deleteQuestion(id) {
  const question = state.questions.find((item) => item.id === id)
  if (!question || !window.confirm(`Supprimer définitivement la question ${id} ?`)) return
  rememberDeletedCatalogIds([id])
  state.questions = state.questions.filter((item) => item.id !== id)
  state.selected.delete(id)
  saveQuestions()
  state.modal = null
  showToast('Question supprimée.')
  render()
}

function deleteSelected() {
  if (!window.confirm(`Supprimer définitivement ${state.selected.size} question(s) ?`)) return
  rememberDeletedCatalogIds([...state.selected])
  state.questions = state.questions.filter((question) => !state.selected.has(question.id))
  state.selected.clear()
  saveQuestions()
  showToast('Questions supprimées.')
  render()
}

function showToast(message) {
  clearTimeout(state.toastTimer)
  document.querySelector('.toast')?.remove()
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  document.body.append(toast)
  state.toastTimer = setTimeout(() => toast.remove(), 2800)
}

function csvEscape(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function questionToRow(question) {
  return {
    id: question.id,
    question: question.question,
    answer: question.answer,
    wrong_answers: question.wrongAnswers.join(' | '),
    explanation: question.explanation,
    category: question.category,
    difficulty: question.difficulty,
    milestones: question.milestones,
    mode: question.mode,
    challenge_type: question.challengeType,
    status: question.status,
    tags: question.tags.join(' | '),
    source: question.source,
    source_page: question.sourcePage,
    revision_notes: question.revisionNotes,
    favorite: question.favorite,
    confidence: question.confidence,
    created_at: question.createdAt,
    updated_at: question.updatedAt,
  }
}

function exportCsv(questions, filename) {
  if (!questions.length) return showToast('Aucune question à exporter.')
  const rows = questions.map(questionToRow)
  const csv = [
    CSV_COLUMNS.map(csvEscape).join(','),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvEscape(row[column])).join(',')),
  ].join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
  showToast(`${questions.length} question(s) exportée(s).`)
}

function exportValidated(scope) {
  const questions = state.questions.filter((question) => question.status === 'validated'
    && (scope === 'all' || state.selected.has(question.id)))
  exportCsv(questions, `questions-validees-${dateSlug()}.csv`)
  state.modal = null
  render()
}

function exportRevisions() {
  const questions = state.questions.filter((question) => question.status === 'review')
  exportCsv(questions, `questions-a-reviser-${dateSlug()}.csv`)
}

function dateSlug() {
  return new Date().toISOString().slice(0, 10)
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const clean = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') { field += '"'; index += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += char
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row) }
  const headers = rows.shift()?.map((header) => header.trim()) || []
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])))
}

document.querySelector('#csv-input').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  if (!file) return
  try {
    const records = parseCsv(await file.text())
    if (!records.length || !records.some((record) => record.question)) throw new Error('Format invalide')
    let created = 0
    let updated = 0
    records.forEach((record) => {
      const existing = record.id && state.questions.find((question) => question.id === record.id)
      const previous = questionSnapshot(existing)
      const imported = normalizeQuestion({
        ...existing,
        ...record,
        history: existing?.history || [],
        createdAt: existing?.createdAt || record.created_at || now(),
        updatedAt: now(),
      })
      addHistory(
        imported,
        existing ? 'Question mise à jour par import CSV' : 'Question importée',
        file.name,
        previous,
      )
      if (existing) { state.questions[state.questions.indexOf(existing)] = imported; updated += 1 }
      else { state.questions.push(imported); created += 1 }
    })
    saveQuestions()
    showToast(`${created} créée(s), ${updated} mise(s) à jour depuis le CSV.`)
    render()
  } catch {
    showToast('Import impossible : vérifiez le format du CSV.')
  } finally {
    event.target.value = ''
  }
})

render()
