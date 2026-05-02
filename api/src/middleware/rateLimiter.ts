import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { logger } from '@utils/logger';

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, _res, next) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.originalUrl });
    next(ApiError.tooManyRequests());
  },
};

/** Broad protection for every authenticated API call. */
export const apiRateLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  keyGenerator: (req) => (req.user ? `u:${req.user.userId}` : `ip:${req.ip}`),
  skip: () => env.isTest,
});

/**
 * Much tighter budget for credential endpoints. Keyed on IP *and* the submitted
 * email so one attacker cannot lock out a whole office NAT, and a distributed
 * attempt against a single account is still throttled.
 */
export const authRateLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'anonymous';
    return `${req.ip}:${email}`;
  },
  skipSuccessfulRequests: true,
  skip: () => env.isTest,
});
