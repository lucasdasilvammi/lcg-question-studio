import { activeSession, formatMinutes, patchMinutes } from './worklog.js'

function localDate(value) {
  if (!value) return 'En cours'
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function worklogContextMarkup(state, escapeHtml) {
  const tracked = state.worklogPatches.reduce((sum, patch) => sum + patchMinutes(patch), 0)
  const active = state.worklogPatches.filter((patch) => activeSession(patch)).length
  return `
    <section class="nav-context" aria-label="Contexte Worklog">
      <div class="nav-context-divider"></div>
      <p class="nav-context-label">Worklog</p>
      <div class="nav-context-list">
        <div class="nav-context-stat"><span>Patchs</span><strong>${state.worklogPatches.length}</strong></div>
        <div class="nav-context-stat"><span>Session en cours</span><strong>${active}</strong></div>
        <div class="nav-context-stat"><span>Temps mesuré</span><strong>${escapeHtml(formatMinutes(tracked))}</strong></div>
      </div>
    </section>
  `
}

export function worklogViewMarkup(state, escapeHtml) {
  const patches = [...state.worklogPatches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const selected = patches.find((patch) => patch.id === state.worklogSelectedId) || patches[0]
  const tracked = patches.reduce((sum, patch) => sum + patchMinutes(patch), 0)
  const running = selected ? activeSession(selected) : null
  return `
    <main class="module-screen worklog-screen worklog-patches">
      <section class="module-head compact-head worklog-head">
        <div>
          <p class="eyebrow">Journal de production</p>
          <h1>Worklog</h1>
          <p class="subhead">Versions, changements et temps de travail depuis le POC.</p>
        </div>
        <div class="worklog-totals" aria-label="Temps de production">
          <span><small>Depuis le POC</small><b>${escapeHtml(formatMinutes(tracked))}</b></span>
        </div>
      </section>

      <div class="worklog-patch-layout">
        <aside class="worklog-patch-sidebar">
          <div class="worklog-patch-import">
            <button class="button small primary" type="button" data-action="worklog-create">Créer un patch</button>
            <button class="button small" type="button" data-action="worklog-open-file">Importer un .md</button>
            <input id="worklog-import-input" type="file" accept=".md,text/markdown" hidden />
          </div>
          <div class="worklog-patch-index">
            <h2>Versions</h2>
            ${patches.length ? patches.map((patch) => `
              <button class="worklog-patch-link ${patch.id === selected?.id ? 'active' : ''}" type="button" data-action="worklog-select" data-id="${escapeHtml(patch.id)}">
                <span><strong>${escapeHtml(patch.version)}</strong><small>${patch.status === 'released' ? 'Clos' : activeSession(patch) ? 'Session en cours' : 'En cours'}</small></span>
                <span>${escapeHtml(patch.title)}</span>
                <em>${escapeHtml(formatMinutes(patchMinutes(patch)))}</em>
              </button>
            `).join('') : '<p class="muted-line">Aucun patch pour le moment.</p>'}
          </div>
        </aside>

        <section class="worklog-patch-main" aria-label="Patch selectionne">
          ${selected ? `
            <header class="worklog-patch-head">
              <div><p class="eyebrow">${selected.status === 'released' ? 'Patch clos' : 'Patch en cours'}</p><h2>${escapeHtml(selected.version)} <span>${escapeHtml(selected.title)}</span></h2></div>
              <span class="worklog-file-state">${state.worklogFileId === selected.id ? 'Fichier de suivi lié' : 'Sauvegarde locale'}</span>
            </header>
            <div class="worklog-patch-actions">
              ${selected.status === 'released'
                ? `<button class="button small" type="button" data-action="worklog-reopen">Rouvrir le patch</button>`
                : running
                  ? `<button class="button primary" type="button" data-action="worklog-end">Fin de session</button>`
                  : `<button class="button primary" type="button" data-action="worklog-start">Début de session</button>`}
              <button class="button small" type="button" data-action="worklog-link-file">${state.worklogFileId === selected.id ? 'Actualiser le fichier .md' : 'Créer le fichier .md'}</button>
              <button class="button small" type="button" data-action="worklog-export">Télécharger .md</button>
              ${selected.status !== 'released' ? '<button class="button small" type="button" data-action="worklog-close">Clore le patch</button>' : ''}
            </div>
            ${running ? `<p class="worklog-running">Session ouverte le ${escapeHtml(localDate(running.startedAt))} · <strong data-worklog-timer data-start="${escapeHtml(running.startedAt)}">${escapeHtml(formatMinutes(patchMinutes({ sessions: [running] }, new Date().toISOString())))}</strong></p>` : ''}
            <form id="worklog-patch-notes" class="worklog-patch-notes">
              <label class="field"><span>Résumé du patch</span><textarea name="summary" placeholder="Ce qui a change dans cette version">${escapeHtml(selected.summary)}</textarea></label>
              <label class="field"><span>Changements</span><textarea name="changes" placeholder="Un changement par ligne">${escapeHtml(selected.changes.join('\n'))}</textarea></label>
              <button class="button small" type="submit">Enregistrer le contenu</button>
            </form>
            <section class="worklog-session-list">
              <div class="section-title"><span>Sessions</span><em>${selected.sessions.length} · ${escapeHtml(formatMinutes(patchMinutes(selected)))}</em></div>
              ${selected.sessions.length ? `<div class="worklog-session-table"><div class="worklog-session-heading"><span>Début</span><span>Fin</span><span>Durée</span></div>${selected.sessions.map((session) => `<div class="worklog-session-row"><span>${escapeHtml(localDate(session.startedAt))}</span><span>${escapeHtml(localDate(session.endedAt))}</span><strong>${session.endedAt ? escapeHtml(formatMinutes(patchMinutes({ sessions: [session] }))) : 'En cours'}</strong></div>`).join('')}</div>` : '<p class="muted-line">Aucune session enregistrée.</p>'}
            </section>
          ` : '<div class="worklog-patch-empty"><h2>Aucun patch sélectionné</h2><p>Crée un patch ou importe un fichier Markdown existant.</p></div>'}
        </section>
      </div>
    </main>
  `
}

export function worklogCreateModalMarkup() {
  return `
    <div class="modal-backdrop" data-close-modal>
      <div class="modal narrow worklog-create-modal">
        <div class="modal-head">
          <div><p class="eyebrow">Nouvelle version</p><h2>Créer un patch</h2></div>
          <button class="close" type="button" data-action="close-modal">×</button>
        </div>
        <form id="worklog-patch-create" class="worklog-patch-create">
          <label class="field"><span>Version</span><input name="version" required pattern="[0-9]+\\.[0-9]+\\.[0-9]+" placeholder="0.1.0" /></label>
          <label class="field"><span>Nom du patch</span><input name="title" required placeholder="Navigation et Playtests" /></label>
          <p class="worklog-template-help">Le modèle contient la structure attendue pour les résumés, changements et sessions.</p>
          <a class="button" href="/templates/worklog-patch-template.md" download>Télécharger le modèle .md</a>
          <div class="modal-actions">
            <button class="button" type="button" data-action="close-modal">Annuler</button>
            <button class="button primary" type="submit">Créer le patch</button>
          </div>
        </form>
      </div>
    </div>
  `
}