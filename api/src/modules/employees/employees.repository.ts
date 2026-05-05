import type { Knex } from 'knex';
import { db } from '@config/knex';
import { buildPage, parseSort, type Paginated, type PaginationParams } from '@utils/paginate';
import type { DirectoryQuery } from './employees.schema';
import type { EmploymentType, EmployeeStatus } from '@/types';

export interface EmployeeRow {
  id: number;
  user_id: number | null;
  employee_code: string;
  first_name: string;
  last_name: string;
  work_email: string;
  phone: string | null;
  job_title: string;
  department_id: number | null;
  department_name: string | null;
  manager_id: number | null;
  manager_name: string | null;
  hire_date: string;
  termination_date: string | null;
  employment_type: EmploymentType;
  status: EmployeeStatus;
  location: string | null;
  avatar_url: string | null;
  role: string | null;
}

const SORTABLE = ['last_name', 'first_name', 'job_title', 'hire_date', 'employee_code'] as const;

function selectEmployee(trx: Knex | Knex.Transaction = db) {
  return trx('employees as e')
    .select(
      'e.id',
      'e.user_id',
      'e.employee_code',
      'e.first_name',
      'e.last_name',
      'e.work_email',
      'e.phone',
      'e.job_title',
      'e.department_id',
      'e.manager_id',
      'e.hire_date',
      'e.termination_date',
      'e.employment_type',
      'e.status',
      'e.location',
      'e.avatar_url',
    )
    .select(trx.ref('d.name').as('department_name'))
    .select(trx.raw("CONCAT_WS(' ', m.first_name, m.last_name) AS manager_name"))
    .select(trx.ref('u.role').as('role'))
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('employees as m', 'm.id', 'e.manager_id')
    .leftJoin('users as u', 'u.id', 'e.user_id');
}

/** Shared predicate so the count query and the page query cannot drift apart. */
function applyFilters(query: Knex.QueryBuilder, filters: DirectoryQuery): Knex.QueryBuilder {
  if (filters.q) {
    const term = `%${filters.q}%`;
    query.where((builder) =>
      builder
        .whereILike('e.first_name', term)
        .orWhereILike('e.last_name', term)
        .orWhereILike('e.job_title', term)
        .orWhereILike('e.work_email', term)
        .orWhereILike('e.employee_code', term),
    );
  }
  if (filters.departmentId) query.where('e.department_id', filters.departmentId);
  if (filters.managerId) query.where('e.manager_id', filters.managerId);
  if (filters.status) query.where('e.status', filters.status);
  if (filters.employmentType) query.where('e.employment_type', filters.employmentType);
  return query;
}

export const employeesRepository = {
  async search(filters: DirectoryQuery, pagination: PaginationParams): Promise<Paginated<EmployeeRow>> {
    const sort = parseSort(filters as Record<string, unknown>, SORTABLE, 'last_name');

    const countRow = await applyFilters(db('employees as e'), filters)
      .count<{ total: number }>({ total: 'e.id' })
      .first();

    const rows = await applyFilters(selectEmployee(), filters)
      .orderBy(`e.${sort.column}`, sort.direction)
      .orderBy('e.id', 'asc')
      .limit(pagination.limit)
      .offset(pagination.offset);

    return buildPage(rows as EmployeeRow[], Number(countRow?.total ?? 0), pagination);
  },

  findById(id: number): Promise<EmployeeRow | undefined> {
    return selectEmployee().where('e.id', id).first<EmployeeRow | undefined>();
  },

  findByUserId(userId: number): Promise<EmployeeRow | undefined> {
    return selectEmployee().where('e.user_id', userId).first<EmployeeRow | undefined>();
  },

  listDirectReports(managerId: number): Promise<EmployeeRow[]> {
    return selectEmployee()
      .where('e.manager_id', managerId)
      .whereNot('e.status', 'TERMINATED')
      .orderBy('e.last_name', 'asc') as Promise<EmployeeRow[]>;
  },

  async isDirectReport(managerId: number, employeeId: number): Promise<boolean> {
    const row = await db('employees').select('id').where({ id: employeeId, manager_id: managerId }).first();
    return Boolean(row);
  },

  /**
   * Walks the management chain upward (bounded to 10 levels) to answer
   * "is this employee anywhere beneath me?". Used by the leave module so a
   * skip-level manager can still see a request in their sub-tree.
   */
  async isInReportingLine(managerId: number, employeeId: number): Promise<boolean> {
    const result = await db.raw(
      `
      WITH RECURSIVE chain AS (
        SELECT id, manager_id, 1 AS depth
          FROM employees
         WHERE id = ?
        UNION ALL
        SELECT e.id, e.manager_id, chain.depth + 1
          FROM employees e
          JOIN chain ON e.id = chain.manager_id
         WHERE chain.depth < 10
      )
      SELECT COUNT(*) AS matches FROM chain WHERE manager_id = ?
      `,
      [employeeId, managerId],
    );
    const rows = result?.[0] as Array<{ matches: number }> | undefined;
    return Number(rows?.[0]?.matches ?? 0) > 0;
  },

  async create(
    payload: Record<string, unknown>,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const [id] = await (trx ?? db)('employees').insert(payload);
    return id as number;
  },

  async update(id: number, payload: Record<string, unknown>): Promise<number> {
    return db('employees').where('id', id).update(payload);
  },

  async setAvatar(id: number, avatarUrl: string): Promise<void> {
    await db('employees').where('id', id).update({ avatar_url: avatarUrl });
  },

  async countActive(): Promise<number> {
    const row = await db('employees').where('status', 'ACTIVE').count<{ total: number }>({ total: 'id' }).first();
    return Number(row?.total ?? 0);
  },
};
