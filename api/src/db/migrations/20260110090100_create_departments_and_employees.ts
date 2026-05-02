import type { Knex } from 'knex';

/**
 * Org structure.
 *
 * `departments.head_employee_id` and `employees.department_id` reference each
 * other, so the head column is added in a second pass after `employees` exists.
 * `employees.manager_id` is a self-reference — the adjacency list the org-chart
 * recursive CTE walks.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('departments', (table) => {
    table.increments('id').primary();
    table.string('code', 20).notNullable().unique('uq_departments_code');
    table.string('name', 120).notNullable();
    table.string('description', 500).nullable();
    table.string('location', 120).nullable();
    table.decimal('annual_budget', 14, 2).nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('employees', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().nullable().unique('uq_employees_user');
    table.string('employee_code', 20).notNullable().unique('uq_employees_code');
    table.string('first_name', 80).notNullable();
    table.string('last_name', 80).notNullable();
    table.string('work_email', 190).notNullable().unique('uq_employees_work_email');
    table.string('phone', 30).nullable();
    table.string('job_title', 120).notNullable();
    table.integer('department_id').unsigned().nullable();
    table.integer('manager_id').unsigned().nullable();
    table.date('hire_date').notNullable();
    table.date('termination_date').nullable();
    table.enu('employment_type', ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'], {
      useNative: false,
      enumName: 'employment_type',
    })
      .notNullable()
      .defaultTo('FULL_TIME');
    table.enu('status', ['ACTIVE', 'ON_LEAVE', 'TERMINATED'], {
      useNative: false,
      enumName: 'employee_status',
    })
      .notNullable()
      .defaultTo('ACTIVE');
    table.string('location', 120).nullable();
    table.string('avatar_url', 255).nullable();
    table.timestamps(true, true);

    table.foreign('user_id', 'fk_employees_user').references('users.id').onDelete('SET NULL');
    table
      .foreign('department_id', 'fk_employees_department')
      .references('departments.id')
      .onDelete('SET NULL');
    // RESTRICT, not CASCADE: deleting a manager must never silently orphan or
    // delete a subtree. HR has to reassign reports first.
    table
      .foreign('manager_id', 'fk_employees_manager')
      .references('employees.id')
      .onDelete('RESTRICT');

    // Directory listing is "active employees in a department, sorted by name".
    table.index(['department_id', 'status'], 'idx_employees_department_status');
    // The org-chart CTE and the approvals inbox both traverse manager_id.
    table.index(['manager_id'], 'idx_employees_manager');
    // Prefix search on the directory's name filter.
    table.index(['last_name', 'first_name'], 'idx_employees_name');
  });

  await knex.schema.alterTable('departments', (table) => {
    table.integer('head_employee_id').unsigned().nullable();
    table
      .foreign('head_employee_id', 'fk_departments_head')
      .references('employees.id')
      .onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('departments', (table) => {
    table.dropForeign(['head_employee_id'], 'fk_departments_head');
    table.dropColumn('head_employee_id');
  });
  await knex.schema.dropTableIfExists('employees');
  await knex.schema.dropTableIfExists('departments');
}
