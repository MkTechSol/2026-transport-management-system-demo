import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** 'demo' enables demo-only endpoints (reset). Never set to demo on a real production deployment. */
  APP_ENV: z.enum(['local', 'test', 'demo', 'production']).default('local'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://gasman:gasman@localhost:5432/gasman_tms'),
  DB_POOL_MAX: z.coerce.number().default(20),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().default(30),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().default(600),
  /** Run the GPS simulator inside this process (demo). Real deployments ingest GPS from the mobile app instead. */
  SIM_ENABLED: z.enum(['true', 'false']).default('false'),
  SIM_TICK_SECONDS: z.coerce.number().default(5),
  /** Simulated time compression: 1 real second advances the trip by this many seconds of driving. */
  SIM_SPEEDUP: z.coerce.number().default(60),
  /** Business rule toggle (demo assumption): require a passed pre-trip safety check before dispatch. */
  REQUIRE_PRETRIP_CHECK: z.enum(['true', 'false']).default('true'),
  /** IANA timezone used for 'today' / daily buckets on dashboards & reports. */
  BUSINESS_TZ: z.string().default('Asia/Karachi'),
  SEED_ANCHOR_DATE: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === 'dev-only-access-secret-change-me') {
  console.error('Refusing to start: JWT_ACCESS_SECRET must be set in production.');
  process.exit(1);
}

export const config = {
  ...env,
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: env.COOKIE_SECURE === 'true',
  simEnabled: env.SIM_ENABLED === 'true',
  requirePretripCheck: env.REQUIRE_PRETRIP_CHECK === 'true',
  isDemo: env.APP_ENV === 'demo' || env.APP_ENV === 'local' || env.APP_ENV === 'test',
};
