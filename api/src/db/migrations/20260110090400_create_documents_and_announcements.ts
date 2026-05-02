import type { Knex } from 'knex';

/**
 * Document vault and company announcements.
 *
 * Files live on disk (or S3 in production); only metadata is stored here. The
 * `visibility` enum is what the documents service checks before streaming a
 * file, so an employee cannot guess another employee's document id.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('documents', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().nullable();
    table.integer('uploaded_by_id').unsigned().notNullable();
    table.string('title', 180).notNullable();
    table.string('category', 40).notNullable().defaultTo('GENERAL');
    table.string('original_filename', 255).notNullable();
    table.string('storage_key', 255).notNullable().unique('uq_documents_storage_key');
    table.string('mime_type', 120).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.enu('visibility', ['PRIVATE', 'MANAGER', 'HR', 'COMPANY'], {
      useNative: false,
      enumName: 'document_visibility',
    })
      .notNullable()
      .defaultTo('PRIVATE');
    table.date('expires_on').nullable();
    table.timestamps(true, true);

    table
      .foreign('employee_id', 'fk_documents_employee')
      .references('employees.id')
      .onDelete('CASCADE');
    table
      .foreign('uploaded_by_id', 'fk_documents_uploader')
      .references('employees.id')
      .onDelete('RESTRICT');

    // "My documents in this category" and the HR compliance view both filter on
    // the owning employee first, then narrow by category.
    table.index(['employee_id', 'category'], 'idx_documents_employee_category');
    table.index(['visibility', 'created_at'], 'idx_documents_visibility_created');
  });

  await knex.schema.createTable('announcements', (table) => {
    table.increments('id').primary();
    table.integer('author_id').unsigned().notNullable();
    table.string('title', 180).notNullable();
    table.text('body').notNullable();
    table.enu('audience', ['ALL', 'DEPARTMENT', 'MANAGERS'], {
      useNative: false,
      enumName: 'announcement_audience',
    })
      .notNullable()
      .defaultTo('ALL');
    table.integer('department_id').unsigned().nullable();
    table.boolean('is_pinned').notNullable().defaultTo(false);
    table.timestamp('published_at').nullable();
    table.timestamp('expires_at').nullable();
    table.timestamps(true, true);

    table
      .foreign('author_id', 'fk_announcements_author')
      .references('employees.id')
      .onDelete('RESTRICT');
    table
      .foreign('department_id', 'fk_announcements_department')
      .references('departments.id')
      .onDelete('CASCADE');

    // The feed is "published, not expired, pinned first, newest first".
    table.index(['published_at', 'is_pinned'], 'idx_announcements_feed');
    table.index(['audience', 'department_id'], 'idx_announcements_audience');
  });

  await knex.schema.createTable('announcement_reads', (table) => {
    table.increments('id').primary();
    table.integer('announcement_id').unsigned().notNullable();
    table.integer('employee_id').unsigned().notNullable();
    table.timestamp('read_at').notNullable().defaultTo(knex.fn.now());

    table
      .foreign('announcement_id', 'fk_announcement_reads_announcement')
      .references('announcements.id')
      .onDelete('CASCADE');
    table
      .foreign('employee_id', 'fk_announcement_reads_employee')
      .references('employees.id')
      .onDelete('CASCADE');

    // A read receipt is idempotent: the unique index turns "mark as read" into
    // a single INSERT ... ON DUPLICATE KEY UPDATE.
    table.unique(['announcement_id', 'employee_id'], { indexName: 'uq_announcement_reads' });
    // Unread badge count for the current user.
    table.index(['employee_id', 'read_at'], 'idx_announcement_reads_employee');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('announcement_reads');
  await knex.schema.dropTableIfExists('announcements');
  await knex.schema.dropTableIfExists('documents');
}
