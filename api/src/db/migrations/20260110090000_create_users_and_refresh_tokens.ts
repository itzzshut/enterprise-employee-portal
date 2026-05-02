import type { Knex } from 'knex';

/**
 * Identity tables.
 *
 * `users` holds credentials only; everything HR-facing lives in `employees`.
 * Keeping them apart means a terminated employee record can be retained for
 * audit while the login row is deactivated, and service accounts (integration
 * users) can exist with no employee profile at all.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 190).notNullable().unique('uq_users_email');
    table.string('password_hash', 100).notNullable();
    table.enu('role', ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'], {
      useNative: false,
      enumName: 'user_role',
    })
      .notNullable()
      .defaultTo('EMPLOYEE');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.boolean('must_change_password').notNullable().defaultTo(false);
    table.timestamp('last_login_at').nullable();
    table.timestamps(true, true);

    // Login resolves by email; the unique index above already serves it. This
    // partial-ish composite supports the admin "active users by role" screens.
    table.index(['role', 'is_active'], 'idx_users_role_active');
  });

  await knex.schema.createTable('refresh_tokens', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    // `jti` is the claim embedded in the JWT; the raw token is never stored.
    table.uuid('jti').notNullable().unique('uq_refresh_tokens_jti');
    table.string('token_hash', 64).notNullable();
    table.string('user_agent', 255).nullable();
    table.string('ip_address', 45).nullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    // Set when this token is rotated, so a replayed token can be traced to the
    // session that superseded it (reuse detection).
    table.uuid('replaced_by_jti').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.foreign('user_id', 'fk_refresh_tokens_user').references('users.id').onDelete('CASCADE');

    // The refresh endpoint always filters "this user's live tokens", so the
    // composite (user_id, revoked_at, expires_at) is covering for that lookup.
    table.index(['user_id', 'revoked_at', 'expires_at'], 'idx_refresh_tokens_user_live');
    // Nightly cleanup job deletes by expiry alone.
    table.index(['expires_at'], 'idx_refresh_tokens_expires');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
}
