import './styles.css'
import { createClient } from '@supabase/supabase-js'
import {
  createDuelsJson,
  createQuizJson,
  downloadJson,
  validateExport,
} from './gameExport.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const previewMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')
const configured = previewMode || Boolean(SUPABASE_URL && SUPABASE_KEY)
const supabase = !previewMode && configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

const VIEW_KEY = 'lcg-question-studio-view-v2'
const DIFFICULTIES = ['Pour les nuls', 'Facile', 'Moyen', 'Difficile', 'Expert']
const GAME_MODES = ['Quiz', 'Défi']
const CATEGORIES = [
  'Culture graphique',
  'Signe et couleur',
  'Typographie',
  'Logo',
  'Composition',
  'Production',
]
const CHALLENGES = ['Buzzer', 'Vrai/Faux', 'Chiffres']
const STATUS_ORDER = { pending: 0, review: 1, approved: 2, validated: 3 }
const STATUS_LABELS = {
  pending: 'En attente',
  review: 'En révision',
  approved: 'Une validation',
  validated: 'Validée',
}
const FILTER_LABELS = {
  all: 'Toutes les questions',
  pending: 'En attente',
  review: 'En révision',
  'awaiting-me': 'À valider par moi',
  'approved-lucas': 'Validées par Lucas',
  'approved-awen': 'Validées par Awen',
  validated: 'Validées par les deux',
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
const AUTH_EMAILS = {
  lucas: 'lucas@lcg-question-studio.app',
  awen: 'awen@lcg-question-studio.app',
}

const state = {
  loading: configured,
  session: null,
  profile: null,
  profiles: [],
  questions: [],
  approvals: [],
  comments: [],
  exports: [],
  presence: {},
  view: localStorage.getItem(VIEW_KEY) || 'grid',
  statusFilter: 'all',
  categoryFilter: 'all',
  difficultyFilter: 'all',
  modeFilter: 'all',
  tagFilter: 'all',
  favoriteOnly: false,
  trashMode: false,
  modal: null,
  realtimeChannel: null,
  presenceChannel: null,
  reloadTimer: null,
  toastTimer: null,
}

const app = document.querySelector('#app')

start()

async function start() {
  if (previewMode) {
    await startPreview()
    return
  }
  if (!configured) {
    render()
    return
  }

  const { data } = await supabase.auth.getSession()
  await applySession(data.session)

  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => applySession(session), 0)
  })
}

async function startPreview() {
  const { initialQuestions } = await import('./initialQuestions.js')
  state.profiles = [
    { id: 'lucas-preview', username: 'lucas', display_name: 'Lucas' },
    { id: 'awen-preview', username: 'awen', display_name: 'Awen' },
  ]
  state.profile = state.profiles[0]
  state.session = { user: { id: state.profile.id } }
  state.approvals = initialQuestions.flatMap((question) =>
    (question.approvals || []).map((approval) => ({
      question_id: question.id,
      reviewer_id: approval.reviewer === 'Lucas' ? 'lucas-preview' : 'awen-preview',
      created_at: approval.at,
    })),
  )
  state.comments = [
    {
      id: 1,
      question_id: initialQuestions[0].id,
      author_id: 'awen-preview',
      body: '@Lucas je trouve la formulation plus claire comme ça.',
      created_at: new Date().toISOString(),
    },
  ]
  state.questions = initialQuestions.map((question) => mapQuestion({
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
    confidence: question.confidence,
    version: 1,
    last_exported_version: null,
    last_exported_at: null,
    deleted_at: null,
    created_by: 'lucas-preview',
    updated_by: 'lucas-preview',
    created_at: question.createdAt,
    updated_at: question.updatedAt,
  }))
  state.loading = false
  render()
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
  if (!quiet) render()

  const [
    profilesResult,
    questionsResult,
    approvalsResult,
    commentsResult,
    exportsResult,
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('display_name'),
    supabase.from('questions').select('*').order('updated_at', { ascending: false }),
    supabase.from('question_approvals').select('*'),
    supabase.from('question_comments').select('*').order('created_at'),
    supabase.from('export_batches').select('*').order('created_at', { ascending: false }).limit(20),
  ])

  const error = [
    profilesResult.error,
    questionsResult.error,
    approvalsResult.error,
    commentsResult.error,
    exportsResult.error,
  ].find(Boolean)

  if (error) {
    state.loading = false
    showToast(`Synchronisation impossible : ${friendlyError(error)}`)
    render()
    return
  }

  state.profiles = profilesResult.data
  state.profile = state.profiles.find((profile) => profile.id === state.session.user.id) || null
  state.approvals = approvalsResult.data
  state.comments = commentsResult.data
  state.exports = exportsResult.data
  state.questions = questionsResult.data.map(mapQuestion)
  state.loading = false
  render()
}

function setupRealtime() {
  if (state.realtimeChannel || !state.profile) return

  state.realtimeChannel = supabase
    .channel('question-studio-database')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'question_approvals' }, scheduleReload)
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
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">QS</div>
          <div>
            <strong>Question Studio</strong>
            <span>Base partagée · synchronisation en temps réel</span>
          </div>
        </div>
        <div class="top-actions">
          <span class="sync-indicator"><i></i> Synchronisé</span>
          <button class="button primary" data-action="export">Exporter JSON</button>
          <button class="button accent" data-action="new">Créer une question</button>
          <button class="account-button" data-action="logout">
            <span>${escapeHtml(state.profile.display_name.slice(0, 1))}</span>
            ${escapeHtml(state.profile.display_name)}
          </button>
        </div>
      </header>

      <div class="workspace">
        <aside class="sidebar">
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
            <button class="status-help-button" data-action="status-help">Comprendre les états</button>
          </section>

          <section class="sidebar-section">
            <p class="sidebar-label">Filtres</p>
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
            <select class="select" data-filter="tag">
              <option value="all">Tous les tags</option>
              ${allTags().map((value) => option(value, state.tagFilter)).join('')}
            </select>
            <label class="filter-toggle ${state.favoriteOnly ? 'active' : ''}">
              <input type="checkbox" data-favorite-filter ${state.favoriteOnly ? 'checked' : ''} />
              <span>Favoris uniquement</span>
            </label>
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
        </aside>

        <main class="main">
          <div class="page-head">
            <div>
              <p class="eyebrow">${state.trashMode ? 'Corbeille' : FILTER_LABELS[state.statusFilter]}</p>
              <h1>${state.trashMode ? 'Cartes supprimées' : 'Atelier des questions'}</h1>
              <p class="subhead">${state.trashMode
                ? 'Ces cartes restent restaurables jusqu’au vidage de la corbeille.'
                : `Connecté en tant que ${escapeHtml(state.profile.display_name)}.`}</p>
            </div>
            <div class="page-head-actions">
              ${state.trashMode && visible.length
                ? '<button class="button danger" data-action="empty-trash">Vider la corbeille</button>'
                : ''}
              <div class="view-switch">
                <button class="icon-button ${state.view === 'grid' ? 'active' : ''}" data-view="grid" title="Vue grille">▦</button>
                <button class="icon-button ${state.view === 'list' ? 'active' : ''}" data-view="list" title="Vue liste">☷</button>
              </div>
            </div>
          </div>

          ${state.trashMode ? '' : `
            <div class="summary-strip">
              <div class="summary-item"><strong>${active.length}</strong><span>questions actives</span></div>
              <div class="summary-item"><strong>${awaitingMe}</strong><span>à valider par moi</span></div>
              <div class="summary-item"><strong>${validated}</strong><span>validées par les deux</span></div>
              <div class="summary-item"><strong>${review}</strong><span>en révision</span></div>
              <div class="summary-item"><strong>${exported}</strong><span>déjà exportées</span></div>
            </div>
          `}

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

function loginMarkup() {
  return `
    <main class="auth-page">
      <section class="auth-panel">
        <div class="brand-mark auth-logo">QS</div>
        <p class="eyebrow">Le Cube Graphique</p>
        <h1>Question Studio</h1>
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
        <div class="brand-mark auth-logo">QS</div>
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

function loadingMarkup() {
  return `
    <main class="auth-page">
      <section class="auth-panel loading-panel">
        <div class="brand-mark auth-logo">QS</div>
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
      if (state.tagFilter !== 'all' && !question.tags.includes(state.tagFilter)) return false
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
            <span>Modifiée ${formatRelative(question.updatedAt)}${updater ? ` par ${escapeHtml(updater)}` : ''}</span>
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
  const milestone = Math.min(5, Math.max(1, question.milestones))
  return `
    <img class="game-tag-image" src="/game/categorie/diff-${milestone}.png" alt="${milestone} jalons" />
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
      return `<span class="approval-chip ${approved ? 'approved' : ''}">${approved ? '✓' : '○'} ${escapeHtml(profile.display_name)}</span>`
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

function allTags() {
  return [...new Set(
    state.questions.filter((question) => !question.deletedAt).flatMap((question) => question.tags),
  )].sort((left, right) => left.localeCompare(right, 'fr'))
}

function hasActiveFilters() {
  return state.statusFilter !== 'all'
    || state.categoryFilter !== 'all'
    || state.difficultyFilter !== 'all'
    || state.modeFilter !== 'all'
    || state.tagFilter !== 'all'
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
  if (state.modal.type === 'comments') return commentsModalMarkup()
  if (state.modal.type === 'history') return historyModalMarkup()
  if (state.modal.type === 'export') return exportModalMarkup()
  if (state.modal.type === 'status-help') return statusHelpMarkup()
  return ''
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
              <div class="field">
                <label for="difficulty">Difficulté</label>
                <select id="difficulty" name="difficulty">${DIFFICULTIES.map((value) => option(value, question.difficulty)).join('')}</select>
              </div>
              <div class="field">
                <label for="milestones">Jalons gagnés</label>
                <select id="milestones" name="milestones">${[1, 2, 3, 4, 5].map((value) => option(String(value), String(question.milestones))).join('')}</select>
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
                Ajouter aux favorites
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
        <strong>${escapeHtml(profileName(comment.author_id))}</strong>
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
  document.querySelector('[data-favorite-filter]')?.addEventListener('change', (event) => {
    state.favoriteOnly = event.currentTarget.checked
    render()
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

  const questionForm = document.querySelector('#question-form')
  if (questionForm) {
    questionForm.addEventListener('submit', saveQuestion)
    questionForm.elements.mode.addEventListener('change', syncQuestionForm)
    questionForm.elements.challengeType.addEventListener('change', syncQuestionForm)
    syncQuestionForm()
  }

  document.querySelector('#comment-form')?.addEventListener('submit', addComment)
}

async function handleAction(event) {
  const action = event.currentTarget.dataset.action
  if (action === 'new') openModal({ type: 'edit', id: null })
  if (action === 'export') openModal({ type: 'export' })
  if (action === 'status-help') openModal({ type: 'status-help' })
  if (action === 'close-modal') closeModal()
  if (action === 'trash') {
    state.trashMode = !state.trashMode
    render()
  }
  if (action === 'clear-filters') {
    state.statusFilter = state.categoryFilter = state.difficultyFilter = state.modeFilter = state.tagFilter = 'all'
    state.favoriteOnly = false
    render()
  }
  if (action === 'logout') {
    if (previewMode) showToast('Mode aperçu : déconnexion désactivée.')
    else await supabase.auth.signOut()
  }
  if (action === 'empty-trash') await emptyTrash()
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
}

function openModal(modal) {
  state.modal = modal
  render()
  updatePresence()
}

function closeModal() {
  state.modal = null
  render()
  updatePresence(null)
}

async function openHistory(id) {
  state.modal = { type: 'history', id, entries: null }
  render()
  updatePresence(id)
  if (previewMode) {
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

async function saveQuestion(event) {
  event.preventDefault()
  if (previewMode) return showToast('Mode aperçu : aucune donnée n’est enregistrée.')
  const form = event.currentTarget
  const data = Object.fromEntries(new FormData(form))
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
    difficulty: data.difficulty,
    milestones: Number(data.milestones),
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

  state.modal = null
  await loadWorkspace({ quiet: true })
  updatePresence(null)
  showToast(existing ? 'Question enregistrée. Les validations ont été réinitialisées.' : 'Question créée.')
}

async function approveQuestion(id) {
  if (previewMode) return showToast('Mode aperçu : validation simulée uniquement.')
  const { error } = await supabase.rpc('approve_question', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  showToast(`Validation ajoutée par ${state.profile.display_name}.`)
}

async function revokeApproval(id) {
  if (previewMode) return showToast('Mode aperçu : validation simulée uniquement.')
  const { error } = await supabase.rpc('revoke_my_approval', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  showToast('Ta validation a été retirée.')
}

async function changeStatus(id, status) {
  if (previewMode) return showToast('Mode aperçu : changement non enregistré.')
  const label = status === 'review' ? 'en révision' : 'en attente'
  if (!window.confirm(`Passer cette carte ${label} ? Les validations actuelles seront retirées.`)) return
  const { error } = await supabase.rpc('set_question_status', {
    p_question_id: id,
    p_status: status,
  })
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  showToast(`Carte passée ${label}.`)
}

async function trashQuestion(id) {
  if (previewMode) return showToast('Mode aperçu : suppression non enregistrée.')
  if (!window.confirm('Déplacer cette carte dans la corbeille ?')) return
  const { error } = await supabase.rpc('move_question_to_trash', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  state.modal = null
  await loadWorkspace({ quiet: true })
  showToast('Carte placée dans la corbeille.')
}

async function restoreQuestion(id) {
  if (previewMode) return showToast('Mode aperçu : restauration non enregistrée.')
  const { error } = await supabase.rpc('restore_question', { p_question_id: id })
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  showToast('Carte restaurée.')
}

async function emptyTrash() {
  if (previewMode) return showToast('Mode aperçu : corbeille non modifiée.')
  const count = state.questions.filter((question) => question.deletedAt).length
  if (!window.confirm(`Supprimer définitivement ${count} carte${count > 1 ? 's' : ''} ? Cette action est irréversible.`)) return
  const { error } = await supabase.rpc('empty_trash')
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  showToast('Corbeille vidée.')
}

async function toggleFavorite(id) {
  if (previewMode) return showToast('Mode aperçu : favori non enregistré.')
  const question = state.questions.find((item) => item.id === id)
  const { error } = await supabase
    .from('questions')
    .update({
      favorite: !question.favorite,
      updated_by: state.profile.id,
    })
    .eq('id', id)
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
}

async function addComment(event) {
  event.preventDefault()
  if (previewMode) return showToast('Mode aperçu : commentaire non envoyé.')
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
  if (previewMode) return showToast('Mode aperçu : commentaire non supprimé.')
  if (!window.confirm('Supprimer ce commentaire ?')) return
  const { error } = await supabase.from('question_comments').delete().eq('id', id)
  if (error) return showToast(friendlyError(error))
  await loadWorkspace({ quiet: true })
  render()
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

  if (previewMode) {
    state.modal = null
    render()
    showToast(`${filename} généré en mode aperçu.`)
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

function option(value, selected) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(value)}</option>`
}

function profileName(id) {
  return state.profiles.find((profile) => profile.id === id)?.display_name || ''
}

function createQuestionId() {
  return `Q-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
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
