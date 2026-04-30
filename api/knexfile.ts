/**
 * Knex CLI entry point.
 *
 * The runtime connection pool lives in `src/config/knex.ts`; this file exists
 * purely so `knex migrate:*` / `knex seed:run` can be driven from npm scripts
 * and from the Jenkins pipeline without duplicating connection logic.
 */
import { knexConfig } from './src/config/knex';

export default knexConfig;
