import type { Knex } from 'knex';
import { db } from '@config/knex';
import { buildPage, parseSort, type Paginated, type PaginationParams } from '@utils/paginate';
import { BLOCKING_STATUSES } from './leave.state';
import type { ApprovalStage, LeaveStatus } from '@/types';
import type { ListLeaveQuery } from './leave.schema';

export interface LeaveRequestRow {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  avatar_url: string | null;
  department_name: string | null;
  leave_type_id: number;
  leave_type_name: string;
  leave_type_code: string;
  color_hex: string;
  start_date: string;
  end_date: string;
  total_days: string;
  half_day: number | boolean;
  reason: string;
  status: LeaveStatus;
  current_approver_id: number | null;
  current_approver_name: string | null;
  submitted_at: Date;
  decided_at: Date | null;
}

export interface LeaveBalanceRow {
  leave_type_id: number;
  code: string;
  name: string;
  color_hex: string;
  year: number;
  entitled_days: string;
  used_days: string;
  pending_days: string;
  carried_over_days: string;
}

export interface LeaveApprovalRow {
  id: number;
  stage: ApprovalStage;
  decision: 'APPROVED' | 'REJECTED';
  comments: string | null;
  decided_at: Date;
  approver_name: string;
}

const SORTABLE = ['start_date', 'submitted_at', 'total_days', 'status'] as const;

function selectRequests(trx: Knex | Knex.Transaction = db) {
  return trx('leave_requests as lr')
    .select(
      'lr.id',
      'lr.employee_id',
      'lr.leave_type_id',
      'lr.start_date',
      'lr.end_date',
      'lr.total_days',
      'lr.half_day',
      'lr.reason',
      'lr.status',
      'lr.current_approver_id',
      'lr.submitted_at',
      'lr.decided_at',
    )
    .select(trx.raw("CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name"))
    .select(trx.ref('e.employee_code').as('employee_code'))
    .select(trx.ref('e.avatar_url').as('avatar_url'))
    .select(trx.ref('d.name').as('department_name'))
    .select(trx.ref('lt.name').as('leave_type_name'))
    .select(trx.ref('lt.code').as('leave_type_code'))
    .select(trx.ref('lt.color_hex').as('color_hex'))
    .select(trx.raw("CONCAT_WS(' ', a.first_name, a.last_name) AS current_approver_name"))
    .join('employees as e', 'e.id', 'lr.employee_id')
    .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('employees as a', 'a.id', 'lr.current_approver_id');
}

function applyFilters(query: Knex.QueryBuilder, filters: ListLeaveQuery): Knex.QueryBuilder {
  if (filters.status) query.where('lr.status', filters.status);
  if (filters.leaveTypeId) query.where('lr.leave_type_id', filters.leaveTypeId);
  if (filters.employeeId) query.where('lr.employee_id', filters.employeeId);
  // Range overlap, not containment: a request that straddles the window edge is
  // still relevant to the caller.
  if (filters.from) query.where('lr.end_date', '>=', filters.from);
  if (filters.to) query.where('lr.start_date', '<=', filters.to);
  return query;
}

export const leaveRepository = {
  listLeaveTypes() {
    return db('leave_types')
      .select('id', 'code', 'name', 'default_annual_days', 'requires_attachment', 'is_paid', 'color_hex')
      .where('is_active', true)
      .orderBy('name', 'asc');
  },

  findLeaveType(id: number) {
    return db('leave_types').where({ id, is_active: true }).first();
  },

  async search(
    filters: ListLeaveQuery,
    pagination: PaginationParams,
    scope?: { employeeIds?: number[]; approverId?: number },
  ): Promise<Paginated<LeaveRequestRow>> {
    const sort = parseSort(filters as Record<string, unknown>, SORTABLE, 'start_date');

    const scoped = (query: Knex.QueryBuilder): Knex.QueryBuilder => {
      if (scope?.employeeIds) query.whereIn('lr.employee_id', scope.employeeIds);
      if (scope?.approverId) query.where('lr.current_approver_id', scope.approverId);
      return query;
    };

    const countRow = await scoped(applyFilters(db('leave_requests as lr'), filters))
      .count<{ total: number }>({ total: 'lr.id' })
      .first();

    const rows = await scoped(applyFilters(selectRequests(), filters))
      .orderBy(`lr.${sort.column}`, sort.direction)
      .orderBy('lr.id', 'desc')
      .limit(pagination.limit)
      .offset(pagination.offset);

    return buildPage(rows as LeaveRequestRow[], Number(countRow?.total ?? 0), pagination);
  },

  findById(id: number, trx?: Knex.Transaction): Promise<LeaveRequestRow | undefined> {
    return selectRequests(trx ?? db).where('lr.id', id).first<LeaveRequestRow | undefined>();
  },

  /**
   * Overlap detection.
   *
   * Two closed intervals overlap when `existing.start <= new.end` AND
   * `existing.end >= new.start` — one comparison pair instead of enumerating
   * four cases. Restricted to blocking statuses so a previously rejected or
   * cancelled request never stands in the way of a resubmission, and served by
   * idx_leave_requests_employee_range.
   */
  async findOverlapping(
    employeeId: number,
    startDate: string,
    endDate: string,
    excludeRequestId?: number,
    trx?: Knex.Transaction,
  ): Promise<LeaveRequestRow[]> {
    const query = selectRequests(trx ?? db)
      .where('lr.employee_id', employeeId)
      .whereIn('lr.status', BLOCKING_STATUSES as unknown as string[])
      .where('lr.start_date', '<=', endDate)
      .where('lr.end_date', '>=', startDate);

    if (excludeRequestId) query.whereNot('lr.id', excludeRequestId);
    return (await query) as LeaveRequestRow[];
  },

  async create(payload: Record<string, unknown>, trx: Knex.Transaction): Promise<number> {
    const [id] = await trx('leave_requests').insert(payload);
    return id as number;
  },

  async updateStatus(
    id: number,
    payload: Record<string, unknown>,
    trx: Knex.Transaction,
  ): Promise<number> {
    return trx('leave_requests').where('id', id).update(payload);
  },

  async recordApproval(payload: Record<string, unknown>, trx: Knex.Transaction): Promise<void> {
    await trx('leave_approvals').insert(payload);
  },

  approvalTrail(requestId: number): Promise<LeaveApprovalRow[]> {
    return db('leave_approvals as la')
      .select('la.id', 'la.stage', 'la.decision', 'la.comments', 'la.decided_at')
      .select(db.raw("CONCAT_WS(' ', e.first_name, e.last_name) AS approver_name"))
      .join('employees as e', 'e.id', 'la.approver_id')
      .where('la.leave_request_id', requestId)
      .orderBy('la.decided_at', 'asc') as Promise<LeaveApprovalRow[]>;
  },

  balances(employeeId: number, year: number): Promise<LeaveBalanceRow[]> {
    return db('leave_balances as lb')
      .select(
        'lb.leave_type_id',
        'lb.year',
        'lb.entitled_days',
        'lb.used_days',
        'lb.pending_days',
        'lb.carried_over_days',
      )
      .select('lt.code', 'lt.name', 'lt.color_hex')
      .join('leave_types as lt', 'lt.id', 'lb.leave_type_id')
      .where('lb.employee_id', employeeId)
      .where('lb.year', year)
      .orderBy('lt.name', 'asc') as Promise<LeaveBalanceRow[]>;
  },

  /**
   * Locks the balance row for the duration of the transaction.
   *
   * Without `FOR UPDATE`, two requests submitted at the same instant could both
   * read the same remaining balance and both pass the check. The lock serialises
   * them so the second one sees the first one's reservation.
   */
  async lockBalance(
    employeeId: number,
    leaveTypeId: number,
    year: number,
    trx: Knex.Transaction,
  ): Promise<
    | { id: number; entitled_days: string; used_days: string; pending_days: string; carried_over_days: string }
    | undefined
  > {
    return trx('leave_balances')
      .select('id', 'entitled_days', 'used_days', 'pending_days', 'carried_over_days')
      .where({ employee_id: employeeId, leave_type_id: leaveTypeId, year })
      .forUpdate()
      .first();
  },

  async ensureBalanceRow(
    employeeId: number,
    leaveTypeId: number,
    year: number,
    entitledDays: number,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx('leave_balances')
      .insert({
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        year,
        entitled_days: entitledDays,
      })
      .onConflict(['employee_id', 'leave_type_id', 'year'])
      .ignore();
  },

  async adjustBalance(
    balanceId: number,
    deltas: { pending?: number; used?: number },
    trx: Knex.Transaction,
  ): Promise<void> {
    const query = trx('leave_balances').where('id', balanceId);
    if (deltas.pending) query.increment('pending_days', deltas.pending);
    if (deltas.used) query.increment('used_days', deltas.used);
    await query;
  },

  /** Calendar view — deliberately narrow projection, no pagination. */
  calendar(range: { from: string; to: string }, employeeIds?: number[]) {
    const query = db('leave_requests as lr')
      .select('lr.id', 'lr.employee_id', 'lr.start_date', 'lr.end_date', 'lr.status', 'lr.half_day')
      .select(db.raw("CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name"))
      .select('lt.code as leave_type_code', 'lt.name as leave_type_name', 'lt.color_hex')
      .join('employees as e', 'e.id', 'lr.employee_id')
      .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
      .whereIn('lr.status', ['PENDING', 'MANAGER_APPROVED', 'APPROVED'])
      .where('lr.start_date', '<=', range.to)
      .where('lr.end_date', '>=', range.from)
      .orderBy('lr.start_date', 'asc');

    if (employeeIds) query.whereIn('lr.employee_id', employeeIds);
    return query;
  },

  /**
   * Resolves the People Operations approver for the HR stage. Picks the most
   * senior active HR account deterministically (lowest employee id) so the
   * inbox does not shuffle between requests.
   */
  async findHrApproverId(): Promise<number | null> {
    const row = await db('employees as e')
      .select('e.id')
      .join('users as u', 'u.id', 'e.user_id')
      .whereIn('u.role', ['HR_ADMIN', 'SUPER_ADMIN'])
      .where('u.is_active', true)
      .where('e.status', 'ACTIVE')
      .orderBy('e.id', 'asc')
      .first();
    return (row?.id as number | undefined) ?? null;
  },

  async countPendingFor(approverId: number): Promise<number> {
    const row = await db('leave_requests')
      .where('current_approver_id', approverId)
      .whereIn('status', ['PENDING', 'MANAGER_APPROVED'])
      .count<{ total: number }>({ total: 'id' })
      .first();
    return Number(row?.total ?? 0);
  },
};
