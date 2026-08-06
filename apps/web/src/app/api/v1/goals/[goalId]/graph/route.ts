import { authedRoute, requireParam } from '@/lib/api/handler';
import { getGraph, toWireConcept } from '@/modules/curriculum/curriculum.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async ({ user, params }) => {
    const { concepts, edges, masteryByConcept } = await getGraph(
      user,
      requireParam(params, 'goalId'),
    );
    return {
      data: {
        nodes: concepts.map((c) => toWireConcept(c, masteryByConcept.get(c.id) ?? null)),
        edges: edges.map((e) => ({
          fromConceptId: e.fromConceptId,
          toConceptId: e.toConceptId,
          type: e.type,
          strength: Number(e.strength),
        })),
      },
    };
  },
});
