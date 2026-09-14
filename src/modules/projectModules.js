import { BACKLOG_PRIORITIES, BACKLOG_SOURCES, BACKLOG_STATUSES, CATEGORIES, DIFFICULTIES, FEATURE_AREAS } from '../studioConfig.js'
import { worklogContextMarkup, worklogViewMarkup } from './worklogView.js'

const PRIORITY_WEIGHT = { Haute: 0, Moyenne: 1, Basse: 2 }
const STATUS_WEIGHT = { 'En cours': 0, 'À tester': 1, 'À faire': 2, Backlog: 3, Terminé: 4 }

export function moduleNavMarkup({ modules, activeModule, escapeHtml }) {
  return `
    <nav class="module-nav" aria-label="Modules LCG Studio">
      ${modules.map((module) => `
        <button class="module-tab ${activeModule === module.id ? 'active' : ''}" type="button" data-action="module" data-module="${module.id}" aria-current="${activeModule === module.id ? 'page' : 'false'}" title="${escapeHtml(module.label)}">
          <span class="module-initial">${module.icon ? `<img src="${escapeHtml(module.icon)}" alt="" aria-hidden="true" />` : escapeHtml(module.short)}</span>
          <span class="module-label">${escapeHtml(module.label)}</span>
        </button>
      `).join('')}
    </nav>
  `
}

export function sidebarContextMarkup({ state, escapeHtml }) {
  if (state.activeModule === 'backlog') return backlogSidebarContextMarkup(state, escapeHtml)
  if (state.activeModule === 'ideas') return ideasSidebarContextMarkup(state)
  if (state.activeModule === 'questions') return questionsSidebarContextMarkup(state, escapeHtml)
  if (state.activeModule === 'playtests') return playtestsSidebarContextMarkup(state, escapeHtml)
  if (state.activeModule === 'worklog') return worklogContextMarkup(state, escapeHtml)
  return ''
}

export function projectModuleMarkup({ state, escapeHtml, profileBadgeMarkup }) {
  if (state.activeModule === 'questions') return ''
  if (state.activeModule === 'backlog') return backlogMarkup({ state, escapeHtml, profileBadgeMarkup })
  if (state.activeModule === 'ideas') return ideasMarkup({ state, escapeHtml })
  if (state.activeModule === 'playtests') return playtestsMarkup({ state, escapeHtml, profileBadgeMarkup })
  if (state.activeModule === 'worklog') return worklogViewMarkup(state, escapeHtml)
  return backlogMarkup({ state, escapeHtml, profileBadgeMarkup })
}

function backlogMarkup({ state, escapeHtml, profileBadgeMarkup }) {
  const visibleBacklog = filteredBacklog(state.backlog, state)
  const visibleStatuses = visibleBacklogStatuses(state)
  const openTickets = visibleBacklog.filter((ticket) => ticket.status !== 'Terminé')
  const completedTickets = visibleBacklog.filter((ticket) => ticket.status === 'Terminé')
  const testingTickets = visibleBacklog.filter((ticket) => ticket.status === 'À tester')
  const mineTickets = visibleBacklog.filter((ticket) => ownerMatchesProfile(ticket, state.profile) && ticket.status !== 'Terminé')
  const priorityTickets = openTickets.slice().sort(sortTodoTickets)
  const completion = visibleBacklog.length ? Math.round((completedTickets.length / visibleBacklog.length) * 100) : 0
  const hasFilters = hasBacklogFilters(state)

  return `
    <main class="module-screen backlog-workspace view-${state.backlogView}">
      <section class="module-head backlog-head">
        <div class="backlog-heading">
          <p class="eyebrow">Pilotage produit</p>
          <h1>Backlog & Kanban</h1>
          <p class="subhead">Les tâches du jeu et du Studio, regroupées dans un flux de travail commun.</p>
        </div>
        <div class="backlog-head-actions">
          <button class="button primary backlog-new-ticket" type="button" data-action="new-ticket"><span aria-hidden="true">+</span> Nouveau ticket</button>
        </div>
        <div class="backlog-kpis" aria-label="Synthèse du backlog">
          <span data-tone="open"><b>${openTickets.length}</b><small>Ouverts</small></span>
          <span data-tone="test"><b>${testingTickets.length}</b><small>À tester</small></span>
          <span data-tone="mine"><b>${mineTickets.length}</b><small>Pour moi</small></span>
          <span data-tone="done"><b>${completion}%</b><small>Terminé</small></span>
        </div>
      </section>

      <section class="backlog-filter-panel" aria-label="Filtres backlog">
        <div class="backlog-filter-fields">
          <input class="select backlog-search" type="search" data-backlog-filter="search" value="${escapeHtml(state.backlogSearch)}" placeholder="Rechercher un ticket…" aria-label="Rechercher un ticket" />
          <div class="backlog-filter-actions">
            <label class="backlog-filter-control">
              <span>Utilisateur</span>
              <select data-backlog-filter="owner" aria-label="Filtrer par utilisateur">
                <option value="all">Tous</option>
                ${state.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${state.backlogOwnerFilter === profile.id ? 'selected' : ''}>${escapeHtml(profile.display_name)}</option>`).join('')}
              </select>
            </label>
            <label class="backlog-filter-control">
              <span>Tags</span>
              <select data-backlog-filter="tag" aria-label="Filtrer par tag">
                <option value="all">Tous</option>
                ${backlogTags(state.backlog).map((tag) => optionMarkup(tag, state.backlogTagFilter, escapeHtml)).join('')}
              </select>
            </label>
            <label class="backlog-filter-control">
              <span>Source</span>
              <select data-backlog-filter="source" aria-label="Filtrer par source">
                <option value="all">Toutes</option>
                ${BACKLOG_SOURCES.map((source) => optionMarkup(source, state.backlogSourceFilter, escapeHtml)).join('')}
              </select>
            </label>
            <label class="backlog-filter-control">
              <span>Priorité</span>
              <select data-backlog-filter="priority" aria-label="Filtrer par priorité">
                <option value="all">Toutes</option>
                ${BACKLOG_PRIORITIES.map((priority) => optionMarkup(priority, state.backlogPriorityFilter, escapeHtml)).join('')}
              </select>
            </label>
            <button class="backlog-filter-reset" type="button" data-action="clear-backlog-filters" ${hasFilters ? '' : 'disabled'}>Réinitialiser</button>
          </div>
        </div>
      </section>

      <section class="backlog-viewbar" aria-label="Mode d'affichage du backlog">
        <div class="backlog-view-switch" role="group" aria-label="Choisir une vue">
          <button type="button" data-backlog-view="priority" class="${state.backlogView === 'priority' ? 'active' : ''}" aria-pressed="${state.backlogView === 'priority'}">Priorité</button>
          <button type="button" data-backlog-view="flow" class="${state.backlogView === 'flow' ? 'active' : ''}" aria-pressed="${state.backlogView === 'flow'}">Flux</button>
        </div>
          ${state.backlogView === 'flow' ? columnToggleMarkup(state, escapeHtml) : '<span class="priority-view-note">Tâches ouvertes classées par priorité</span>'}
      </section>

      <section class="backlog-layout">
        <section class="todo-panel backlog-todo-panel">
          <header class="todo-panel-head">
            <div>
              <p class="eyebrow">Priorités</p>
              <h2>À faire ensuite</h2>
            </div>
            <div class="todo-panel-actions">
              <span>${openTickets.length} tâches actives</span>
              <button class="button small" type="button" data-action="new-ticket"><span aria-hidden="true">+</span> Ajouter</button>
            </div>
          </header>
          <div class="todo-list">
            ${priorityTickets.length
              ? priorityTickets.map((ticket) => todoItemMarkup(ticket, state, escapeHtml, profileBadgeMarkup)).join('')
              : `<div class="backlog-empty-state">
                  <strong>Aucune tâche trouvée</strong>
                  <span>${hasFilters ? 'Aucun ticket ne correspond aux filtres sélectionnés.' : 'Toutes les tâches ouvertes ont été traitées.'}</span>
                  ${hasFilters ? '<button class="text-button" type="button" data-action="clear-backlog-filters">Réinitialiser les filtres</button>' : ''}
                </div>`}
          </div>
        </section>

        <section class="kanban-section">
          <header class="kanban-toolbar">
            <div>
              <p class="eyebrow">Flux de travail</p>
              <h2>Kanban</h2>
            </div>
            <span>${visibleStatuses.length} colonnes</span>
          </header>
          <div class="kanban-board" style="--kanban-columns: ${visibleStatuses.length}" aria-label="Kanban backlog">
            ${visibleStatuses.map((status) => {
              const tickets = visibleBacklog.filter((ticket) => ticket.status === status)
              return `
                <article class="kanban-column" data-status="${escapeHtml(status)}" data-drop-status="${escapeHtml(status)}">
                  <header class="kanban-column-head">
                    <div><i aria-hidden="true"></i><h2>${escapeHtml(status)}</h2></div>
                    <span>${tickets.length}</span>
                  </header>
                  <div class="kanban-dropzone">
                    ${['Backlog', 'À faire'].includes(status) ? createTicketCardMarkup(status, escapeHtml) : ''}
                    ${tickets.length ? tickets.map((ticket) => ticketRowMarkup(ticket, state, escapeHtml, profileBadgeMarkup)).join('') : '<p class="kanban-empty">Aucun ticket</p>'}
                  </div>
                </article>
              `
            }).join('')}
          </div>
        </section>
      </section>
    </main>
  `
}
function backlogSidebarContextMarkup(state, escapeHtml) {
  const features = featureSummaries(state.backlog)
  const selectedFeature = state.backlogFeatureFilter
  return `
    <section class="nav-context" aria-label="Contexte Backlog">
      <div class="nav-context-divider"></div>
      <p class="nav-context-label">Features</p>
      <div class="nav-context-list">
        ${features.map((feature) => sidebarFeatureRowMarkup(feature, selectedFeature, escapeHtml)).join('') || '<p class="muted-line">Aucune feature.</p>'}
      </div>
    </section>
  `
}

function sidebarFeatureRowMarkup(feature, selectedFeature, escapeHtml) {
  return `
    <button class="nav-context-row ${selectedFeature === feature.name ? 'active' : ''}" type="button" data-action="set-backlog-feature" data-feature="${escapeHtml(feature.name)}" title="${escapeHtml(feature.nextAction || feature.name)}">
      <span class="nav-context-row-head">
        <strong>${escapeHtml(feature.name)}</strong>
        <em>${feature.done}/${feature.total}</em>
      </span>
      <span class="nav-context-progress" aria-hidden="true"><i style="width: ${feature.percent}%"></i></span>
      <small>${escapeHtml(feature.nextAction || 'Aucune action ouverte.')}</small>
    </button>
  `
}

function questionsSidebarContextMarkup(state, escapeHtml) {
  const active = state.questions.filter((question) => !question.deletedAt)
  const count = (filter) => active.filter((question) => questionMatchesContextStatus(question, filter, state.profile?.id)).length
  const trashCount = state.questions.filter((question) => question.deletedAt).length

  return `
    <section class="nav-context question-nav-context" aria-label="Filtres Question Studio">
      <div class="nav-context-divider"></div>
      <div class="question-context-scroll">
        <section class="question-context-section">
          <p class="nav-context-label">État</p>
          <div class="state-filter">
            ${questionContextStatusButtonMarkup('all', 'Toutes', active.length, state, escapeHtml)}
            ${questionContextStatusButtonMarkup('pending', 'En attente', count('pending'), state, escapeHtml)}
            ${questionContextStatusButtonMarkup('review', 'En révision', count('review'), state, escapeHtml)}
            ${questionContextStatusButtonMarkup('awaiting-me', 'À valider par moi', count('awaiting-me'), state, escapeHtml)}
            ${questionContextStatusButtonMarkup('approved-lucas', 'Validées par Lucas', count('approved-lucas'), state, escapeHtml)}
            ${questionContextStatusButtonMarkup('approved-awen', 'Validées par Awen', count('approved-awen'), state, escapeHtml)}
            ${questionContextStatusButtonMarkup('validated', 'Validées par les deux', count('validated'), state, escapeHtml)}
          </div>
        </section>
        <section class="question-context-section">
          <p class="nav-context-label">Répartition</p>
          <div class="balance-card">${questionContextBalanceMarkup(active, escapeHtml)}</div>
        </section>
        <section class="question-context-section">
          <button class="trash-button ${state.trashMode ? 'active' : ''}" data-action="trash">
            Corbeille <span>${trashCount}</span>
          </button>
        </section>
      </div>
    </section>
  `
}

function questionContextStatusButtonMarkup(value, label, count, state, escapeHtml) {
  return `<button class="filter-chip ${state.statusFilter === value && !state.trashMode ? 'active' : ''}" data-status-filter="${escapeHtml(value)}"><span>${escapeHtml(label)}</span><span class="filter-count">${count}</span></button>`
}

function questionMatchesContextStatus(question, filter, profileId) {
  if (filter === 'all') return true
  if (filter === 'approved-lucas') return (question.approvals || []).some((approval) => approval.reviewer === 'Lucas')
  if (filter === 'approved-awen') return (question.approvals || []).some((approval) => approval.reviewer === 'Awen')
  if (filter === 'awaiting-me') {
    return question.status !== 'review'
      && question.status !== 'validated'
      && !(question.approvals || []).some((approval) => approval.reviewerId === profileId)
  }
  return question.status === filter
}

function questionContextBalanceMarkup(questions, escapeHtml) {
  return CATEGORIES.map((category) => {
    const categoryQuestions = questions.filter((question) => question.category === category)
    return `
      <details class="balance-details">
        <summary><span>${escapeHtml(category)}</span><b>${categoryQuestions.length}</b></summary>
        <div class="difficulty-counts">
          ${DIFFICULTIES.map((difficulty) => `<span>${escapeHtml(difficulty)} <b>${categoryQuestions.filter((question) => question.difficulty === difficulty).length}</b></span>`).join('')}
        </div>
      </details>
    `
  }).join('')
}
function playtestsSidebarContextMarkup(state, escapeHtml) {
  const sessions = state.playtests || []
  const planned = sessions.filter((playtest) => playtest.status === 'Planifiée').length
  const toDocument = sessions.filter((playtest) => playtest.status === 'À documenter').length
  const finished = sessions.filter((playtest) => playtest.status === 'Terminée').length

  return `
    <section class="nav-context" aria-label="Contexte Playtests">
      <div class="nav-context-divider"></div>
      <p class="nav-context-label">Playtests</p>
      <div class="nav-context-list">
        ${contextStatRowMarkup('Sessions', sessions.length, escapeHtml)}
        ${contextStatRowMarkup('Planifiées', planned, escapeHtml)}
        ${contextStatRowMarkup('À documenter', toDocument, escapeHtml)}
        ${contextStatRowMarkup('Terminées', finished, escapeHtml)}
      </div>
    </section>
  `
}
function contextStatRowMarkup(label, count, escapeHtml) {
  return `
    <div class="nav-context-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${count}</strong>
    </div>
  `
}

function columnToggleMarkup(state, escapeHtml) {
  const visibleStatuses = visibleBacklogStatuses(state)
  return `
    <section class="column-toggle-panel" aria-label="Colonnes visibles">
      <span class="column-toggle-title">Colonnes affichées</span>
      <div class="column-toggle-list">
        ${BACKLOG_STATUSES.map((status) => {
          const visible = visibleStatuses.includes(status)
          const locked = visible && visibleStatuses.length === 1
          return `
            <label class="column-toggle ${visible ? 'active' : ''}" data-status="${escapeHtml(status)}">
              <input type="checkbox" data-column-toggle="${escapeHtml(status)}" ${visible ? 'checked' : ''} ${locked ? 'disabled' : ''} />
              <i aria-hidden="true"></i>
              <span>${escapeHtml(status)}</span>
            </label>
          `
        }).join('')}
      </div>
    </section>
  `
}

function visibleBacklogStatuses(state) {
  const selected = Array.isArray(state.visibleBacklogStatuses)
    ? state.visibleBacklogStatuses
    : BACKLOG_STATUSES
  const statuses = BACKLOG_STATUSES.filter((status) => selected.includes(status))
  return statuses.length ? statuses : BACKLOG_STATUSES
}

function filteredBacklog(tickets, state) {
  const query = normalizeSearch(state.backlogSearch)
  return tickets.filter((ticket) => {
    if (state.backlogOwnerFilter !== 'all' && ticket.ownerId !== state.backlogOwnerFilter) return false
    if (state.backlogFeatureFilter !== 'all' && ticket.feature !== state.backlogFeatureFilter) return false
    if (state.backlogTagFilter !== 'all' && !ticketTags(ticket).some((tag) => tag.name === state.backlogTagFilter)) return false
    if (state.backlogSourceFilter !== 'all' && ticket.source !== state.backlogSourceFilter) return false
    if (state.backlogPriorityFilter !== 'all' && ticket.priority !== state.backlogPriorityFilter) return false
    if (!query) return true
    return normalizeSearch([
      ticket.id,
      ticket.title,
      ticket.description,
      ticket.objective,
      ticket.risk,
      ticket.validation,
      ticketTags(ticket).map((tag) => tag.name).join(' '),
      ticket.source,
      ticket.feature,
      ticket.owner,
      ticket.due,
    ].join(' ')).includes(query)
  })
}

function hasBacklogFilters(state) {
  return Boolean(state.backlogSearch)
    || state.backlogOwnerFilter !== 'all'
    || state.backlogFeatureFilter !== 'all'
    || state.backlogTagFilter !== 'all'
    || state.backlogSourceFilter !== 'all'
    || state.backlogPriorityFilter !== 'all'
}

function backlogTags(tickets) {
  return [...new Set(tickets.flatMap((ticket) => ticketTags(ticket).map((tag) => tag.name)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'fr'))
}

function optionMarkup(value, selected, escapeHtml) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function ideasSidebarContextMarkup(state) {
  const total = state.ideas.length
  const pinned = state.ideas.filter((idea) => idea.pinned).length
  return `
    <section class="nav-context" aria-label="Contexte Idées">
      <div class="nav-context-divider"></div>
      <p class="nav-context-label">Idées</p>
      <div class="nav-context-list">
        <div class="nav-context-note"><strong>${total}</strong><span>Notes conservées</span></div>
        <div class="nav-context-note"><strong>${pinned}</strong><span>Épinglées</span></div>
      </div>
    </section>
  `
}

function ideasMarkup({ state, escapeHtml }) {
  const query = state.ideasSearch.trim().toLocaleLowerCase('fr')
  const ideas = state.ideas
    .filter((idea) => !query || (idea.title + ' ' + idea.content).toLocaleLowerCase('fr').includes(query))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned)
      || new Date(right.updatedAt) - new Date(left.updatedAt))

  return `
    <main class="module-screen ideas-screen">
      <section class="module-head ideas-head">
        <div>
          <p class="eyebrow">Carnet collectif</p>
          <h1>Idées</h1>
          <p class="subhead">Un espace libre pour garder les pistes, les envies et les intuitions.</p>
        </div>
        <div class="ideas-head-count">${state.ideas.length} note${state.ideas.length > 1 ? 's' : ''}</div>
      </section>

      <section class="ideas-toolbar">
        <form id="idea-create-form" class="idea-composer">
          <input name="title" maxlength="100" placeholder="Une idée en tête ?" aria-label="Titre de l’idée" required />
          <textarea name="content" maxlength="3000" placeholder="Développer l’idée…" aria-label="Contenu de l’idée"></textarea>
          <div class="idea-composer-bottom">
            <label class="idea-color-field"><span>Couleur</span>
              <select name="colorKey" aria-label="Couleur du post-it">
                <option value="white">Blanc</option>
                <option value="yellow">Jaune</option>
                <option value="blue">Bleu</option>
                <option value="pink">Rose</option>
                <option value="green">Vert</option>
                <option value="orange">Orange</option>
              </select>
            </label>
            <button class="button primary" type="submit">Ajouter l’idée</button>
          </div>
        </form>
        <input class="select ideas-search" type="search" data-ideas-search value="${escapeHtml(state.ideasSearch)}" placeholder="Rechercher dans les idées…" aria-label="Rechercher dans les idées" />
      </section>

      <section class="ideas-board" aria-label="Notes d’idées">
        ${ideas.length
          ? ideas.map((idea) => ideaCardMarkup(idea, escapeHtml, state.editingIdeaId)).join('')
          : `<div class="backlog-empty-state ideas-empty">
              <strong>${query ? 'Aucune idée trouvée' : 'Le carnet est vide'}</strong>
              <span>${query ? 'Essaie une autre recherche.' : 'Ajoute la première note ci-dessus.'}</span>
            </div>`}
      </section>
    </main>
  `
}

function ideaCardMarkup(idea, escapeHtml, editingId) {
  if (editingId === idea.id) {
    return `
      <form class="idea-note idea-note-editing" data-idea-color="${escapeHtml(idea.colorKey)}" data-idea-edit-form="${escapeHtml(idea.id)}">
        <input name="title" maxlength="100" value="${escapeHtml(idea.title)}" aria-label="Titre de l’idée" required />
        <textarea name="content" maxlength="3000" aria-label="Contenu de l’idée">${escapeHtml(idea.content)}</textarea>
        <label class="idea-color-field"><span>Couleur</span>
          <select name="colorKey" aria-label="Couleur du post-it">
            ${[['white', 'Blanc'], ['yellow', 'Jaune'], ['blue', 'Bleu'], ['pink', 'Rose'], ['green', 'Vert'], ['orange', 'Orange']]
              .map(([key, label]) => `<option value="${key}" ${idea.colorKey === key ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <div class="idea-edit-actions">
          <button class="button small" type="button" data-action="cancel-idea-edit">Annuler</button>
          <button class="button primary small" type="submit">Enregistrer</button>
        </div>
      </form>
    `
  }

  return `
    <article class="idea-note" data-idea-color="${escapeHtml(idea.colorKey)}">
      <div class="idea-note-head">
        <span class="idea-note-mark" aria-hidden="true"></span>
        <div class="idea-note-actions">
          <button class="icon-button ${idea.pinned ? 'active' : ''}" type="button" data-action="pin-idea" data-idea-id="${escapeHtml(idea.id)}" aria-label="${idea.pinned ? 'Désépingler' : 'Épingler'} l’idée" title="${idea.pinned ? 'Désépingler' : 'Épingler'}">⌖</button>
          <button class="icon-button" type="button" data-action="edit-idea" data-idea-id="${escapeHtml(idea.id)}" aria-label="Modifier l’idée" title="Modifier">✎</button>
          <button class="icon-button" type="button" data-action="delete-idea" data-idea-id="${escapeHtml(idea.id)}" aria-label="Supprimer l’idée" title="Supprimer">×</button>
        </div>
      </div>
      <h2>${escapeHtml(idea.title)}</h2>
      ${idea.content ? `<p>${escapeHtml(idea.content)}</p>` : ''}
      <footer>${idea.pinned ? '<span>Épinglée</span>' : '<span></span>'}<time datetime="${escapeHtml(idea.updatedAt)}">${escapeHtml(formatIdeaDate(idea.updatedAt))}</time></footer>
    </article>
  `
}

function formatIdeaDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date)
}

function playtestsMarkup({ state, escapeHtml, profileBadgeMarkup }) {
  const sessions = [...state.playtests].sort((left, right) => right.date.localeCompare(left.date))
  const upcoming = sessions.filter((session) => session.status === 'Planifiée')
    .sort((left, right) => left.date.localeCompare(right.date))
  const linkedTicketIds = new Set(sessions.flatMap((session) => session.relatedTicketIds || []))
  const openTickets = state.backlog.filter((ticket) => linkedTicketIds.has(ticket.id) && ticket.status !== 'Terminé').length
  const editor = state.playtestEditingId === 'new'
    ? null
    : sessions.find((session) => session.id === state.playtestEditingId)

  return `
    <main class="module-screen playtests-workspace">
      <section class="module-head playtests-head">
        <div class="playtest-heading">
          <p class="eyebrow">Tests du jeu</p>
          <h1>Playtests</h1>
          <p class="subhead">Préparer les sessions, consigner les observations et relier les suites au backlog.</p>
        </div>
        <div class="playtest-head-actions">
          <button class="button primary" type="button" data-action="playtest-create">Nouvelle session</button>
        </div>
        <div class="playtest-head-stats" aria-label="Synthèse Playtests">
          <span><b>${sessions.length}</b><small>Sessions suivies</small></span>
          <span><b>${upcoming.length}</b><small>Planifiées</small></span>
          <span><b>${openTickets}</b><small>Tickets liés ouverts</small></span>
        </div>
      </section>

      ${playtestGroupMarkup('Prochains tests', 'Sessions planifiées', upcoming, 'planned', state, escapeHtml, profileBadgeMarkup)}
      ${playtestGroupMarkup('À documenter', 'Tests effectués en attente de compte rendu', sessions.filter((session) => session.status === 'À documenter'), 'report', state, escapeHtml, profileBadgeMarkup)}
      <details class="playtest-archive">
        <summary><span>Tests terminés</span><b>${sessions.filter((session) => session.status === 'Terminée').length}</b></summary>
        <div class="playtest-sessions">
          ${sessions.filter((session) => session.status === 'Terminée').map((playtest) => playtestCardMarkup(playtest, state, escapeHtml, profileBadgeMarkup)).join('') || '<p class="muted-line">Aucun test terminé.</p>'}
        </div>
      </details>    </main>
  `
}

function playtestGroupMarkup(title, description, sessions, tone, state, escapeHtml, profileBadgeMarkup) {
  return `
    <section class="playtest-group" data-tone="${escapeHtml(tone)}">
      <header class="playtest-list-head">
        <div><p class="eyebrow">${escapeHtml(title)}</p><div class="playtest-section-title"><h2>${escapeHtml(description)}</h2><span class="playtest-count">${sessions.length}</span></div></div>

      </header>
      <div class="playtest-sessions">
        ${sessions.length
          ? sessions.map((playtest) => playtestCardMarkup(playtest, state, escapeHtml, profileBadgeMarkup)).join('')
          : '<p class="muted-line playtest-group-empty">Aucune session dans cette étape.</p>'}
      </div>
    </section>
  `
}

export function playtestEditorMarkup(session, state, escapeHtml) {
  const phase = state.playtestEditorPhase || 'planning'
  const isReport = phase === 'report'
  const value = (field) => escapeHtml(session?.[field] || '')
  const lines = (field) => escapeHtml((session?.[field] || []).join('\n'))

  return `
    <section class="playtest-editor ${isReport ? 'report-phase' : 'planning-phase'}" aria-label="${isReport ? 'Compte rendu du test' : 'Planifier une session'}">
      <form id="playtest-form">
        <div class="playtest-editor-head">
          <div>
            <p class="eyebrow">${isReport ? escapeHtml(session?.id || '') : 'Préparation'}</p>
            <h2>${isReport ? 'Comment s’est passé le test ?' : session ? `Modifier ${escapeHtml(session.id)}` : 'Planifier une session'}</h2>
          </div>
          <button class="button small" type="button" data-action="playtest-cancel">Annuler</button>
        </div>
        ${isReport ? `
          <div class="playtest-report-context">
            <strong>${escapeHtml(session?.prototype || '')}</strong>
            <span>${escapeHtml(formatShortDate(session?.date))} · ${escapeHtml((session?.participants || []).join(', ') || 'Participants non renseignés')}</span>
            <p>${escapeHtml(session?.scenario || '')}</p>
          </div>
          <div class="playtest-form-grid">
            <label class="field full"><span>Ressenti général</span><textarea name="sentiment" required placeholder="Ce qui s’est passé pendant la session">${value('sentiment')}</textarea></label>
            <label class="field"><span>Apprentissages</span><textarea name="learnings" placeholder="Un constat par ligne">${lines('learnings')}</textarea></label>
            <label class="field"><span>Problèmes observés</span><textarea name="issues" placeholder="Un problème par ligne">${lines('issues')}</textarea></label>
            <label class="field"><span>Décisions</span><textarea name="decisions" placeholder="Une décision par ligne">${lines('decisions')}</textarea></label>
            <label class="field"><span>Prochaines actions</span><textarea name="nextActions" placeholder="Une action par ligne">${lines('nextActions')}</textarea></label>
            <label class="field full"><span>Lien des documents</span><input name="driveUrl" type="url" value="${value('driveUrl')}" placeholder="https://…" /></label>
          </div>
        ` : `
          <div class="playtest-form-grid planning-fields">
            <label class="field"><span>Prototype / version</span><input name="prototype" value="${value('prototype')}" required /></label>
            <label class="field"><span>Date</span><input name="date" type="date" value="${escapeHtml(session?.date || new Date().toISOString().slice(0, 10))}" required /></label>
            <label class="field"><span>Facilitateur</span><select name="facilitatorId">${state.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === (session?.facilitatorId || state.profile.id) ? 'selected' : ''}>${escapeHtml(profile.display_name)}</option>`).join('')}</select></label>
            <label class="field"><span>Participants</span><input name="participants" value="${escapeHtml((session?.participants || []).join(', '))}" placeholder="Prénoms séparés par des virgules" /></label>
            <label class="field full"><span>Objectif du test</span><textarea name="scenario" required placeholder="Ce que cette session doit permettre de vérifier">${value('scenario')}</textarea></label>
          </div>
        `}
        <div class="playtest-editor-actions">
          ${isReport ? `<button class="button" type="button" data-action="playtest-revert" data-playtest-id="${escapeHtml(session?.id || '')}">Repasser en planifiée</button>` : ''}
          <button class="button primary" type="submit">${isReport ? 'Enregistrer le compte rendu' : session ? 'Enregistrer la planification' : 'Planifier la session'}</button>
        </div>
      </form>
    </section>
  `
}
function moduleHeadMarkup({ title, description, escapeHtml }) {
  return `
    <section class="module-head compact-head">
      <div>
        <p class="eyebrow">Données fictives</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="subhead">${escapeHtml(description)}</p>
      </div>
      <div class="module-actions">
        <button class="button" type="button" data-action="module" data-module="backlog">Backlog</button>
        <button class="button primary" type="button" data-action="module" data-module="questions">Question Studio</button>
      </div>
    </section>
  `
}

function ownerMatchesProfile(ticket, profile) {
  return ticket.ownerId === profile.id || ticket.owner === profile.display_name || ticket.owner === profile.username
}

function featureCardMarkup(feature, escapeHtml) {
  return `
    <article class="feature-card">
      <div class="feature-card-head">
        <strong>${escapeHtml(feature.name)}</strong>
        <span>${feature.done}/${feature.total}</span>
      </div>
      <div class="feature-progress" aria-hidden="true"><span style="width: ${feature.percent}%"></span></div>
      <p>${escapeHtml(feature.nextAction || 'Aucune action ouverte.')}</p>
    </article>
  `
}

function ticketRowMarkup(ticket, state, escapeHtml, profileBadgeMarkup) {
  const tags = ticketTags(ticket)
  const description = ticket.description || ticket.objective || 'Description à compléter.'
  return `
    <div class="record-row ticket-row" draggable="true" data-ticket-id="${escapeHtml(ticket.id)}" data-priority="${escapeHtml(ticket.priority)}" tabindex="0">
      <div class="ticket-card-top">
        <span class="ticket-id">${escapeHtml(ticket.id)}</span>
        <b class="ticket-priority ${priorityClass(ticket.priority)}">${escapeHtml(ticket.priority)}</b>
      </div>
      <div class="ticket-main">
        <strong>${escapeHtml(ticket.title)}</strong>
        <p>${escapeHtml(description)}</p>
        ${ticket.attachment?.dataUrl ? `
          <div class="ticket-attachment-preview">
            <img src="${escapeHtml(ticket.attachment.dataUrl)}" alt="${escapeHtml(ticket.attachment.name || ticket.title)}" />
          </div>
        ` : ''}
        <div class="ticket-tags">
          ${tags.map((tag) => `<span class="ticket-tag-chip" style="--tag-primary: ${escapeHtml(tag.primary || '#f4f1ea')}; --tag-secondary: ${escapeHtml(tag.secondary || '#262a31')}">${escapeHtml(tag.name)}</span>`).join('')}
        </div>
      </div>
      <footer class="ticket-footer">
        ${profileBadgeMarkup(ticket.createdById || ticket.ownerId, creatorLabel(ticket, state.profiles))}
        ${ticketSourceMarkup(ticket, escapeHtml, true)}
      </footer>
    </div>
  `
}

function createTicketCardMarkup(status, escapeHtml) {
  return `
    <button class="create-ticket-card" type="button" data-action="new-ticket" data-ticket-status="${escapeHtml(status)}">Créer une tâche</button>
  `
}

function todoItemMarkup(ticket, state, escapeHtml, profileBadgeMarkup) {
  const tags = ticketTags(ticket)
  const description = ticket.description || ticket.objective || 'Description à compléter.'
  return `
    <div class="todo-item" data-priority="${escapeHtml(ticket.priority)}" data-priority-ticket-id="${escapeHtml(ticket.id)}" tabindex="0" role="button">
      <span class="todo-item-body">
        <span class="todo-item-top">
          <strong>${escapeHtml(ticket.title)}</strong>
          <b class="${priorityClass(ticket.priority)}">${escapeHtml(ticket.priority)}</b>
        </span>
        <span class="todo-item-description">${escapeHtml(description)}</span>
        <span class="ticket-tags todo-item-tags">
          ${tags.map((tag) => `<span class="ticket-tag-chip" style="--tag-primary: ${escapeHtml(tag.primary || '#f4f1ea')}; --tag-secondary: ${escapeHtml(tag.secondary || '#262a31')}">${escapeHtml(tag.name)}</span>`).join('')}
        </span>
        <span class="todo-item-footer">
          <span
            class="todo-flow ${state.lastMovedTicketId === ticket.id ? 'settled' : ''}"
            data-ticket-id="${escapeHtml(ticket.id)}"
            data-current-status-index="${BACKLOG_STATUSES.indexOf(ticket.status)}"
            aria-label="Statut : ${escapeHtml(ticket.status)}"
          >
            ${BACKLOG_STATUSES.map((status) => `
              <button
                class="todo-flow-step ${status === ticket.status ? 'active' : ''}"
                type="button"
                data-priority-status-target
                data-ticket-id="${escapeHtml(ticket.id)}"
                data-status="${escapeHtml(status)}"
                aria-pressed="${status === ticket.status}"
                title="${status === ticket.status ? 'Faire glisser horizontalement pour changer le statut' : `Déplacer vers ${escapeHtml(status)}`}"
              >${escapeHtml(status)}</button>
            `).join('')}
          </span>
          <span class="todo-item-meta">
            ${profileBadgeMarkup(ticket.createdById || ticket.ownerId, creatorLabel(ticket, state.profiles))}
            ${ticketSourceMarkup(ticket, escapeHtml)}
          </span>
        </span>
      </span>
    </div>
  `
}

function ticketSourceMarkup(ticket, escapeHtml, compact = false) {
  if (!ticket.source) return ''
  if (compact) return '<span class="ticket-source-name">' + escapeHtml(ticket.source) + '</span>'
  return '<span class="ticket-source-chip"><small>Source</small><span>' + escapeHtml(ticket.source) + '</span></span>'
}

function creatorLabel(ticket, profiles) {
  const creatorId = ticket.createdById || ticket.ownerId
  return profiles.find((profile) => profile.id === creatorId)?.display_name || ticket.owner || 'Non assigné'
}

function ownerLabel(ticket, profiles) {
  return profiles.find((profile) => profile.id === ticket.ownerId)?.display_name || ticket.owner || 'Non assigné'
}

function ticketTags(ticket) {
  if (Array.isArray(ticket.tags)) return ticket.tags
  if (!ticket.tag) return []
  return [{ name: ticket.tag, colorKey: 'white', primary: '#f4f1ea', secondary: '#262a31' }]
}

function featureSummaries(tickets) {
  const features = new Map()
  tickets.forEach((ticket) => {
    const name = ticket.feature || ticket.tag || 'Studio'
    if (!features.has(name)) {
      features.set(name, {
        name,
        total: 0,
        done: 0,
        nextAction: '',
        nextActionWeight: Number.POSITIVE_INFINITY,
      })
    }
    const feature = features.get(name)
    feature.total += 1
    if (ticket.status === 'Terminé') feature.done += 1
    const weight = todoWeight(ticket)
    if (ticket.status !== 'Terminé' && weight < feature.nextActionWeight) {
      feature.nextAction = ticket.title
      feature.nextActionWeight = weight
    }
  })

  return Array.from(features.values()).map((feature) => ({
    ...feature,
    percent: Math.round((feature.done / feature.total) * 100),
  }))
}

function sortTodoTickets(left, right) {
  return todoWeight(left) - todoWeight(right) || left.id.localeCompare(right.id)
}

function todoWeight(ticket) {
  const priority = PRIORITY_WEIGHT[ticket.priority] ?? 9
  const status = STATUS_WEIGHT[ticket.status] ?? 9
  return priority * 10 + status
}

function priorityClass(priority) {
  if (priority === 'Haute') return 'priority-high'
  if (priority === 'Moyenne') return 'priority-medium'
  return 'priority-low'
}

function playtestCardMarkup(playtest, state, escapeHtml, profileBadgeMarkup) {
  const isPlanned = playtest.status === 'Planifiée'
  const needsReport = playtest.status === 'À documenter'
  const isFinished = playtest.status === 'Terminée'
  const linkedTickets = (playtest.relatedTicketIds || [])
    .map((ticketId) => linkedTicketMarkup(ticketId, state.backlog, escapeHtml))
    .join('')

  return `
    <article class="playtest-card" data-status="${escapeHtml(playtest.status)}">
      <header class="playtest-card-head">
        <div>
          <span class="playtest-id">${escapeHtml(playtest.id)} · ${escapeHtml(formatShortDate(playtest.date))}</span>
          <h2>${escapeHtml(playtest.prototype)}</h2>
        </div>
        <span class="playtest-status">${escapeHtml(playtest.status)}</span>
      </header>
      <p class="playtest-scenario">${escapeHtml(playtest.scenario)}</p>
      <dl class="playtest-meta">
        <div><dt>Facilitation</dt><dd>${playtest.facilitatorId ? profileBadgeMarkup(playtest.facilitatorId, '') : 'À définir'}</dd></div>
        <div><dt>Participants</dt><dd>${escapeHtml((playtest.participants || []).join(', ') || 'À définir')}</dd></div>
      </dl>

      ${needsReport ? '<div class="playtest-report-prompt"><strong>Test effectué</strong><span>Le compte rendu reste à compléter.</span></div>' : ''}
      ${isFinished ? `
        ${playtest.sentiment ? `<p class="playtest-sentiment"><b>Ressenti</b>${escapeHtml(playtest.sentiment)}</p>` : ''}
        <div class="playtest-notes">
          ${noteListMarkup('Apprentissages', playtest.learnings, escapeHtml)}
          ${noteListMarkup('Problèmes observés', playtest.issues, escapeHtml)}
          ${noteListMarkup('Décisions', playtest.decisions, escapeHtml)}
        </div>
        <div class="playtest-linked">
          <span>Tickets liés</span>
          <div class="linked-ticket-list">${linkedTickets || '<span class="muted-line">Aucun ticket lié.</span>'}</div>
        </div>
      ` : ''}

      <footer class="playtest-actions">
        ${isPlanned ? `
          <button class="button small" type="button" data-action="playtest-edit-plan" data-playtest-id="${escapeHtml(playtest.id)}">Modifier la planification</button>
          <button class="button small primary" type="button" data-action="playtest-complete" data-playtest-id="${escapeHtml(playtest.id)}">Le test a été fait</button>
        ` : `
          <button class="button small ${needsReport ? 'primary' : ''}" type="button" data-action="playtest-report" data-playtest-id="${escapeHtml(playtest.id)}">${needsReport ? 'Remplir le compte rendu' : 'Modifier le compte rendu'}</button>
        `}
        ${needsReport ? `<button class="button small" type="button" data-action="playtest-revert" data-playtest-id="${escapeHtml(playtest.id)}">Annuler le test effectué</button>` : ''}
        ${isFinished ? `<button class="button small" type="button" data-action="new-playtest-ticket" data-playtest-id="${escapeHtml(playtest.id)}">Créer un ticket lié</button>` : ''}
        ${playtest.driveUrl ? `<a class="button small" href="${escapeHtml(playtest.driveUrl)}" target="_blank" rel="noreferrer">Documents</a>` : ''}
      </footer>
    </article>
  `
}
function playtestSummaryPanel(title, items, escapeHtml) {
  return `
    <article class="playtest-panel">
      <h2>${escapeHtml(title)}</h2>
      ${items.length
        ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '<p class="muted-line">Rien à signaler.</p>'}
    </article>
  `
}

function scoreMarkup(label, value, escapeHtml) {
  const normalized = Number(value) || 0
  return `
    <div class="score-meter">
      <span>${escapeHtml(scoreLabel(label))}</span>
      <b>${value ? `${normalized}/5` : '—'}</b>
      <i><em style="width: ${Math.min(100, normalized * 20)}%"></em></i>
    </div>
  `
}

function noteListMarkup(title, items = [], escapeHtml) {
  return `
    <section>
      <h3>${escapeHtml(title)}</h3>
      ${items.length
        ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '<p class="muted-line">Non renseigné.</p>'}
    </section>
  `
}

function recurringValues(values) {
  const counts = values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

function averagePlaytestScore(sessions) {
  const values = sessions.flatMap((session) =>
    Object.values(session.scores || {}).filter((value) => Number(value) > 0),
  )
  if (!values.length) return null
  return (values.reduce((sum, value) => sum + Number(value), 0) / values.length).toFixed(1)
}

function scoreLabel(label) {
  return {
    rythme: 'Rythme',
    clarte: 'Clarté',
    tension: 'Tension',
    plaisir: 'Plaisir',
  }[label] || label
}

function formatShortDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`))
}
function playtestRowMarkup(playtest, state, escapeHtml, profileBadgeMarkup) {
  return `
    <article class="playtest-card">
      <header class="playtest-card-head">
        <div>
          <span>${escapeHtml(playtest.id)} · ${escapeHtml(playtest.date)}</span>
          <strong>${escapeHtml(playtest.context)}</strong>
        </div>
        <a class="button small" href="${escapeHtml(playtest.driveUrl)}" target="_blank" rel="noreferrer">Drive</a>
      </header>
      <div class="playtest-meta">
        ${playtest.facilitatorId ? profileBadgeMarkup(playtest.facilitatorId, '') : ''}
        <span>${escapeHtml(playtest.location || 'Lieu à préciser')}</span>
        <span>${escapeHtml(playtest.players)}</span>
        <span>${escapeHtml(playtest.duration)}</span>
      </div>
      <p>${escapeHtml(playtest.result)}</p>
      <div class="playtest-section">
        <h3>Apprentissage</h3>
        <p>${escapeHtml(playtest.learning || 'À compléter.')}</p>
      </div>
      <div class="playtest-section">
        <h3>Problèmes</h3>
        <ul>
          ${(playtest.issues || []).map((issue) => `<li>${escapeHtml(issue)}</li>`).join('') || '<li>Aucun problème listé.</li>'}
        </ul>
      </div>
      <div class="playtest-section">
        <h3>Tickets liés</h3>
        <div class="linked-ticket-list">
          ${(playtest.relatedTicketIds || []).map((ticketId) => linkedTicketMarkup(ticketId, state.backlog, escapeHtml)).join('') || '<span class="muted-line">Aucun ticket lié.</span>'}
        </div>
      </div>
      <footer class="playtest-card-footer">
        <span>${escapeHtml(playtest.nextAction || 'Prochaine action à préciser.')}</span>
        <button class="button small" type="button" data-action="new-playtest-ticket" data-playtest-id="${escapeHtml(playtest.id)}">Créer un ticket</button>
      </footer>
    </article>
  `
}

function linkedTicketMarkup(ticketId, backlog, escapeHtml) {
  const ticket = backlog.find((item) => item.id === ticketId)
  return `
    <button class="linked-ticket" type="button" data-action="show-backlog-ticket" data-ticket-id="${escapeHtml(ticketId)}">
      <strong>${escapeHtml(ticketId)}</strong>
      <span>${escapeHtml(ticket?.status || 'Introuvable')}</span>
    </button>
  `
}
