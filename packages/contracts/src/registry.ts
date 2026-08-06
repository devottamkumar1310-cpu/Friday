import { type z } from './zod';
import {
  SignInRequestSchema,
  SignInResponseSchema,
  SignOutResponseSchema,
  SignUpRequestSchema,
  SignUpResponseSchema,
} from './schemas/auth';
import {
  ConsentResponseSchema,
  MeResponseSchema,
  RecordConsentRequestSchema,
  UpdateMeRequestSchema,
} from './schemas/me';
import {
  ConceptResponseSchema,
  CreateGoalRequestSchema,
  CreateGoalResponseSchema,
  CurriculumTemplateListResponseSchema,
  GoalListResponseSchema,
  GoalResponseSchema,
  GraphResponseSchema,
  UpdateConceptStatusRequestSchema,
} from './schemas/goals';
import {
  FeasibilityResponseSchema,
  PlanListResponseSchema,
  PlanResponseSchema,
  RegeneratePlanRequestSchema,
  RegeneratePlanResponseSchema,
  ScheduleResponseSchema,
} from './schemas/planning';
import { NextActionResponseSchema, SkipActionRequestSchema } from './schemas/next-action';
import {
  CompleteSessionRequestSchema,
  CompleteSessionResponseSchema,
  StartSessionRequestSchema,
  StartSessionResponseSchema,
} from './schemas/execution';
import { MissionControlResponseSchema } from './schemas/mission-control';
import {
  InsightsResponseSchema,
  ProgressResponseSchema,
  TrendsResponseSchema,
  WeakConceptsResponseSchema,
} from './schemas/intelligence';
import {
  CreatePracticeSetRequestSchema,
  PracticeSetResponseSchema,
  ReportQuestionResponseSchema,
  SubmitAttemptResponseSchema,
  SubmitResponseRequestSchema,
  SubmitResponseResponseSchema,
} from './schemas/assessment';
import {
  CoachThreadDetailResponseSchema,
  CoachThreadListResponseSchema,
  CoachThreadResponseSchema,
  CreateThreadRequestSchema,
  SendCoachMessageRequestSchema,
} from './schemas/coach';
import {
  AvailabilityResponseSchema,
  PreferencesResponseSchema,
  SetAvailabilityRequestSchema,
  UpdatePreferencesRequestSchema,
} from './schemas/me-settings';
import {
  AbandonSessionResponseSchema,
  SessionDetailResponseSchema,
  SessionListResponseSchema,
  StudyTaskResponseSchema,
  TaskListResponseSchema,
  TaskResponseSchema,
  UpdateTaskRequestSchema,
} from './schemas/sessions';
import {
  DeleteFactResponseSchema,
  DueReviewsResponseSchema,
  LearnerFactResponseSchema,
  LearnerFactsResponseSchema,
  MasteryListResponseSchema,
  UpdateFactRequestSchema,
} from './schemas/memory';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface EndpointDef {
  readonly method: HttpMethod;
  /** Path relative to the version prefix, e.g. '/me'. */
  readonly path: string;
  readonly summary: string;
  readonly tags: readonly string[];
  /** Whether a valid session cookie is required. */
  readonly auth: boolean;
  readonly body?: z.ZodTypeAny;
  readonly response: z.ZodTypeAny;
  readonly status: number;
}

/**
 * The single declaration of every v1 endpoint.
 *
 * `openapi.ts` renders this to openapi.v1.json; `client.ts` derives a typed
 * client from it. Because both read the same object, the published contract and
 * the client cannot disagree — which is the point of AP2.
 *
 * Phase 0 covers auth and identity only. Later phases append here.
 */
export const ENDPOINTS = {
  signUp: {
    method: 'POST',
    path: '/auth/sign-up',
    summary: 'Create an account',
    tags: ['Auth'],
    auth: false,
    body: SignUpRequestSchema,
    response: SignUpResponseSchema,
    status: 201,
  },
  signIn: {
    method: 'POST',
    path: '/auth/sign-in',
    summary: 'Sign in with email and password',
    tags: ['Auth'],
    auth: false,
    body: SignInRequestSchema,
    response: SignInResponseSchema,
    status: 200,
  },
  signOut: {
    method: 'POST',
    path: '/auth/sign-out',
    summary: 'Revoke the current session',
    tags: ['Auth'],
    auth: true,
    response: SignOutResponseSchema,
    status: 200,
  },
  getMe: {
    method: 'GET',
    path: '/me',
    summary: 'Current user, onboarding state, and active goal summary',
    tags: ['Me'],
    auth: true,
    response: MeResponseSchema,
    status: 200,
  },
  updateMe: {
    method: 'PATCH',
    path: '/me',
    summary: 'Update profile fields',
    tags: ['Me'],
    auth: true,
    body: UpdateMeRequestSchema,
    response: MeResponseSchema,
    status: 200,
  },
  recordConsent: {
    method: 'POST',
    path: '/me/consents',
    summary: 'Record a consent grant',
    tags: ['Me'],
    auth: true,
    body: RecordConsentRequestSchema,
    response: ConsentResponseSchema,
    status: 201,
  },

  // --- Phase 1: The Spine -------------------------------------------------

  listCurriculumTemplates: {
    method: 'GET',
    path: '/curriculum/templates',
    summary: 'List published curriculum templates',
    tags: ['Curriculum'],
    auth: true,
    response: CurriculumTemplateListResponseSchema,
    status: 200,
  },
  createGoal: {
    method: 'POST',
    path: '/goals',
    summary: 'Create a goal from a curated template and generate the initial plan',
    tags: ['Goals'],
    auth: true,
    body: CreateGoalRequestSchema,
    response: CreateGoalResponseSchema,
    status: 201,
  },
  listGoals: {
    method: 'GET',
    path: '/goals',
    summary: 'List goals for the current user',
    tags: ['Goals'],
    auth: true,
    response: GoalListResponseSchema,
    status: 200,
  },
  getGoal: {
    method: 'GET',
    path: '/goals/{goalId}',
    summary: 'Goal detail',
    tags: ['Goals'],
    auth: true,
    response: GoalResponseSchema,
    status: 200,
  },
  getGoalFeasibility: {
    method: 'GET',
    path: '/goals/{goalId}/feasibility',
    summary: 'Current feasibility verdict and arithmetic',
    tags: ['Goals'],
    auth: true,
    response: FeasibilityResponseSchema,
    status: 200,
  },
  getGoalGraph: {
    method: 'GET',
    path: '/goals/{goalId}/graph',
    summary: 'Knowledge graph — nodes, edges, mastery',
    tags: ['Curriculum'],
    auth: true,
    response: GraphResponseSchema,
    status: 200,
  },
  updateConceptStatus: {
    method: 'PATCH',
    path: '/concepts/{conceptId}',
    summary: 'Mark a concept excluded / already_known / status change',
    tags: ['Curriculum'],
    auth: true,
    body: UpdateConceptStatusRequestSchema,
    response: ConceptResponseSchema,
    status: 200,
  },
  listPlans: {
    method: 'GET',
    path: '/goals/{goalId}/plans',
    summary: 'Plan version history',
    tags: ['Planning'],
    auth: true,
    response: PlanListResponseSchema,
    status: 200,
  },
  getCurrentPlan: {
    method: 'GET',
    path: '/goals/{goalId}/plans/current',
    summary: 'The active plan',
    tags: ['Planning'],
    auth: true,
    response: PlanResponseSchema,
    status: 200,
  },
  regeneratePlan: {
    method: 'POST',
    path: '/goals/{goalId}/plans/regenerate',
    summary: 'Manually trigger a re-plan (M0: manual trigger only)',
    tags: ['Planning'],
    auth: true,
    body: RegeneratePlanRequestSchema,
    response: RegeneratePlanResponseSchema,
    status: 200,
  },
  getSchedule: {
    method: 'GET',
    path: '/goals/{goalId}/schedule',
    summary: "Blocks + tasks in the plan's materialised window, plus the projection beyond it",
    tags: ['Planning'],
    auth: true,
    response: ScheduleResponseSchema,
    status: 200,
  },
  getNextAction: {
    method: 'GET',
    path: '/goals/{goalId}/next-action',
    summary: 'The single next recommendation — the hot path (NFR-1.7, no LLM)',
    tags: ['NextAction'],
    auth: true,
    response: NextActionResponseSchema,
    status: 200,
  },
  skipNextAction: {
    method: 'POST',
    path: '/goals/{goalId}/next-action/skip',
    summary: 'Record a skip and return the next candidate',
    tags: ['NextAction'],
    auth: true,
    body: SkipActionRequestSchema,
    response: NextActionResponseSchema,
    status: 200,
  },
  getMissionControl: {
    method: 'GET',
    path: '/goals/{goalId}/mission-control',
    summary: "Today's Mission, Next Action, Progress, Risks, and rationale in one response",
    tags: ['MissionControl'],
    auth: true,
    response: MissionControlResponseSchema,
    status: 200,
  },
  startSession: {
    method: 'POST',
    path: '/sessions',
    summary: 'Start a study session',
    tags: ['Execution'],
    auth: true,
    body: StartSessionRequestSchema,
    response: StartSessionResponseSchema,
    status: 201,
  },
  completeSession: {
    method: 'POST',
    path: '/sessions/{sessionId}/complete',
    summary: 'Complete a session: evidence -> mastery + retention update, in one transaction',
    tags: ['Execution'],
    auth: true,
    body: CompleteSessionRequestSchema,
    response: CompleteSessionResponseSchema,
    status: 200,
  },

  // --- Phase 2: Intelligence Layer ----------------------------------------

  getProgress: {
    method: 'GET',
    path: '/intelligence/progress',
    summary: 'Weighted progress, verdict, velocity, retention health, adherence',
    tags: ['Intelligence'],
    auth: true,
    response: ProgressResponseSchema,
    status: 200,
  },
  getWeakConcepts: {
    method: 'GET',
    path: '/intelligence/weak-concepts',
    summary: 'Weak concepts ranked by exam-weighted gap, with evidence drill-down',
    tags: ['Intelligence'],
    auth: true,
    response: WeakConceptsResponseSchema,
    status: 200,
  },
  getTrends: {
    method: 'GET',
    path: '/intelligence/trends',
    summary: 'Progress time series from daily snapshots',
    tags: ['Intelligence'],
    auth: true,
    response: TrendsResponseSchema,
    status: 200,
  },
  getInsights: {
    method: 'GET',
    path: '/intelligence/insights',
    summary: 'Generated findings, each carrying its own evidence',
    tags: ['Intelligence'],
    auth: true,
    response: InsightsResponseSchema,
    status: 200,
  },

  createPracticeSet: {
    method: 'POST',
    path: '/assessments',
    summary: 'Create a practice set, served from the shared question cache where possible',
    tags: ['Assessment'],
    auth: true,
    body: CreatePracticeSetRequestSchema,
    response: PracticeSetResponseSchema,
    status: 201,
  },
  submitResponse: {
    method: 'POST',
    path: '/attempts/{attemptId}/responses',
    summary: 'Submit one answer; graded deterministically and returned with its explanation',
    tags: ['Assessment'],
    auth: true,
    body: SubmitResponseRequestSchema,
    response: SubmitResponseResponseSchema,
    status: 200,
  },
  submitAttempt: {
    method: 'POST',
    path: '/attempts/{attemptId}/submit',
    summary: 'Finalise an attempt: score it, then update mastery and retention from the evidence',
    tags: ['Assessment'],
    auth: true,
    response: SubmitAttemptResponseSchema,
    status: 200,
  },
  reportQuestion: {
    method: 'POST',
    path: '/questions/{questionId}/report',
    summary: 'Flag a bad question; repeated reports quarantine it',
    tags: ['Assessment'],
    auth: true,
    response: ReportQuestionResponseSchema,
    status: 200,
  },

  listCoachThreads: {
    method: 'GET',
    path: '/coach/threads',
    summary: 'List conversation threads',
    tags: ['Coach'],
    auth: true,
    response: CoachThreadListResponseSchema,
    status: 200,
  },
  createCoachThread: {
    method: 'POST',
    path: '/coach/threads',
    summary: 'Start a conversation thread',
    tags: ['Coach'],
    auth: true,
    body: CreateThreadRequestSchema,
    response: CoachThreadResponseSchema,
    status: 201,
  },
  getCoachThread: {
    method: 'GET',
    path: '/coach/threads/{threadId}',
    summary: 'Thread with its messages',
    tags: ['Coach'],
    auth: true,
    response: CoachThreadDetailResponseSchema,
    status: 200,
  },
  sendCoachMessage: {
    method: 'POST',
    path: '/coach/threads/{threadId}/messages',
    summary: 'Send a message — responds as an SSE stream, not JSON',
    tags: ['Coach'],
    auth: true,
    body: SendCoachMessageRequestSchema,
    response: CoachThreadResponseSchema,
    status: 200,
  },

  listMasteryStates: {
    method: 'GET',
    path: '/memory/mastery',
    summary: 'Per-concept mastery, weakest first',
    tags: ['Memory'],
    auth: true,
    response: MasteryListResponseSchema,
    status: 200,
  },
  listDueReviews: {
    method: 'GET',
    path: '/memory/due',
    summary: 'Concepts due for review, by due date',
    tags: ['Memory'],
    auth: true,
    response: DueReviewsResponseSchema,
    status: 200,
  },
  listFacts: {
    method: 'GET',
    path: '/memory/facts',
    summary: 'What FRIDAY believes about you, each with its evidence',
    tags: ['Memory'],
    auth: true,
    response: LearnerFactsResponseSchema,
    status: 200,
  },
  updateFact: {
    method: 'PATCH',
    path: '/memory/facts/{factId}',
    summary: 'Correct a belief',
    tags: ['Memory'],
    auth: true,
    body: UpdateFactRequestSchema,
    response: LearnerFactResponseSchema,
    status: 200,
  },
  deleteFact: {
    method: 'DELETE',
    path: '/memory/facts/{factId}',
    summary: 'Delete a belief — honoured immediately',
    tags: ['Memory'],
    auth: true,
    response: DeleteFactResponseSchema,
    status: 200,
  },

  // --- Phase 3: surfaces the UI needs -------------------------------------

  getAvailability: {
    method: 'GET',
    path: '/me/availability',
    summary: 'Weekly availability rules and the weekly minutes they total',
    tags: ['Me'],
    auth: true,
    response: AvailabilityResponseSchema,
    status: 200,
  },
  setAvailability: {
    method: 'PUT',
    path: '/me/availability',
    summary: 'Replace the availability set; triggers a re-plan when material',
    tags: ['Me'],
    auth: true,
    body: SetAvailabilityRequestSchema,
    response: AvailabilityResponseSchema,
    status: 200,
  },
  getPreferences: {
    method: 'GET',
    path: '/me/preferences',
    summary: 'Quiet hours, notification channels, theme',
    tags: ['Me'],
    auth: true,
    response: PreferencesResponseSchema,
    status: 200,
  },
  updatePreferences: {
    method: 'PATCH',
    path: '/me/preferences',
    summary: 'Update preferences',
    tags: ['Me'],
    auth: true,
    body: UpdatePreferencesRequestSchema,
    response: PreferencesResponseSchema,
    status: 200,
  },
  listSessions: {
    method: 'GET',
    path: '/sessions',
    summary: 'Session history, most recent first',
    tags: ['Execution'],
    auth: true,
    response: SessionListResponseSchema,
    status: 200,
  },
  getSession: {
    method: 'GET',
    path: '/sessions/{sessionId}',
    summary: 'Session detail',
    tags: ['Execution'],
    auth: true,
    response: SessionDetailResponseSchema,
    status: 200,
  },
  abandonSession: {
    method: 'POST',
    path: '/sessions/{sessionId}/abandon',
    summary: 'Abandon a session; records no evidence (E-16)',
    tags: ['Execution'],
    auth: true,
    response: AbandonSessionResponseSchema,
    status: 200,
  },
  listTasks: {
    method: 'GET',
    path: '/tasks',
    summary: 'Tasks, filterable by goal, date, and status',
    tags: ['Planning'],
    auth: true,
    response: TaskListResponseSchema,
    status: 200,
  },
  getStudyTask: {
    method: 'GET',
    path: '/tasks/{taskId}/study',
    summary: 'Everything the study screen needs for one task, in one request',
    tags: ['Planning'],
    auth: true,
    response: StudyTaskResponseSchema,
    status: 200,
  },
  updateTask: {
    method: 'PATCH',
    path: '/tasks/{taskId}',
    summary: 'Update task status, schedule, or skip reason',
    tags: ['Planning'],
    auth: true,
    body: UpdateTaskRequestSchema,
    response: TaskResponseSchema,
    status: 200,
  },
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof ENDPOINTS;

export type RequestBodyOf<K extends EndpointName> = (typeof ENDPOINTS)[K] extends {
  body: infer B extends z.ZodTypeAny;
}
  ? z.infer<B>
  : never;

export type ResponseOf<K extends EndpointName> = z.infer<(typeof ENDPOINTS)[K]['response']>;

/** Endpoint names that carry a request body. */
export type EndpointWithBody = {
  [K in EndpointName]: (typeof ENDPOINTS)[K] extends { body: z.ZodTypeAny } ? K : never;
}[EndpointName];

export type EndpointWithoutBody = Exclude<EndpointName, EndpointWithBody>;

export const API_VERSION = 'v1' as const;
export const API_PREFIX = `/api/${API_VERSION}` as const;
