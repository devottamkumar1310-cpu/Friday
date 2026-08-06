/**
 * Golden-set questions — roadmap 2.12, and the seed that makes the practice
 * flow (2.8) exercisable without an API key.
 *
 * Hand-written rather than generated, deliberately: a golden set that came from
 * the model it is meant to grade proves nothing. These are the reference
 * answers the Content Generator's output is scored against, and the cache the
 * practice loop serves from in development.
 *
 * Keyed by canonical concept (ADR-016), so they are shared across every learner
 * exactly as generated questions are.
 */

export interface GoldenQuestion {
  conceptKey: string;
  type: 'mcq_single' | 'true_false' | 'numeric';
  difficulty: number;
  stem: string;
  options?: { id: string; text: string }[];
  correctAnswer: { selected?: string[]; value?: string };
  explanation: string;
}

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  {
    conceptKey: 'physics.mechanics.kinematics-1d',
    type: 'mcq_single',
    difficulty: 3,
    stem: 'A ball is thrown straight up at 20 m/s. Taking g = 10 m/s², how long until it returns to the thrower’s hand?',
    options: [
      { id: 'a', text: '2 s' },
      { id: 'b', text: '4 s' },
      { id: 'c', text: '20 s' },
      { id: 'd', text: '10 s' },
    ],
    correctAnswer: { selected: ['b'] },
    explanation:
      'Time to the top is v/g = 20/10 = 2 s, and the descent is symmetric, so the total is 4 s. Choosing 2 s is the common error — that is only half the flight.',
  },
  {
    conceptKey: 'physics.mechanics.kinematics-1d',
    type: 'mcq_single',
    difficulty: 2,
    stem: 'An object moves with constant velocity. What is its acceleration?',
    options: [
      { id: 'a', text: 'Zero' },
      { id: 'b', text: 'Constant and non-zero' },
      { id: 'c', text: 'Increasing' },
      { id: 'd', text: 'Equal to its velocity' },
    ],
    correctAnswer: { selected: ['a'] },
    explanation:
      'Acceleration is the rate of change of velocity. Constant velocity means no change, so acceleration is exactly zero.',
  },
  {
    conceptKey: 'physics.mechanics.newtons-laws',
    type: 'mcq_single',
    difficulty: 3,
    stem: 'A 2 kg block is pushed with a net force of 6 N. What is its acceleration?',
    options: [
      { id: 'a', text: '3 m/s²' },
      { id: 'b', text: '12 m/s²' },
      { id: 'c', text: '0.33 m/s²' },
      { id: 'd', text: '8 m/s²' },
    ],
    correctAnswer: { selected: ['a'] },
    explanation:
      'F = ma, so a = F/m = 6/2 = 3 m/s². Answering 12 comes from multiplying instead of dividing.',
  },
  {
    conceptKey: 'physics.mechanics.newtons-laws',
    type: 'true_false',
    difficulty: 2,
    stem: 'An object at rest has no forces acting on it.',
    options: [
      { id: 'a', text: 'True' },
      { id: 'b', text: 'False' },
    ],
    correctAnswer: { selected: ['b'] },
    explanation:
      'False — a book on a table has both gravity and the normal force acting on it. What is zero for an object at rest is the *net* force, not each individual force.',
  },
  {
    conceptKey: 'physics.mechanics.work-energy',
    type: 'numeric',
    difficulty: 3,
    stem: 'A 5 kg mass is lifted 4 m at constant speed. Taking g = 10 m/s², how much work is done against gravity, in joules?',
    correctAnswer: { value: '200' },
    explanation:
      'W = mgh = 5 × 10 × 4 = 200 J. At constant speed the kinetic energy does not change, so all the work goes into gravitational potential energy.',
  },
  {
    conceptKey: 'physics.mechanics.torque-angular-momentum',
    type: 'mcq_single',
    difficulty: 4,
    stem: 'A skater pulls their arms in while spinning. Ignoring friction, what happens to their angular velocity and angular momentum?',
    options: [
      { id: 'a', text: 'Both increase' },
      { id: 'b', text: 'Angular velocity increases; angular momentum is unchanged' },
      { id: 'c', text: 'Both are unchanged' },
      { id: 'd', text: 'Angular velocity is unchanged; angular momentum increases' },
    ],
    correctAnswer: { selected: ['b'] },
    explanation:
      'With no external torque, angular momentum L = Iω is conserved. Pulling the arms in reduces I, so ω must rise to keep L constant. Thinking both increase is the classic error — it would create angular momentum from nothing.',
  },
  {
    conceptKey: 'physics.mechanics.angular-momentum-conservation',
    type: 'true_false',
    difficulty: 4,
    stem: 'Angular momentum is conserved in any collision.',
    options: [
      { id: 'a', text: 'True' },
      { id: 'b', text: 'False' },
    ],
    correctAnswer: { selected: ['b'] },
    explanation:
      'False. Angular momentum is conserved only when the net external torque about the chosen axis is zero. This is the condition students most often skip.',
  },
  {
    conceptKey: 'physics.waves.shm',
    type: 'mcq_single',
    difficulty: 3,
    stem: 'For a mass on a spring in simple harmonic motion, where is the speed greatest?',
    options: [
      { id: 'a', text: 'At maximum displacement' },
      { id: 'b', text: 'At the equilibrium position' },
      { id: 'c', text: 'Halfway to maximum displacement' },
      { id: 'd', text: 'The speed is constant' },
    ],
    correctAnswer: { selected: ['b'] },
    explanation:
      'At equilibrium all the energy is kinetic, so the speed peaks there. At maximum displacement the mass is momentarily at rest as it reverses direction.',
  },
];
