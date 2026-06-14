import { approvedChallengeQuestions } from './approvedChallenges.js'
import { catalogQuestions } from './catalogQuestions.js'

export const initialQuestions = [
  ...catalogQuestions.filter((question) => question.mode === 'Quiz'),
  ...approvedChallengeQuestions,
].map((question) => ({
  ...question,
  status: 'pending',
  approvals: [],
}))
