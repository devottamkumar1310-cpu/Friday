/**
 * Curated preset — roadmap 1.8: "canonical_concepts vocabulary seed + curated
 * presets". A deliberately small, real prerequisite graph (JEE Main Physics:
 * Mechanics + Waves foundations) — enough depth to exercise readiness,
 * leverage, urgency, and decay risk meaningfully, per the Shipathon demo cut
 * of "2 curriculum templates, not 20" (IMPLEMENTATION_ROADMAP §6.3). Phase 1
 * ships one; a second is additive, not structural.
 *
 * `key` is the template-local identifier edges reference; `conceptKey` is the
 * canonical vocabulary key concepts resolve to (DATABASE_DESIGN §4.2) — the
 * bridge that lets generated content be cached across every learner who takes
 * this template.
 */

import type { CurriculumTemplateTree, TemplateConcept } from '../schema/curriculum';

export type { CurriculumTemplateTree, TemplateConcept } from '../schema/curriculum';

export const JEE_PHYSICS_FOUNDATIONS_SLUG = 'jee-physics-foundations';

export const JEE_PHYSICS_FOUNDATIONS_TREE: CurriculumTemplateTree = {
  subjects: [
    {
      title: 'Physics',
      position: 0,
      weight: 1.0,
      units: [
        {
          title: 'Mechanics',
          position: 0,
          weight: 1.0,
          topics: [
            {
              title: 'Kinematics',
              position: 0,
              weight: 1.0,
              concepts: [
                {
                  key: 'kinematics-1d',
                  conceptKey: 'physics.mechanics.kinematics-1d',
                  title: 'Kinematics in One Dimension',
                  examWeight: 0.5,
                  estimatedMinutes: 40,
                  difficulty: 2,
                },
                {
                  key: 'kinematics-2d',
                  conceptKey: 'physics.mechanics.kinematics-2d',
                  title: 'Projectile & Relative Motion',
                  examWeight: 0.5,
                  estimatedMinutes: 45,
                  difficulty: 3,
                },
              ],
            },
            {
              title: "Newton's Laws",
              position: 1,
              weight: 1.0,
              concepts: [
                {
                  key: 'newtons-laws',
                  conceptKey: 'physics.mechanics.newtons-laws',
                  title: "Newton's Laws of Motion",
                  examWeight: 0.7,
                  estimatedMinutes: 50,
                  difficulty: 3,
                },
              ],
            },
            {
              title: 'Work, Energy & Power',
              position: 2,
              weight: 1.0,
              concepts: [
                {
                  key: 'work-energy',
                  conceptKey: 'physics.mechanics.work-energy',
                  title: 'Work, Energy & Power',
                  examWeight: 0.65,
                  estimatedMinutes: 45,
                  difficulty: 3,
                },
              ],
            },
            {
              title: 'Rotational Motion',
              position: 3,
              weight: 1.2,
              concepts: [
                {
                  key: 'rotational-kinematics',
                  conceptKey: 'physics.mechanics.rotational-kinematics',
                  title: 'Rotational Kinematics',
                  examWeight: 0.6,
                  estimatedMinutes: 50,
                  difficulty: 3,
                },
                {
                  key: 'torque-angular-momentum',
                  conceptKey: 'physics.mechanics.torque-angular-momentum',
                  title: 'Torque & Angular Momentum',
                  examWeight: 0.75,
                  estimatedMinutes: 60,
                  difficulty: 4,
                },
                {
                  key: 'angular-momentum-conservation',
                  conceptKey: 'physics.mechanics.angular-momentum-conservation',
                  title: 'Conservation of Angular Momentum',
                  examWeight: 0.7,
                  estimatedMinutes: 45,
                  difficulty: 4,
                },
              ],
            },
            {
              title: 'Gravitation',
              position: 4,
              weight: 0.9,
              concepts: [
                {
                  key: 'gravitation',
                  conceptKey: 'physics.mechanics.gravitation',
                  title: 'Gravitation',
                  examWeight: 0.55,
                  estimatedMinutes: 40,
                  difficulty: 3,
                },
              ],
            },
          ],
        },
        {
          title: 'Oscillations & Waves',
          position: 1,
          weight: 0.9,
          topics: [
            {
              title: 'Simple Harmonic Motion',
              position: 0,
              weight: 1.0,
              concepts: [
                {
                  key: 'shm',
                  conceptKey: 'physics.waves.shm',
                  title: 'Simple Harmonic Motion',
                  examWeight: 0.6,
                  estimatedMinutes: 50,
                  difficulty: 3,
                },
                {
                  key: 'wave-motion',
                  conceptKey: 'physics.waves.wave-motion',
                  title: 'Wave Motion',
                  examWeight: 0.5,
                  estimatedMinutes: 45,
                  difficulty: 3,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  edges: [
    { from: 'kinematics-1d', to: 'kinematics-2d', strength: 1.0 },
    { from: 'kinematics-1d', to: 'newtons-laws', strength: 0.8 },
    { from: 'newtons-laws', to: 'work-energy', strength: 1.0 },
    { from: 'kinematics-2d', to: 'rotational-kinematics', strength: 0.8 },
    { from: 'rotational-kinematics', to: 'torque-angular-momentum', strength: 1.0 },
    { from: 'newtons-laws', to: 'torque-angular-momentum', strength: 0.7 },
    { from: 'torque-angular-momentum', to: 'angular-momentum-conservation', strength: 1.0 },
    { from: 'newtons-laws', to: 'gravitation', strength: 0.6 },
    { from: 'newtons-laws', to: 'shm', strength: 0.8 },
    { from: 'shm', to: 'wave-motion', strength: 0.9 },
  ],
};

export function flattenTemplateConcepts(tree: CurriculumTemplateTree): TemplateConcept[] {
  return tree.subjects.flatMap((s) => s.units.flatMap((u) => u.topics.flatMap((t) => t.concepts)));
}
