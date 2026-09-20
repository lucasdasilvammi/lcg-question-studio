import { activeSession, formatMinutes, patchMinutes } from './worklog.js'

function localDate(value) {
  if (!value) return 'En cours'
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function localDay(value) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function localTime(value) {
  if (!value) return 'en cours'
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function inlineMarkdown(value, escapeHtml) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function markdownMarkup(markdown, escapeHtml) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const output = []
  let paragraph = []
  let listOpen = false

  const closeParagraph = () => {
    if (!paragraph.length) return
    output.push(`<p>${inlineMarkdown(paragraph.join(' '), escapeHtml)}</p>`)
    paragraph = []
  }
  const closeList = () => {
    if (!listOpen) return
    output.push('</ul>')
    listOpen = false
  }

  lines.forEach((line) => {
    const heading = line.match(/^(#{3,6})\s+(.+)$/)
    const bullet = line.match(/^\s*-\s+(.+)$/)
    const quote = line.match(/^>\s?(.*)$/)
    if (!line.trim()) {
      closeParagraph()
      closeList()
      return
    }
    if (heading) {
      closeParagraph()
      closeList()
      const level = Math.min(5, heading[1].length)
      output.push(`<h${level}>${inlineMarkdown(heading[2], escapeHtml)}</h${level}>`)
      return
    }
    if (bullet) {
      closeParagraph()
      if (!listOpen) {
        output.push('<ul>')
        listOpen = true
      }
      output.push(`<li>${inlineMarkdown(bullet[1], escapeHtml)}</li>`)
      return
    }
    if (quote) {
      closeParagraph()
      closeList()
      output.push(`<blockquote>${inlineMarkdown(quote[1], escapeHtml)}</blockquote>`)
      return
    }
    paragraph.push(line.trim())
  })
  closeParagraph()
  closeList()
  return output.join('')
}

function patchMarkdownContent(patch) {
  return patch.contentMarkdown || `## Resume\n\n${patch.summary || 'Aucun résumé renseigné.'}\n\n## Changements\n\n${patch.changes.length ? patch.changes.map((item) => `- ${item}`).join('\n') : '- Aucun changement renseigné.'}`
}

function patchDocumentMarkup(patch, escapeHtml) {
  const markdown = patchMarkdownContent(patch)
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)]
  if (!matches.length) return `<div class="worklog-markdown">${markdownMarkup(markdown, escapeHtml)}</div>`
  const intro = markdown.slice(0, matches[0].index).trim()
  const sections = matches.map((match, index) => ({
    title: match[1].trim(),
    body: markdown.slice(match.index + match[0].length, matches[index + 1]?.index ?? markdown.length).trim(),
  }))
  return `
    ${intro ? `<div class="worklog-markdown worklog-document-intro">${markdownMarkup(intro, escapeHtml)}</div>` : ''}
    <div class="worklog-document-sections">
      ${sections.map((section, index) => {
        const isLong = section.body.length > 520 || section.body.split('\n').length > 10
        if (!isLong || index === 0) return `<section class="worklog-document-section"><h3>${escapeHtml(section.title)}</h3><div class="worklog-markdown">${markdownMarkup(section.body, escapeHtml)}</div></section>`
        return `<details class="worklog-document-section worklog-document-more"><summary><span>${escapeHtml(section.title)}</span><em>Voir plus</em></summary><div class="worklog-markdown">${markdownMarkup(section.body, escapeHtml)}</div></details>`
      }).join('')}
    </div>
  `
}

function sessionMarkup(session, escapeHtml) {
  const duration = session.endedAt ? formatMinutes(patchMinutes({ sessions: [session] })) : 'En cours'
  return `
    <article class="worklog-session-card" title="${escapeHtml(session.startedAt)} — ${escapeHtml(session.endedAt || 'En cours')}">
      <div class="worklog-session-time">
        <span>${escapeHtml(localDay(session.startedAt))}</span>
        <b>${escapeHtml(localTime(session.startedAt))} → ${escapeHtml(localTime(session.endedAt))}</b>
        <strong>${escapeHtml(duration)}</strong>
      </div>
      <p>${escapeHtml(session.description || 'Objet de la session non renseigné.')}</p>
    </article>
  `
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
  const editing = selected && state.worklogEditingId === selected.id
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
              <button class="button small" type="button" data-action="${editing ? 'worklog-cancel-edit' : 'worklog-edit'}">${editing ? 'Annuler la modification' : 'Modifier le patch'}</button>
              <button class="button small" type="button" data-action="worklog-link-file">${state.worklogFileId === selected.id ? 'Actualiser le fichier .md' : 'Créer le fichier .md'}</button>
              <button class="button small" type="button" data-action="worklog-export">Télécharger .md</button>
              ${selected.status !== 'released' ? '<button class="button small" type="button" data-action="worklog-close">Clore le patch</button>' : ''}
            </div>
            ${running ? `<p class="worklog-running">Session ouverte le ${escapeHtml(localDate(running.startedAt))} · <strong data-worklog-timer data-start="${escapeHtml(running.startedAt)}">${escapeHtml(formatMinutes(patchMinutes({ sessions: [running] }, new Date().toISOString())))}</strong></p>` : ''}
            ${editing ? `
              <form id="worklog-patch-notes" class="worklog-patch-notes worklog-patch-editor">
                <label class="field"><span>Contenu du patch · Markdown</span><textarea name="contentMarkdown" placeholder="## Résumé\n\nDescription du patch…">${escapeHtml(patchMarkdownContent(selected))}</textarea></label>
                <label class="field"><span>Notes complémentaires des sessions · Markdown</span><textarea name="sessionNotesMarkdown" placeholder="Contexte, répartition du temps, précisions…">${escapeHtml(selected.sessionNotesMarkdown || '')}</textarea></label>
                ${selected.sessions.length ? `<fieldset><legend>Objet des sessions</legend>${selected.sessions.map((session, index) => `<label class="field"><span>${escapeHtml(localDay(session.startedAt))} · ${escapeHtml(localTime(session.startedAt))}</span><input name="sessionDescription-${index}" value="${escapeHtml(session.description || '')}" placeholder="Objet synthétique de la session" /></label>`).join('')}</fieldset>` : ''}
                <div class="worklog-editor-actions"><button class="button small" type="button" data-action="worklog-cancel-edit">Annuler</button><button class="button small primary" type="submit">Enregistrer les modifications</button></div>
              </form>
            ` : `<article class="worklog-patch-reader">${patchDocumentMarkup(selected, escapeHtml)}</article>`}
            <details class="worklog-session-list">
              <summary class="section-title"><span>Sessions</span><em>${selected.sessions.length} · ${escapeHtml(formatMinutes(patchMinutes(selected)))}</em></summary>
              <div class="worklog-session-content">
                ${selected.sessions.length ? `<div class="worklog-session-cards">${selected.sessions.map((session) => sessionMarkup(session, escapeHtml)).join('')}</div>` : '<p class="muted-line">Aucune session enregistrée.</p>'}
                ${selected.sessionNotesMarkdown ? `<div class="worklog-session-notes worklog-markdown">${markdownMarkup(selected.sessionNotesMarkdown, escapeHtml)}</div>` : ''}
              </div>
            </details>
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
