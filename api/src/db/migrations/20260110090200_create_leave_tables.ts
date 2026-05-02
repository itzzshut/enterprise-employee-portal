import type { Knex } from 'knex';

/**
 * Leave management.
 *
 * `leave_requests.status` is the state-machine column driven by
 * `modules/leave/leave.state.ts`; `leave_approvals` is the append-only audit of
 * each decision, so a rejection reason survives even after a resubmission.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('leave_types', (table) => {
    table.increments('id').primary();
    table.string('code', 20).notNullable().unique('uq_leave_types_code');
    table.string('name', 80).notNullable();
    table.decimal('default_annual_days', 5, 1).notNullable().defaultTo(0);
    table.boolean('requires_attachment').notNullable().defaultTo(false);
    table.boolean('is_paid').notNullable().defaultTo(true);
    table.boolean('carry_forward_allowed').notNullable().defaultTo(false);
    table.string('color_hex', 7).notNullable().defaultTo('#2563eb');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('leave_balances', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.integer('leave_type_id').unsigned().notNullable();
    table.smallint('year').notNullable();
    table.decimal('entitled_days', 5, 1).notNullable().defaultTo(0);
    table.decimal('used_days', 5, 1).notNullable().defaultTo(0);
    // Reserved by PENDING/MANAGER_APPROVED requests so two in-flight requests
    // cannot both pass the balance check.
    table.decimal('pending_days', 5, 1).notNullable().defaultTo(0);
    table.decimal('carried_over_days', 5, 1).notNullable().defaultTo(0);
    table.timestamps(true, true);

    table
      .foreign('employee_id', 'fk_leave_balances_employee')
      .references('employees.id')
      .onDelete('CASCADE');
    table
      .foreign('leave_type_id', 'fk_leave_balances_type')
      .references('leave_types.id')
      .onDelete('RESTRICT');

    // One balance row per employee / type / year — this unique index is also
    // the exact lookup key used on every balance read and adjustment.
    table.unique(['employee_id', 'leave_type_id', 'year'], {
      indexName: 'uq_leave_balances_employee_type_year',
    });
  });

  await knex.schema.createTable('leave_requests', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    table.integer('leave_type_id').unsigned().notNullable();
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    // Stored rather than derived: company holidays and half-days mean the value
    // is not a plain date difference, and reports must stay reproducible.
    table.decimal('total_days', 5, 1).notNullable();
    table.boolean('half_day').notNullable().defaultTo(false);
    table.string('reason', 500).notNullable();
    table.enu(
      'status',
      ['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED'],
      { useNative: false, enumName: 'leave_status' },
    )
      .notNullable()
      .defaultTo('PENDING');
    table.integer('current_approver_id').unsigned().nullable();
    table.string('attachment_url', 255).nullable();
    table.timestamp('submitted_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('decided_at').nullable();
    table.timestamps(true, true);

    table
      .foreign('employee_id', 'fk_leave_requests_employee')
      .references('employees.id')
      .onDelete('CASCADE');
    table
      .foreign('leave_type_id', 'fk_leave_requests_type')
      .references('leave_types.id')
      .onDelete('RESTRICT');
    table
      .foreign('current_approver_id', 'fk_leave_requests_approver')
      .references('employees.id')
      .onDelete('SET NULL');

    // "My requests, filtered by status" — the single most frequent query in the
    // app. Composite (employee_id, status) lets MySQL satisfy both the equality
    // filter and the status facet counts from one index.
    table.index(['employee_id', 'status'], 'idx_leave_requests_employee_status');
    // Overlap detection and the calendar endpoint both range-scan the dates for
    // a known employee, so the date pair follows the employee id.
    table.index(['employee_id', 'start_date', 'end_date'], 'idx_leave_requests_employee_range');
    // Approvals inbox: "everything waiting on me", newest first.
    table.index(['current_approver_id', 'status'], 'idx_leave_requests_approver_status');
    // Company-wide calendar for a month, across all employees.
    table.index(['start_date', 'end_date', 'status'], 'idx_leave_requests_calendar');
  });

  await knex.schema.createTable('leave_approvals', (table) => {
    table.increments('id').primary();
    table.integer('leave_request_id').unsigned().notNullable();
    table.integer('approver_id').unsigned().notNullable();
    table.enu('stage', ['MANAGER', 'HR'], { useNative: false, enumName: 'approval_stage' })
      .notNullable();
    table.enu('decision', ['APPROVED', 'REJECTED'], {
      useNative: false,
      enumName: 'approval_decision',
    }).notNullable();
    table.string('comments', 500).nullable();
    table.timestamp('decided_at').notNullable().defaultTo(knex.fn.now());

    table
      .foreign('leave_request_id', 'fk_leave_approvals_request')
      .references('leave_requests.id')
      .onDelete('CASCADE');
    table
      .foreign('approver_id', 'fk_leave_approvals_approver')
      .references('employees.id')
      .onDelete('RESTRICT');

    // A request is decided at most once per stage; the unique index enforces
    // the workflow invariant in the database, not just in the service.
    table.unique(['leave_request_id', 'stage'], { indexName: 'uq_leave_approvals_request_stage' });
    table.index(['approver_id', 'decided_at'], 'idx_leave_approvals_approver_date');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('leave_approvals');
  await knex.schema.dropTableIfExists('leave_requests');
  await knex.schema.dropTableIfExists('leave_balances');
  await knex.schema.dropTableIfExists('leave_types');
}
