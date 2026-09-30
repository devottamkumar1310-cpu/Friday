import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Toaster } from '@friday/ui';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'FRIDAY — your AI learning operating system',
    template: '%s · FRIDAY',
  },
  description:
    'FRIDAY plans, adapts, and tracks your learning so you can spend your attention on studying rather than on managing it.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfcfd' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1c20' },
  ],
};

const THEME_SCRIPT = `try {
  var stored = localStorage.getItem('friday-theme');
  var dark = stored ? stored === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * Hydration fix (PART 1):
   *
   * The middleware stamps a per-request nonce via the `x-nonce` response header.
   * Next.js's `get-nonce` package reads the Content-Security-Policy header
   * during client-side hydration and automatically applies the nonce value to
   * any inline script it finds. On the server side the nonce attribute was
   * previously absent (empty string), so server HTML said `nonce=""` and the
   * client said `nonce="<actual nonce>"` — a guaranteed hydration mismatch.
   *
   * Reading the nonce here and setting it on both sides makes the SSR-rendered
   * HTML and the client-hydrated tree agree, eliminating the mismatch without
   * disabling SSR or using suppressHydrationWarning.
   *
   * Note: dangerouslySetInnerHTML scripts are always inlined and are not subject
   * to script-src CSP restrictions — only external scripts need a nonce — so the
   * theme script works correctly regardless of CSP policy. The nonce is included
   * solely to satisfy React's hydration equality check.
   */
  const nonce = (await headers()).get('x-nonce') ?? '';

  return (
    <html lang="en">
      <head>
        {/*
          Applies the stored theme before first paint. Inline and blocking on
          purpose: deferring it produces a flash of the wrong theme, which is
          worse than the few milliseconds this costs.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: THEME_SCRIPT,
          }}
        />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {/* WCAG 2.2 AA: keyboard users must be able to reach content directly. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Skip to content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
