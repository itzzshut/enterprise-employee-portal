import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Fail-fast configuration.
 *
 * Every environment variable the application touches is declared here and
 * parsed once at boot. A typo in a deployment manifest therefore crashes the
 * container immediately (and visibly, in the Jenkins deploy logs) instead of
 * surfacing as a confusing `undefined` three layers down inside a service.
 */
const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),
  TRUST_PROXY: booleanish.default('true'),

  UPLOAD_DIR: z.string().default('./storage/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(5),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_DIR: z.string().default('./logs'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Intentionally raw: the logger itself depends on this module.
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  uploadDir: path.resolve(process.cwd(), raw.UPLOAD_DIR),
  logDir: path.resolve(process.cwd(), raw.LOG_DIR),
  maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
  refreshTokenTtlMs: raw.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
} as const;

export type Env = typeof env;
