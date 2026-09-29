import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Public API - GET /api/public/v1/goals
 * Requires a Bearer token mapped to an API Key in a real implementation.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid API key' }, { status: 401 });
  }
  // Simplified validation for Phase 6 implementation
  // Note: For a real public API, we would lookup the user by their API key,
  // then fetch their goals. This scaffold demonstrates the endpoint shape.
  
  return NextResponse.json({
    data: [],
    meta: { count: 0, next_cursor: null }
  });
}
