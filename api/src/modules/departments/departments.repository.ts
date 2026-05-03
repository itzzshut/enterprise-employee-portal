import { db } from '@config/knex';

export interface DepartmentRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  location: string | null;
  annual_budget: string | null;
  is_active: number | boolean;
  head_employee_id: number | null;
  head_name: string | null;
  headcount: number;
}

/**
 * The headcount is computed with a correlated sub-select instead of a JOIN +
 * GROUP BY so departments with zero active employees still appear in the list
 * (a LEFT JOIN would work too, but the sub-select keeps the projection flat and
 * lets MySQL use idx_employees_department_status directly).
 */
function selectDepartments() {
  return db('departments as d')
    .select(
      'd.id',
      'd.code',
      'd.name',
      'd.description',
      'd.location',
      'd.annual_budget',
      'd.is_active',
      'd.head_employee_id',
    )
    .select(db.raw("CONCAT_WS(' ', h.first_name, h.last_name) AS head_name"))
    .select(
      db.raw(
        "(SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status <> 'TERMINATED') AS headcount",
      ),
    )
    .leftJoin('employees as h', 'h.id', 'd.head_employee_id');
}

export const departmentsRepository = {
  list(includeInactive = false): Promise<DepartmentRow[]> {
    const query = selectDepartments().orderBy('d.name', 'asc');
    if (!includeInactive) query.where('d.is_active', true);
    return query as Promise<DepartmentRow[]>;
  },

  findById(id: number): Promise<DepartmentRow | undefined> {
    return selectDepartments().where('d.id', id).first<DepartmentRow | undefined>();
  },

  findByCode(code: string): Promise<DepartmentRow | undefined> {
    return selectDepartments().where('d.code', code).first<DepartmentRow | undefined>();
  },

  async create(payload: Record<string, unknown>): Promise<number> {
    const [id] = await db('departments').insert(payload);
    return id as number;
  },

  async update(id: number, payload: Record<string, unknown>): Promise<number> {
    return db('departments').where('id', id).update(payload);
  },

  async countEmployees(departmentId: number): Promise<number> {
    const row = await db('employees')
      .where('department_id', departmentId)
      .whereNot('status', 'TERMINATED')
      .count<{ total: number }>({ total: 'id' })
      .first();
    return Number(row?.total ?? 0);
  },
};
