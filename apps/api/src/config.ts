const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  /** Public tenant signup is OFF unless explicitly enabled. */
  allowTenantSignup: bool(process.env.ALLOW_TENANT_SIGNUP, false),
  /** First-run setup requires this deployment secret; unset disables the endpoint. */
  setupToken: process.env.SETUP_TOKEN ?? '',
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 480),
  inviteTtlHours: Number(process.env.INVITE_TTL_HOURS ?? 72),
  rateLimitEnabled: bool(process.env.RATE_LIMIT_ENABLED, true),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  chromiumPath: process.env.CHROMIUM_PATH ?? '',
  webDist: process.env.WEB_DIST ?? '',
  fontsDir: process.env.FONTS_DIR ?? '',
  demoMode: bool(process.env.DEMO_MODE, false),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 2 * 1024 * 1024),
};
