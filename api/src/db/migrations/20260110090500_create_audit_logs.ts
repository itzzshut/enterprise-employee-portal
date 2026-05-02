import type { Knex } from 'knex';

/**
 * Append-only audit trail.
 *
 * Every privileged mutation (role change, leave decision, document download,
 * employee deactivation) writes one row. `request_id` matches the correlation
 * id in the structured logs, so an auditor can pivot from a database row to the
 * exact log stream for that HTTP call.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_logs', (table) => {
    table.bigIncrements('id').primary();
    table.integer('actor_user_id').unsigned().nullable();
    table.string('action', 80).notNullable();
    table.string('entity_type', 60).notNullable();
    table.bigInteger('entity_id').unsigned().nullable();
    table.json('metadata').nullable();
    table.string('request_id', 64).nullable();
    table.string('ip_address', 45).nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // SET NULL rather than CASCADE: deleting a user must not erase the history
    // of what that user did.
    table
      .foreign('actor_user_id', 'fk_audit_logs_actor')
      .references('users.id')
      .onDelete('SET NULL');

    // Audit queries are "what happened to this entity" and "what did this user
    // do recently"; both get a dedicated composite index, ordered so the
    // timestamp is the range column at the tail.
    table.index(['entity_type', 'entity_id', 'created_at'], 'idx_audit_logs_entity');
    table.index(['actor_user_id', 'created_at'], 'idx_audit_logs_actor_created');
    table.index(['action', 'created_at'], 'idx_audit_logs_action_created');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
}
