/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source rather than a build artifact, so
  // there is no per-package compile step to keep in sync. Next transpiles them.
  transpilePackages: [
    '@friday/ui',
    '@friday/contracts',
    '@friday/core',
    '@friday/db',
    '@friday/ai',
    '@friday/observability',
  ],

  // @node-rs/argon2 is a native addon; bundling it would break the binary
  // resolution. Postgres likewise expects to be required at runtime.
  serverExternalPackages: ['@node-rs/argon2', 'pg'],

  eslint: {
    // Linting runs as its own CI step against the whole workspace, with the
    // dependency-boundary rules. Repeating it inside `next build` would use a
    // different config and report different results.
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Two years, subdomains included. Browsers ignore it over plaintext,
          // so it is inert in local development and active the moment the app
          // is served over TLS. `preload` is deliberately omitted: submitting
          // to the preload list is close to irreversible and is a decision for
          // whoever owns the domain, not a default.
          //
          // Content-Security-Policy is *not* here — it carries a per-request
          // nonce and is set in middleware.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
