/**
 * Jest `setupFiles` hook — runs before any module (and therefore before
 * `config/env.ts` parses the environment). Every value here is deliberately
 * fake: unit tests never touch a real MySQL instance.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '4999';
process.env.API_PREFIX = '/api/v1';

process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '3306';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'employee_portal_test';

process.env.JWT_ACCESS_SECRET = 'test_access_secret_that_is_long_enough_to_pass_validation';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_that_is_long_enough_to_pass_validation';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL_DAYS = '7';
process.env.BCRYPT_ROUNDS = '10';

process.env.CORS_ORIGIN = 'http://localhost:4200';
process.env.UPLOAD_DIR = './.tmp-test-uploads';
process.env.LOG_DIR = './.tmp-test-logs';
process.env.LOG_LEVEL = 'error';
