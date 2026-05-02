import type { Knex } from 'knex';

/**
 * Time tracking.
 *
 * A `timesheets` row is the weekly envelope (one per employee per ISO week)
 * that carries the submit/approve status; `timesheet_entries` holds the grid
 * cells (project x day). Splitting them keeps the approval state in one place
 * instead of duplicating it across 35 cells.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('projects', (table) => {
    table.increments('id').primary();
    table.string('code', 20).notNullable().unique('uq_projects_code');
    table.string('name', 150).notNullable();
    table.string('client_name', 150).nullable();
    table.integer('department_id').unsigned().nullable();
    table.integer('lead_employee_id').unsigned().nullable();
    table.boolean('is_billable').notNullable().defaultTo(true);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.date('start_date').nullable();
    table.date('end_date').nullable();
    table.timestamps(true, true);

    table
      .foreign('department_id', 'fk_projects_department')
      .references('departments.id')
      .onDelete('SET NULL');
    table
      .foreign('lead_employee_id', 'fk_projects_lead')
      .references('employees.id')
      .onDelete('SET NULL');

    table.index(['is_active', 'department_id'], 'idx_projects_active_department');
  });

  await knex.schema.createTable('timesheets', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable();
    // Always the Monday of the ISO week — normalised in the service so the
    // unique constraint below is meaningful.
    table.date('week_start_date').notNullable();
    table.enu('status', ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'], {
      useNative: false,
      enumName: 'timesheet_status',
    })
      .notNullable()
      .defaultTo('DRAFT');
    table.decimal('total_hours', 6, 2).notNullable().defaultTo(0);
    table.integer('approver_id').unsigned().nullable();
    table.string('approver_comments', 500).nullable();
    table.timestamp('submitted_at').nullable();
    table.timestamp('approved_at').nullable();
    table.timestamps(true, true);

    table
      .foreign('employee_id', 'fk_timesheets_employee')
      .references('employees.id')
      .onDelete('CASCADE');
    table
      .foreign('approver_id', 'fk_timesheets_approver')
      .references('employees.id')
      .onDelete('SET NULL');

    // Exactly one timesheet per employee per week. Upserting the grid relies on
    // this constraint instead of a read-then-write race.
    table.unique(['employee_id', 'week_start_date'], { indexName: 'uq_timesheets_employee_week' });
    // Manager approval queue, and the utilisation report which scans a week
    // across all employees.
    table.index(['status', 'week_start_date'], 'idx_timesheets_status_week');
  });

  await knex.schema.createTable('timesheet_entries', (table) => {
    table.increments('id').primary();
    table.integer('timesheet_id').unsigned().notNullable();
    table.integer('project_id').unsigned().notNullable();
    table.date('work_date').notNullable();
    table.decimal('hours', 4, 2).notNullable();
    table.string('notes', 300).nullable();
    table.timestamps(true, true);

    table
      .foreign('timesheet_id', 'fk_timesheet_entries_timesheet')
      .references('timesheets.id')
      .onDelete('CASCADE');
    table
      .foreign('project_id', 'fk_timesheet_entries_project')
      .references('projects.id')
      .onDelete('RESTRICT');

    // One cell per project/day inside a week — makes the grid save idempotent.
    table.unique(['timesheet_id', 'project_id', 'work_date'], {
      indexName: 'uq_timesheet_entries_cell',
    });
    // Per-project effort aggregation over a date range.
    table.index(['project_id', 'work_date'], 'idx_timesheet_entries_project_date');

    // Hours per cell are bounded by a CHECK so a fat-fingered "80" cannot
    // corrupt the weekly total. MySQL 8.0.16+ enforces CHECK constraints.
  });

  await knex.raw(`
    ALTER TABLE timesheet_entries
    ADD CONSTRAINT chk_timesheet_entries_hours
    CHECK (hours > 0 AND hours <= 24)
  `);

  await knex.raw(`
    ALTER TABLE leave_requests
    ADD CONSTRAINT chk_leave_requests_date_order
    CHECK (end_date >= start_date)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE leave_requests DROP CONSTRAINT chk_leave_requests_date_order');
  await knex.schema.dropTableIfExists('timesheet_entries');
  await knex.schema.dropTableIfExists('timesheets');
  await knex.schema.dropTableIfExists('projects');
}
