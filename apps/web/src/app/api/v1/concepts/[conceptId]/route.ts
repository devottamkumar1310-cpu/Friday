import { UpdateConceptStatusRequestSchema } from '@friday/contracts';
import { authedRoute, requireParam } from '@/lib/api/handler';
import {
  toWireConcept,
  updateConceptStatusWithMastery,
} from '@/modules/curriculum/curriculum.service';

export const runtime = 'nodejs';

export const PATCH = authedRoute({
  body: UpdateConceptStatusRequestSchema,
  handler: async ({ user, params, body }) => {
    const { concept, mastery } = await updateConceptStatusWithMastery(
      user,
      requireParam(params, 'conceptId'),
      body,
    );
    return { data: toWireConcept(concept, mastery) };
  },
});
