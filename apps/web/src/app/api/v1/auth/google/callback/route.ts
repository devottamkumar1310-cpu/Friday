import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signInWithGoogle } from '@/modules/identity/identity.service';
import { SESSION_COOKIE } from '@/modules/identity/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam || !code || !stateParam) {
    return NextResponse.redirect(new URL('/sign-in?error=google_auth_failed', request.url));
  }

  const storedState = (await cookies()).get('google_oauth_state')?.value;
  let nextUrl = '/dashboard';

  try {
    const parsedState = JSON.parse(stateParam);
    if (parsedState.state !== storedState) {
      return NextResponse.redirect(new URL('/sign-in?error=csrf_mismatch', request.url));
    }
    if (parsedState.next) {
      nextUrl = parsedState.next;
    }
  } catch {
    return NextResponse.redirect(new URL('/sign-in?error=invalid_state', request.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/sign-in?error=google_auth_not_configured', request.url));
  }

  const redirectUri = `${origin}/api/v1/auth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL('/sign-in?error=token_exchange_failed', request.url));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch user profile from Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return NextResponse.redirect(new URL('/sign-in?error=user_info_failed', request.url));
    }

    const googleUser = await userRes.json();

    const authResult = await signInWithGoogle(
      {
        providerAccountId: googleUser.sub,
        email: googleUser.email,
        displayName: googleUser.name || 'Learner',
        avatarUrl: googleUser.picture ?? null,
      },
      {
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    );

    const response = NextResponse.redirect(new URL(nextUrl, request.url));

    response.cookies.set(SESSION_COOKIE, authResult.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: authResult.expiresAt,
    });

    response.cookies.delete('google_oauth_state');

    return response;
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(new URL('/sign-in?error=auth_error', request.url));
  }
}
