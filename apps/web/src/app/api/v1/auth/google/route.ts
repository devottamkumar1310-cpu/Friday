import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const { searchParams } = new URL(request.url);
  const next = searchParams.get('next') ?? '/dashboard';

  if (!clientId) {
    return NextResponse.redirect(
      new URL('/sign-in?error=google_auth_not_configured', request.url),
    );
  }

  const state = crypto.randomUUID();
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/v1/auth/google/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', JSON.stringify({ state, next }));
  authUrl.searchParams.set('prompt', 'select_account');

  const response = NextResponse.redirect(authUrl.toString());

  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  });

  return response;
}
