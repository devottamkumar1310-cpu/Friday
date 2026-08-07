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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Minted per request by middleware. The CSP admits inline scripts only by
  // nonce, so this is what keeps the theme script running.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint. Inline and blocking on
          purpose: deferring it produces a flash of the wrong theme, which is
          worse than the few milliseconds this costs.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var stored = localStorage.getItem('friday-theme');
                var dark = stored ? stored === 'dark'
                  : window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (dark) document.documentElement.classList.add('dark');
              } catch (e) {}
            `,
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
