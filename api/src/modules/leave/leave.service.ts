import dayjs from 'dayjs';
import { db } from '@config/knex';
import { ApiError } from '@utils/ApiError';
import { recordAudit } from '@utils/audit';
import { logger } from '@utils/logger';
import { parsePagination, type Paginated } from '@utils/paginate';
import { employeesRepository } from '@modules/employees/employees.repository';
import { leaveRepository, type LeaveBalanceRow, type LeaveRequestRow } from './leave.repository';
import {
  assertTransition,
  stageForStatus,
  type LeaveAction,
} from './leave.state';
import type {
  CalendarQuery,
  CreateLeaveRequestInput,
  DecisionInput,
  ListLeaveQuery,
} from './leave.schema';
import type { AuthenticatedUser } from '@/types/express';
import { isHrOrAbove } from '@/types/roles';
import type { LeaveStatus } from '@/types';

export interface LeaveRequestDto {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  avatarUrl: string | null;
  departmentName: string | null;
  leaveTypeId: number;
  leaveTypeName: string;
  leaveTypeCode: string;
  colorHex: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  halfDay: boolean;
  reason: string;
  status: LeaveStatus;
  currentApproverId: number | null;
  currentApproverName: string | null;
  submittedAt: string;
  decidedAt: string | null;
}

export interface LeaveBalanceDto {
  leaveTypeId: number;
  code: string;
  name: string;
  colorHex: string;
  year: number;
  entitledDays: number;
  carriedOverDays: number;
  usedDays: number;
  pendingDays: number;
  availableDays: number;
}

function toRequestDto(row: LeaveRequestRow): LeaveRequestDto {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeCode: row.employee_code,
    avatarUrl: row.avatar_url,
    departmentName: row.department_name,
    leaveTypeId: row.leave_type_id,
    leaveTypeName: row.leave_type_name,
    leaveTypeCode: row.leave_type_code,
    colorHex: row.color_hex,
    startDate: row.start_date,
    endDate: row.end_date,
    totalDays: Number(row.total_days),
    halfDay: Boolean(row.half_day),
    reason: row.reason,
    status: row.status,
    currentApproverId: row.current_approver_id,
    currentApproverName: row.current_approver_name?.trim() || null,
    submittedAt: new Date(row.submitted_at).toISOString(),
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
  };
}

function toBalanceDto(row: LeaveBalanceRow): LeaveBalanceDto {
  const entitled = Number(row.entitled_days);
  const carried = Number(row.carried_over_days);
  const used = Number(row.used_days);
  const pending = Number(row.pending_days);
  return {
    leaveTypeId: row.leave_type_id,
    code: row.code,
    name: row.name,
    colorHex: row.color_hex,
    year: row.year,
    entitledDays: entitled,
    carriedOverDays: carried,
    usedDays: used,
    pendingDays: pending,
    // In-flight requests are subtracted too, so the UI never shows days the
    // employee has effectively already spent.
    availableDays: Number((entitled + carried - used - pending).toFixed(1)),
  };
}

/**
 * Counts chargeable days between two dates.
 *
 * Weekends are excluded (Sat/Sun), and a half day is worth 0.5. Public holidays
 * would be a `company_holidays` lookup here; the function is pure so that rule
 * can be added and unit-tested without touching the database.
 */
export function calculateLeaveDays(startDate: string, endDate: string, halfDay = false): number {
  const start = dayjs(startDate);
  const end = dayjs(endDate);

  if (!start.isValid() || !end.isValid()) {
    throw ApiError.badRequest('Invalid leave dates');
  }
  if (end.isBefore(start, 'day')) {
    throw ApiError.badRequest('End date must be on or after the start date');
  }
  if (halfDay) {
    if (!start.isSame(end, 'day')) {
      throw ApiError.badRequest('A half day must start and end on the same date');
    }
    return 0.5;
  }

  let chargeable = 0;
  for (let cursor = start; !cursor.isAfter(end, 'day'); cursor = cursor.add(1, 'day')) {
    const weekday = cursor.day(); // 0 = Sunday, 6 = Saturday
    if (weekday !== 0 && weekday !== 6) chargeable += 1;
  }
  return chargeable;
}

/** Pure balance check — extracted so the arithmetic is unit-tested in isolation. */
export function assertSufficientBalance(
  balance: { entitled: number; carried: number; used: number; pending: number },
  requestedDays: number,
  leaveTypeName: string,
): void {
  const available = balance.entitled + balance.carried - balance.used - balance.pending;
  if (requestedDays > available) {
    throw ApiError.unprocessable(
      `Insufficient ${leaveTypeName} balance: ${requestedDays} day(s) requested, ${available} available`,
      [
        { field: 'totalDays', message: `Requested: ${requestedDays}` },
        { field: 'availableDays', message: `Available: ${available}` },
      ],
    );
  }
}

async function assertCanSeeRequest(actor: AuthenticatedUser, row: LeaveRequestRow): Promise<void> {
  if (isHrOrAbove(actor.role)) return;
  if (actor.employeeId === row.employee_id) return;

  if (actor.role === 'MANAGER' && actor.employeeId) {
    const inLine = await employeesRepository.isInReportingLine(actor.employeeId, row.employee_id);
    if (inLine) return;
  }
  throw ApiError.forbidden('This leave request belongs to someone outside your reporting line');
}

export const leaveService = {
  listLeaveTypes() {
    return leaveRepository.listLeaveTypes();
  },

  async listMyRequests(actor: AuthenticatedUser, filters: ListLeaveQuery): Promise<Paginated<LeaveRequestDto>> {
    if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');
    const pagination = parsePagination(filters as Record<string, unknown>);
    const page = await leaveRepository.search({ ...filters, employeeId: actor.employeeId }, pagination);
    return { data: page.data.map(toRequestDto), meta: page.meta };
  },

  /**
   * Approvals inbox.
   *
   * HR sees every request awaiting the HR stage plus anything they are named on;
   * a manager sees only requests routed to them. Scoping happens in SQL rather
   * than by filtering in memory so pagination totals stay correct.
   */
  async listForApproval(
    actor: AuthenticatedUser,
    filters: ListLeaveQuery,
  ): Promise<Paginated<LeaveRequestDto>> {
    if (!actor.employeeId) throw ApiError.forbidden('Only employees with a profile can approve leave');
    const pagination = parsePagination(filters as Record<string, unknown>);

    if (isHrOrAbove(actor.role)) {
      const page = await leaveRepository.search(
        { ...filters, status: filters.status ?? 'MANAGER_APPROVED' },
        pagination,
      );
      return { data: page.data.map(toRequestDto), meta: page.meta };
    }

    const page = await leaveRepository.search(filters, pagination, { approverId: actor.employeeId });
    return { data: page.data.map(toRequestDto), meta: page.meta };
  },

  async listTeamRequests(
    actor: AuthenticatedUser,
    filters: ListLeaveQuery,
  ): Promise<Paginated<LeaveRequestDto>> {
    if (!actor.employeeId) throw ApiError.forbidden('No employee profile on this account');
    const reports = await employeesRepository.listDirectReports(actor.employeeId);
    const employeeIds = reports.map((report) => report.id);

    if (!employeeIds.length) {
      return { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasPrevious: false, hasNext: false } };
    }

    const pagination = parsePagination(filters as Record<string, unknown>);
    const page = await leaveRepository.search(filters, pagination, { employeeIds });
    return { data: page.data.map(toRequestDto), meta: page.meta };
  },

  async getById(actor: AuthenticatedUser, id: number) {
    const row = await leaveRepository.findById(id);
    if (!row) throw ApiError.notFound('Leave request');
    await assertCanSeeRequest(actor, row);

    const trail = await leaveRepository.approvalTrail(id);
    return {
      request: toRequestDto(row),
      approvals: trail.map((entry) => ({
        id: entry.id,
        stage: entry.stage,
        decision: entry.decision,
        comments: entry.comments,
        approverName: entry.approver_name,
        decidedAt: new Date(entry.decided_at).toISOString(),
      })),
    };
  },

  async getBalances(
    actor: AuthenticatedUser,
    employeeId?: number,
    year = dayjs().year(),
  ): Promise<LeaveBalanceDto[]> {
    const target = employeeId ?? actor.employeeId;
    if (!target) throw ApiError.notFound('Employee profile for this account');

    if (target !== actor.employeeId && !isHrOrAbove(actor.role)) {
      if (actor.role !== 'MANAGER' || !actor.employeeId) {
        throw ApiError.forbidden("You cannot view another employee's balances");
      }
      const isReport = await employeesRepository.isInReportingLine(actor.employeeId, target);
      if (!isReport) throw ApiError.forbidden("You cannot view another employee's balances");
    }

    const rows = await leaveRepository.balances(target, year);
    return rows.map(toBalanceDto);
  },

  /**
   * Submit a new request.
   *
   * Everything that must hold together — overlap check, balance lock, insert,
   * reservation — runs in one transaction with the balance row locked
   * `FOR UPDATE`, so two concurrent submissions cannot both consume the last
   * remaining day.
   */
  async submit(actor: AuthenticatedUser, input: CreateLeaveRequestInput): Promise<LeaveRequestDto> {
    if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');
    const employeeId = actor.employeeId;

    const leaveType = await leaveRepository.findLeaveType(input.leaveTypeId);
    if (!leaveType) throw ApiError.badRequest('Unknown or inactive leave type');

    const totalDays = calculateLeaveDays(input.startDate, input.endDate, input.halfDay);
    if (totalDays === 0) {
      throw ApiError.badRequest('The selected range contains no working days');
    }

    const employee = await employeesRepository.findById(employeeId);
    if (!employee) throw ApiError.notFound('Employee');

    // Route to the line manager; employees without one (executives) go straight
    // to People Operations.
    const managerId = employee.manager_id;
    const hrApproverId = await leaveRepository.findHrApproverId();
    const firstApprover = managerId ?? hrApproverId;
    if (!firstApprover) {
      throw ApiError.internal('No approver is configured for this organisation');
    }
    const initialStatus: LeaveStatus = managerId ? 'PENDING' : 'MANAGER_APPROVED';

    const year = dayjs(input.startDate).year();

    const requestId = await db.transaction(async (trx) => {
      const overlaps = await leaveRepository.findOverlapping(
        employeeId,
        input.startDate,
        input.endDate,
        undefined,
        trx,
      );
      if (overlaps.length) {
        const clash = overlaps[0];
        throw ApiError.conflict(
          `This range overlaps an existing ${clash.status} request (${clash.start_date} to ${clash.end_date})`,
          [{ field: 'startDate', message: `Conflicting request #${clash.id}` }],
        );
      }

      await leaveRepository.ensureBalanceRow(
        employeeId,
        input.leaveTypeId,
        year,
        Number(leaveType.default_annual_days ?? 0),
        trx,
      );

      const balance = await leaveRepository.lockBalance(employeeId, input.leaveTypeId, year, trx);
      if (!balance) throw ApiError.internal('Leave balance row could not be initialised');

      // Unpaid leave has no entitlement, so the balance gate does not apply.
      if (leaveType.is_paid) {
        assertSufficientBalance(
          {
            entitled: Number(balance.entitled_days),
            carried: Number(balance.carried_over_days),
            used: Number(balance.used_days),
            pending: Number(balance.pending_days),
          },
          totalDays,
          leaveType.name as string,
        );
      }

      const id = await leaveRepository.create(
        {
          employee_id: employeeId,
          leave_type_id: input.leaveTypeId,
          start_date: input.startDate,
          end_date: input.endDate,
          total_days: totalDays,
          half_day: input.halfDay,
          reason: input.reason,
          status: initialStatus,
          current_approver_id: firstApprover,
        },
        trx,
      );

      await leaveRepository.adjustBalance(balance.id, { pending: totalDays }, trx);
      return id;
    });

    logger.info('Leave request submitted', {
      requestId,
      employeeId,
      totalDays,
      status: initialStatus,
    });
    await recordAudit({
      actorUserId: actor.userId,
      action: 'LEAVE_SUBMITTED',
      entityType: 'leave_request',
      entityId: requestId,
      metadata: { totalDays, leaveType: leaveType.code, status: initialStatus },
    });

    const created = await leaveRepository.findById(requestId);
    return toRequestDto(created!);
  },

  /**
   * Manager or HR decision.
   *
   * The action is derived from the *current* status, then validated by the
   * transition guard. Balance bookkeeping mirrors the state change: an HR
   * approval converts reserved days into used days; any rejection releases the
   * reservation.
   */
  async decide(actor: AuthenticatedUser, id: number, input: DecisionInput): Promise<LeaveRequestDto> {
    if (!actor.employeeId) throw ApiError.forbidden('Only employees with a profile can approve leave');

    const row = await leaveRepository.findById(id);
    if (!row) throw ApiError.notFound('Leave request');

    if (row.employee_id === actor.employeeId) {
      throw ApiError.forbidden('You cannot approve your own leave request');
    }

    const stage = stageForStatus(row.status);
    const action: LeaveAction =
      stage === 'MANAGER'
        ? input.decision === 'APPROVED'
          ? 'MANAGER_APPROVE'
          : 'MANAGER_REJECT'
        : input.decision === 'APPROVED'
          ? 'HR_APPROVE'
          : 'HR_REJECT';

    const nextStatus = assertTransition(action, row.status, actor.role);

    // Row-level authority: at the manager stage the actor must own the request
    // (be the named approver or sit above the employee); HR is unrestricted.
    if (stage === 'MANAGER' && !isHrOrAbove(actor.role)) {
      const isNamedApprover = row.current_approver_id === actor.employeeId;
      const inLine = await employeesRepository.isInReportingLine(actor.employeeId, row.employee_id);
      if (!isNamedApprover && !inLine) {
        throw ApiError.forbidden('You may only decide leave for your own direct reports');
      }
    }

    const year = dayjs(row.start_date).year();
    const totalDays = Number(row.total_days);
    const hrApproverId = await leaveRepository.findHrApproverId();

    await db.transaction(async (trx) => {
      // Re-read inside the transaction: another approver may have acted between
      // the guard above and this write.
      const fresh = await leaveRepository.findById(id, trx);
      if (!fresh || fresh.status !== row.status) {
        throw ApiError.conflict('This request was updated by someone else — reload and try again');
      }

      await leaveRepository.updateStatus(
        id,
        {
          status: nextStatus,
          current_approver_id: nextStatus === 'MANAGER_APPROVED' ? hrApproverId : null,
          decided_at: nextStatus === 'MANAGER_APPROVED' ? null : trx.fn.now(),
        },
        trx,
      );

      await leaveRepository.recordApproval(
        {
          leave_request_id: id,
          approver_id: actor.employeeId,
          stage,
          decision: input.decision,
          comments: input.comments ?? null,
        },
        trx,
      );

      const balance = await leaveRepository.lockBalance(row.employee_id, row.leave_type_id, year, trx);
      if (balance) {
        if (nextStatus === 'APPROVED') {
          await leaveRepository.adjustBalance(
            balance.id,
            { pending: -totalDays, used: totalDays },
            trx,
          );
        } else if (nextStatus === 'REJECTED') {
          await leaveRepository.adjustBalance(balance.id, { pending: -totalDays }, trx);
        }
      }
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: `LEAVE_${stage}_${input.decision}`,
      entityType: 'leave_request',
      entityId: id,
      metadata: { from: row.status, to: nextStatus, comments: input.comments ?? null },
    });

    const updated = await leaveRepository.findById(id);
    return toRequestDto(updated!);
  },

  /** Withdrawal by the requester, or cancellation of an approved absence by HR. */
  async cancel(actor: AuthenticatedUser, id: number, reason?: string): Promise<LeaveRequestDto> {
    const row = await leaveRepository.findById(id);
    if (!row) throw ApiError.notFound('Leave request');

    const isOwner = actor.employeeId === row.employee_id;
    if (!isOwner && !isHrOrAbove(actor.role)) {
      throw ApiError.forbidden('Only the requester or People Operations can cancel a request');
    }
    if (isOwner && row.status === 'APPROVED' && !isHrOrAbove(actor.role)) {
      throw ApiError.forbidden('Approved leave can only be cancelled by People Operations');
    }

    assertTransition('CANCEL', row.status, actor.role);

    const year = dayjs(row.start_date).year();
    const totalDays = Number(row.total_days);
    const wasApproved = row.status === 'APPROVED';

    await db.transaction(async (trx) => {
      await leaveRepository.updateStatus(
        id,
        { status: 'CANCELLED', current_approver_id: null, decided_at: trx.fn.now() },
        trx,
      );

      const balance = await leaveRepository.lockBalance(row.employee_id, row.leave_type_id, year, trx);
      if (balance) {
        await leaveRepository.adjustBalance(
          balance.id,
          wasApproved ? { used: -totalDays } : { pending: -totalDays },
          trx,
        );
      }
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: 'LEAVE_CANCELLED',
      entityType: 'leave_request',
      entityId: id,
      metadata: { from: row.status, reason: reason ?? null },
    });

    const updated = await leaveRepository.findById(id);
    return toRequestDto(updated!);
  },

  /** Calendar feed for the month/quarter views. */
  async calendar(actor: AuthenticatedUser, query: CalendarQuery) {
    let employeeIds: number[] | undefined;

    if (query.scope === 'ME') {
      if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');
      employeeIds = [actor.employeeId];
    } else if (query.scope === 'TEAM') {
      if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');
      const reports = await employeesRepository.listDirectReports(actor.employeeId);
      employeeIds = [actor.employeeId, ...reports.map((report) => report.id)];
    } else if (!isHrOrAbove(actor.role)) {
      throw ApiError.forbidden('Company-wide calendar is limited to People Operations');
    }

    const rows = await leaveRepository.calendar({ from: query.from, to: query.to }, employeeIds);

    return rows.map((row) => ({
      id: row.id as number,
      employeeId: row.employee_id as number,
      employeeName: row.employee_name as string,
      startDate: row.start_date as string,
      endDate: row.end_date as string,
      status: row.status as LeaveStatus,
      halfDay: Boolean(row.half_day),
      leaveTypeCode: row.leave_type_code as string,
      leaveTypeName: row.leave_type_name as string,
      colorHex: row.color_hex as string,
    }));
  },
};
