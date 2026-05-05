import type { Knex } from 'knex';
import { db } from '@config/knex';
import type { TimesheetStatus } from '@/types';

export interface TimesheetRow {
  id: number;
  employee_id: number;
  employee_name: string;
  week_start_date: string;
  status: TimesheetStatus;
  total_hours: string;
  approver_id: number | null;
  approver_comments: string | null;
  submitted_at: Date | null;
  approved_at: Date | null;
}

export interface TimesheetEntryRow {
  id: number;
  project_id: number;
  project_code: string;
  project_name: string;
  is_billable: number | boolean;
  work_date: string;
  hours: string;
  notes: string | null;
}

function selectTimesheets(trx: Knex | Knex.Transaction = db) {
  return trx('timesheets as ts')
    .select(
      'ts.id',
      'ts.employee_id',
      'ts.week_start_date',
      'ts.status',
      'ts.total_hours',
      'ts.approver_id',
      'ts.approver_comments',
      'ts.submitted_at',
      'ts.approved_at',
    )
    .select(trx.raw("CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name"))
    .join('employees as e', 'e.id', 'ts.employee_id');
}

export const timesheetsRepository = {
  listProjects() {
    return db('projects')
      .select('id', 'code', 'name', 'client_name', 'is_billable')
      .where('is_active', true)
      .orderBy('code', 'asc');
  },

  findWeek(employeeId: number, weekStart: string, trx?: Knex.Transaction): Promise<TimesheetRow | undefined> {
    return selectTimesheets(trx ?? db)
      .where('ts.employee_id', employeeId)
      .where('ts.week_start_date', weekStart)
      .first<TimesheetRow | undefined>();
  },

  findById(id: number, trx?: Knex.Transaction): Promise<TimesheetRow | undefined> {
    return selectTimesheets(trx ?? db).where('ts.id', id).first<TimesheetRow | undefined>();
  },

  entries(timesheetId: number): Promise<TimesheetEntryRow[]> {
    return db('timesheet_entries as te')
      .select('te.id', 'te.project_id', 'te.work_date', 'te.hours', 'te.notes')
      .select('p.code as project_code', 'p.name as project_name', 'p.is_billable')
      .join('projects as p', 'p.id', 'te.project_id')
      .where('te.timesheet_id', timesheetId)
      .orderBy(['te.work_date', 'p.code']) as Promise<TimesheetEntryRow[]>;
  },

  /** Creates the weekly envelope if it does not exist yet, then returns it. */
  async upsertWeek(
    employeeId: number,
    weekStart: string,
    trx: Knex.Transaction,
  ): Promise<TimesheetRow> {
    await trx('timesheets')
      .insert({ employee_id: employeeId, week_start_date: weekStart, status: 'DRAFT', total_hours: 0 })
      .onConflict(['employee_id', 'week_start_date'])
      .ignore();

    const row = await this.findWeek(employeeId, weekStart, trx);
    if (!row) throw new Error(`Timesheet for ${employeeId} / ${weekStart} could not be created`);
    return row;
  },

  /**
   * Whole-week replace.
   *
   * The grid editor sends the full week, so deleting and re-inserting is both
   * simpler and cheaper than diffing 35 cells — and it makes the save idempotent
   * on retry.
   */
  async replaceEntries(
    timesheetId: number,
    entries: Array<{ projectId: number; workDate: string; hours: number; notes?: string }>,
    trx: Knex.Transaction,
  ): Promise<number> {
    await trx('timesheet_entries').where('timesheet_id', timesheetId).delete();

    const billable = entries.filter((entry) => entry.hours > 0);
    if (billable.length) {
      await trx('timesheet_entries').insert(
        billable.map((entry) => ({
          timesheet_id: timesheetId,
          project_id: entry.projectId,
          work_date: entry.workDate,
          hours: entry.hours,
          notes: entry.notes ?? null,
        })),
      );
    }

    const total = billable.reduce((sum, entry) => sum + entry.hours, 0);
    await trx('timesheets').where('id', timesheetId).update({ total_hours: total });
    return total;
  },

  async updateStatus(
    id: number,
    payload: Record<string, unknown>,
    trx?: Knex.Transaction,
  ): Promise<number> {
    return (trx ?? db)('timesheets').where('id', id).update(payload);
  },

  pendingForApprover(employeeIds: number[]): Promise<TimesheetRow[]> {
    return selectTimesheets()
      .whereIn('ts.employee_id', employeeIds)
      .where('ts.status', 'SUBMITTED')
      .orderBy('ts.week_start_date', 'desc') as Promise<TimesheetRow[]>;
  },

  allPending(): Promise<TimesheetRow[]> {
    return selectTimesheets()
      .where('ts.status', 'SUBMITTED')
      .orderBy('ts.week_start_date', 'desc') as Promise<TimesheetRow[]>;
  },

  /**
   * Aggregation for the utilisation report. Grouping happens in MySQL — pulling
   * every entry into Node and reducing there would move megabytes for a handful
   * of numbers.
   */
  summary(filters: { from: string; to: string; employeeId?: number; projectId?: number }): Promise<
    Array<{ project_id: number; project_code: string; project_name: string; is_billable: number | boolean; total_hours: number | string; entry_count: number | string }>
  > {
    const query = db('timesheet_entries as te')
      .select('p.id as project_id', 'p.code as project_code', 'p.name as project_name', 'p.is_billable')
      .sum({ total_hours: 'te.hours' })
      .count({ entry_count: 'te.id' })
      .join('projects as p', 'p.id', 'te.project_id')
      .join('timesheets as ts', 'ts.id', 'te.timesheet_id')
      .whereBetween('te.work_date', [filters.from, filters.to])
      .groupBy('p.id', 'p.code', 'p.name', 'p.is_billable')
      .orderBy('total_hours', 'desc');

    if (filters.employeeId) query.where('ts.employee_id', filters.employeeId);
    if (filters.projectId) query.where('te.project_id', filters.projectId);
    return query as unknown as Promise<
      Array<{ project_id: number; project_code: string; project_name: string; is_billable: number | boolean; total_hours: number | string; entry_count: number | string }>
    >;
  },

  async hoursThisWeek(employeeId: number, weekStart: string): Promise<number> {
    const row = await db('timesheets')
      .select('total_hours')
      .where({ employee_id: employeeId, week_start_date: weekStart })
      .first();
    return Number(row?.total_hours ?? 0);
  },
};
