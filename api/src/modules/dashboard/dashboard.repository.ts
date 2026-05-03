import { db } from '@config/knex';

export const dashboardRepository = {
  /**
   * Company KPI tiles in one round trip.
   *
   * Each tile is an independent aggregate, so they are bundled as scalar
   * sub-selects rather than issued as five separate queries — one network hop
   * instead of five for a screen that loads on every sign-in.
   */
  async companyKpis(): Promise<Record<string, number>> {
    const result = await db.raw(`
      SELECT
        (SELECT COUNT(*) FROM employees WHERE status = 'ACTIVE') AS active_employees,
        (SELECT COUNT(*) FROM employees WHERE status = 'ON_LEAVE') AS employees_on_leave,
        (SELECT COUNT(*) FROM departments WHERE is_active = 1) AS active_departments,
        (SELECT COUNT(*) FROM leave_requests WHERE status IN ('PENDING','MANAGER_APPROVED')) AS open_leave_requests,
        (SELECT COUNT(*) FROM timesheets WHERE status = 'SUBMITTED') AS timesheets_awaiting_approval,
        (SELECT COUNT(*) FROM employees
          WHERE hire_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) AS hires_last_90_days
    `);
    const row = (result?.[0] ?? [])[0] as Record<string, number> | undefined;
    return {
      activeEmployees: Number(row?.active_employees ?? 0),
      employeesOnLeave: Number(row?.employees_on_leave ?? 0),
      activeDepartments: Number(row?.active_departments ?? 0),
      openLeaveRequests: Number(row?.open_leave_requests ?? 0),
      timesheetsAwaitingApproval: Number(row?.timesheets_awaiting_approval ?? 0),
      hiresLast90Days: Number(row?.hires_last_90_days ?? 0),
    };
  },

  /** Headcount by department for the dashboard bar chart. */
  headcountByDepartment(): Promise<Array<{ id: number; code: string; name: string; headcount: number | string }>> {
    return db('departments as d')
      .select('d.id', 'd.code', 'd.name')
      .count({ headcount: 'e.id' })
      .leftJoin('employees as e', function joinActive() {
        this.on('e.department_id', '=', 'd.id').andOn(db.raw("e.status <> 'TERMINATED'"));
      })
      .where('d.is_active', true)
      .groupBy('d.id', 'd.code', 'd.name')
      .orderBy('headcount', 'desc') as unknown as Promise<
      Array<{ id: number; code: string; name: string; headcount: number | string }>
    >;
  },

  /** Approved absences starting within the next fortnight. */
  upcomingAbsences(employeeIds?: number[]) {
    const query = db('leave_requests as lr')
      .select('lr.id', 'lr.start_date', 'lr.end_date', 'lr.total_days', 'lr.status')
      .select(db.raw("CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name"))
      .select('lt.name as leave_type_name', 'lt.color_hex')
      .join('employees as e', 'e.id', 'lr.employee_id')
      .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
      .whereIn('lr.status', ['APPROVED', 'MANAGER_APPROVED'])
      .whereBetween('lr.start_date', [
        db.raw('CURDATE()'),
        db.raw('DATE_ADD(CURDATE(), INTERVAL 14 DAY)'),
      ])
      .orderBy('lr.start_date', 'asc')
      .limit(10);

    if (employeeIds?.length) query.whereIn('lr.employee_id', employeeIds);
    return query;
  },

  /** Leave volume for the trailing six months, for the trend sparkline. */
  leaveTrend(): Promise<Array<{ month: string; requests: number | string; days: number | string | null }>> {
    return db('leave_requests')
      .select(db.raw("DATE_FORMAT(start_date, '%Y-%m') AS month"))
      .count({ requests: 'id' })
      .sum({ days: 'total_days' })
      .where('start_date', '>=', db.raw('DATE_SUB(CURDATE(), INTERVAL 6 MONTH)'))
      .whereIn('status', ['APPROVED', 'MANAGER_APPROVED', 'PENDING'])
      .groupByRaw("DATE_FORMAT(start_date, '%Y-%m')")
      .orderBy('month', 'asc') as unknown as Promise<
      Array<{ month: string; requests: number | string; days: number | string | null }>
    >;
  },

  async pendingApprovalsFor(employeeId: number): Promise<number> {
    const row = await db('leave_requests')
      .where('current_approver_id', employeeId)
      .whereIn('status', ['PENDING', 'MANAGER_APPROVED'])
      .count<{ total: number }>({ total: 'id' })
      .first();
    return Number(row?.total ?? 0);
  },
};
