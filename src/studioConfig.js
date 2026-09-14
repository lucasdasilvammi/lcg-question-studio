export const STORAGE_KEYS = {
  questionView: 'lcg-question-studio-view-v2',
  sidebarCollapsed: 'lcg-studio-sidebar-collapsed-v1',
  backlog: 'lcg-studio-backlog-v1',
  profiles: 'lcg-studio-profiles-v1',
  backlogColumns: 'lcg-studio-backlog-columns-v1',
  backlogView: 'lcg-studio-backlog-view-v1',
  backlogTags: 'lcg-studio-backlog-tags-v4',
  ideas: 'lcg-studio-ideas-v1',
  playtests: 'lcg-studio-playtests-v1',
}

export const BACKLOG_STATUSES = ['Backlog', 'À faire', 'En cours', 'À tester', 'Terminé']
export const BACKLOG_PRIORITIES = ['Haute', 'Moyenne', 'Basse']
export const BACKLOG_SOURCES = ['Sheet POC vs V1', 'Test Iz & Val', 'Moi', 'Codex']
export const DEFAULT_BACKLOG_TAGS = [
  { name: 'App', colorKey: 'blue' },
  { name: 'Questions / Contenu', colorKey: 'red' },
  { name: 'Test Utilisateur', colorKey: 'purple' },
  { name: 'Graphisme', colorKey: 'darkblue' },
  { name: 'UI/UX', colorKey: 'orange' },
  { name: 'Features', colorKey: 'pink' },
  { name: 'Gameplay', colorKey: 'green' },
  { name: 'Plateau', colorKey: 'yellow' },
]
export const FEATURE_AREAS = [
  'Backlog / Kanban',
  'Playtests',
  'Comptes',
  'Question Studio',
  'Worklog',
  'Mock data',
  'Navigation / UI',
]

export const USER_AVATARS = [
  { id: 'compo', label: 'Composition', icon: '/assets/icons/compo.svg' },
  { id: 'couleur', label: 'Couleur', icon: '/assets/icons/couleur.svg' },
  { id: 'couronne', label: 'Couronne', icon: '/assets/icons/couronne.svg' },
  { id: 'logo', label: 'Logo', icon: '/assets/icons/logo.svg' },
]

export const USER_COLORS = [
  { id: 'blue', label: 'blue-primary', primary: '#06C0F9', secondary: '#0D3C4A' },
  { id: 'red', label: 'red-primary', primary: '#F63609', secondary: '#3F150B' },
  { id: 'purple', label: 'purple-primary', primary: '#9D0AFF', secondary: '#260A3A' },
  { id: 'darkblue', label: 'darkblue-primary', primary: '#1C51FF', secondary: '#0C173C' },
  { id: 'orange', label: 'orange-primary', primary: '#FF8A04', secondary: '#4C2E0D' },
  { id: 'pink', label: 'pink-primary', primary: '#FF37A5', secondary: '#4C1A35' },
  { id: 'green', label: 'green-primary', primary: '#20CA4B', secondary: '#143E1F' },
  { id: 'yellow', label: 'yellow-primary', primary: '#FFC400', secondary: '#4C3E0F' },
  { id: 'toxic', label: 'toxic-primary', primary: '#99E316', secondary: '#2D3D11' },
]

export const MODULES = [
  { id: 'backlog', label: 'Backlog', short: 'BK', icon: '/assets/icons/backlog.png', description: 'Tickets communs, priorites et kanban.', status: 'mock' },
  { id: 'ideas', label: 'Idées', short: 'ID', icon: '/assets/icons/idee.png', description: 'Notes libres et pistes à explorer.', status: 'mock' },
  { id: 'questions', label: 'Question Studio', short: 'QS', icon: '/assets/icons/question.png', description: 'Questions, validations et exports JSON.', status: 'active' },
  { id: 'playtests', label: 'Playtests', short: 'PT', icon: '/assets/icons/test-utilisateur.png', description: 'Sessions de tests et retours joueurs.', status: 'mock' },
  { id: 'worklog', label: 'Worklog', short: 'WL', icon: '/assets/icons/worklog.png', description: 'Historique des patchs et decisions.', status: 'mock' },
]

export const DIFFICULTIES = ['Pour les nuls', 'Facile', 'Moyen', 'Difficile', 'Expert']

export const DIFFICULTY_BY_MILESTONE = {
  1: 'Pour les nuls',
  2: 'Facile',
  3: 'Moyen',
  4: 'Difficile',
  5: 'Expert',
}

export const GAME_MODES = ['Quiz', 'Défi']

export const CATEGORIES = [
  'Culture graphique',
  'Signe et couleur',
  'Typographie',
  'Logo',
  'Composition',
  'Production',
]

export const CHALLENGES = ['Buzzer', 'Vrai/Faux', 'Chiffres']

export const STATUS_ORDER = { pending: 0, review: 1, approved: 2, validated: 3 }

export const STATUS_LABELS = {
  pending: 'En attente',
  review: 'En révision',
  approved: 'Une validation',
  validated: 'Validée',
}


export const CATEGORY_ASSETS = {
  'Culture graphique': 'culture',
  'Signe et couleur': 'couleur',
  Typographie: 'typo',
  Logo: 'logo',
  Composition: 'compo',
  Production: 'prod',
}

export const CHALLENGE_ASSETS = {
  Buzzer: 'buzzer',
  'Vrai/Faux': 'vraioufaux',
  Chiffres: 'chiffres',
}

export const AUTH_EMAILS = {
  lucas: 'lucas@lcg-question-studio.app',
  awen: 'awen@lcg-question-studio.app',
}
