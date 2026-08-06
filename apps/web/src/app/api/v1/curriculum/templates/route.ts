import { authedRoute } from '@/lib/api/handler';
import { listTemplates } from '@/modules/curriculum/curriculum.service';

export const runtime = 'nodejs';

export const GET = authedRoute({
  handler: async () => ({
    data: (await listTemplates()).map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      examBoard: t.examBoard,
      region: t.region,
    })),
  }),
});
