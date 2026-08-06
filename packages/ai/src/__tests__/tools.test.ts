import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type ExecutorMap } from '../tools/types';

const registry = {
  getWeakConcepts: defineTool({
    name: 'get_weak_concepts',
    description: 'Return the learner’s weakest concepts, ranked.',
    kind: 'read',
    args: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
    result: z.object({
      concepts: z.array(z.object({ id: z.string().uuid(), mastery: z.number() })),
    }),
  }),
};

describe('tool declaration', () => {
  it('validates arguments against the declared schema', () => {
    expect(registry.getWeakConcepts.args.safeParse({ limit: 5 }).success).toBe(true);
    expect(registry.getWeakConcepts.args.safeParse({ limit: 99 }).success).toBe(false);
  });

  it('marks read tools so write tools can be gated separately', () => {
    expect(registry.getWeakConcepts.kind).toBe('read');
  });

  it('accepts an injected, user-scoped executor', async () => {
    // The service layer supplies this. The agent never resolves data itself.
    const executors: ExecutorMap<typeof registry> = {
      getWeakConcepts: async (userId, args) => {
        expect(userId).toBe('user-1');
        return {
          concepts: Array.from({ length: args.limit }, () => ({
            id: crypto.randomUUID(),
            mastery: 0.4,
          })),
        };
      },
    };

    const result = await executors.getWeakConcepts('user-1', { limit: 3 });
    expect(result.concepts).toHaveLength(3);
  });
});
