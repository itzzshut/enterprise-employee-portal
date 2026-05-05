import dayjs from 'dayjs';
import { db } from '@config/knex';
import { ApiError } from '@utils/ApiError';
import { recordAudit } from '@utils/audit';
import { employeesRepository } from '@modules/employees/employees.repository';
import { timesheetsRepository, type TimesheetRow } from './timesheets.repository';
import type { SaveWeekInput, SummaryQuery, TimesheetDecisionInput } from './timesheets.schema';
import type { AuthenticatedUser } from '@/types/express';
import { isHrOrAbove } from '@/types/roles';
import type { TimesheetStatus } from '@/types';

/**
 * Timesheet lifecycle:
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED  (terminal)
 *                          └────reject────▶ REJECTED ──edit──▶ DRAFT
 * A rejected week becomes editable again, which is why REJECTED is the only
 * terminal-looking state that can go backwards.
 */
const EDITABLE: readonly TimesheetStatus[] = ['DRAFT', 'REJECTED'];

export interface TimesheetWeekDto {
  id: number | null;
  employeeId: number;
  employeeName: string | null;
  weekStart: string;
  weekEnd: string;
  status: TimesheetStatus;
  totalHours: number;
  editable: boolean;
  approverComments: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  entries: Array<{
    projectId: number;
    projectCode: string;
    projectName: string;
    billable: boolean;
    workDate: string;
    hours: number;
    notes: string | null;
  }>;
}

function toWeekDto(row: TimesheetRow, entries: TimesheetWeekDto['entries']): TimesheetWeekDto {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    weekStart: row.week_start_date,
    weekEnd: dayjs(row.week_start_date).add(6, 'day').format('YYYY-MM-DD'),
    status: row.status,
    totalHours: Number(row.total_hours),
    editable: EDITABLE.includes(row.status),
    approverComments: row.approver_comments,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    entries,
  };
}

async function resolveTarget(actor: AuthenticatedUser, employeeId?: number): Promise<number> {
  if (!employeeId || employeeId === actor.employeeId) {
    if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');
    return actor.employeeId;
  }
  if (isHrOrAbove(actor.role)) return employeeId;

  if (actor.role === 'MANAGER' && actor.employeeId) {
    const isReport = await employeesRepository.isDirectReport(actor.employeeId, employeeId);
    if (isReport) return employeeId;
  }
  throw ApiError.forbidden("You may only view your own team's timesheets");
}

export const timesheetsService = {
  listProjects() {
    return timesheetsRepository.listProjects();
  },

  async getWeek(
    actor: AuthenticatedUser,
    weekStart: string,
    employeeId?: number,
  ): Promise<TimesheetWeekDto> {
    const target = await resolveTarget(actor, employeeId);
    const row = await timesheetsRepository.findWeek(target, weekStart);

    if (!row) {
      // An untouched week is a valid, empty draft — the grid renders the same
      // either way, so the API returns a synthetic envelope instead of a 404.
      const employee = await employeesRepository.findById(target);
      return {
        id: null,
        employeeId: target,
        employeeName: employee ? `${employee.first_name} ${employee.last_name}` : null,
        weekStart,
        weekEnd: dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD'),
        status: 'DRAFT',
        totalHours: 0,
        editable: true,
        approverComments: null,
        submittedAt: null,
        approvedAt: null,
        entries: [],
      };
    }

    const entries = await timesheetsRepository.entries(row.id);
    return toWeekDto(
      row,
      entries.map((entry) => ({
        projectId: entry.project_id,
        projectCode: entry.project_code,
        projectName: entry.project_name,
        billable: Boolean(entry.is_billable),
        workDate: entry.work_date,
        hours: Number(entry.hours),
        notes: entry.notes,
      })),
    );
  },

  /** Saves the whole grid as a draft. Submitted or approved weeks are locked. */
  async saveWeek(actor: AuthenticatedUser, input: SaveWeekInput): Promise<TimesheetWeekDto> {
    if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');
    const employeeId = actor.employeeId;

    if (dayjs(input.weekStart).isAfter(dayjs().add(7, 'day'))) {
      throw ApiError.badRequest('Timesheets cannot be filled in more than a week ahead');
    }

    const projects = await timesheetsRepository.listProjects();
    const activeProjectIds = new Set(projects.map((project) => project.id as number));
    const unknown = input.entries.find((entry) => !activeProjectIds.has(entry.projectId));
    if (unknown) {
      throw ApiError.badRequest(`Project ${unknown.projectId} is not active or does not exist`);
    }

    await db.transaction(async (trx) => {
      const sheet = await timesheetsRepository.upsertWeek(employeeId, input.weekStart, trx);
      if (!EDITABLE.includes(sheet.status)) {
        throw ApiError.conflict(`Week ${input.weekStart} is ${sheet.status} and can no longer be edited`);
      }
      await timesheetsRepository.replaceEntries(sheet.id, input.entries, trx);
      // Re-editing a rejected week puts it back into draft.
      if (sheet.status === 'REJECTED') {
        await timesheetsRepository.updateStatus(
          sheet.id,
          { status: 'DRAFT', approver_comments: null, approver_id: null },
          trx,
        );
      }
    });

    return this.getWeek(actor, input.weekStart);
  },

  async submitWeek(actor: AuthenticatedUser, weekStart: string): Promise<TimesheetWeekDto> {
    if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');

    const sheet = await timesheetsRepository.findWeek(actor.employeeId, weekStart);
    if (!sheet) throw ApiError.notFound('Timesheet');
    if (!EDITABLE.includes(sheet.status)) {
      throw ApiError.conflict(`Week ${weekStart} has already been ${sheet.status.toLowerCase()}`);
    }
    if (Number(sheet.total_hours) <= 0) {
      throw ApiError.badRequest('Cannot submit an empty timesheet');
    }

    const employee = await employeesRepository.findById(actor.employeeId);
    await timesheetsRepository.updateStatus(sheet.id, {
      status: 'SUBMITTED',
      submitted_at: db.fn.now(),
      approver_id: employee?.manager_id ?? null,
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: 'TIMESHEET_SUBMITTED',
      entityType: 'timesheet',
      entityId: sheet.id,
      metadata: { weekStart, totalHours: Number(sheet.total_hours) },
    });

    return this.getWeek(actor, weekStart);
  },

  async listPending(actor: AuthenticatedUser): Promise<TimesheetWeekDto[]> {
    if (!actor.employeeId) throw ApiError.forbidden('No employee profile on this account');

    const rows = isHrOrAbove(actor.role)
      ? await timesheetsRepository.allPending()
      : await (async () => {
          const reports = await employeesRepository.listDirectReports(actor.employeeId!);
          if (!reports.length) return [];
          return timesheetsRepository.pendingForApprover(reports.map((report) => report.id));
        })();

    return rows.map((row) => toWeekDto(row, []));
  },

  async decide(
    actor: AuthenticatedUser,
    timesheetId: number,
    input: TimesheetDecisionInput,
  ): Promise<TimesheetWeekDto> {
    if (!actor.employeeId) throw ApiError.forbidden('No employee profile on this account');

    const sheet = await timesheetsRepository.findById(timesheetId);
    if (!sheet) throw ApiError.notFound('Timesheet');
    if (sheet.status !== 'SUBMITTED') {
      throw ApiError.conflict(`Only submitted timesheets can be decided (current: ${sheet.status})`);
    }
    if (sheet.employee_id === actor.employeeId) {
      throw ApiError.forbidden('You cannot approve your own timesheet');
    }

    if (!isHrOrAbove(actor.role)) {
      const isReport = await employeesRepository.isDirectReport(actor.employeeId, sheet.employee_id);
      if (!isReport) {
        throw ApiError.forbidden('You may only approve timesheets for your direct reports');
      }
    }

    await timesheetsRepository.updateStatus(timesheetId, {
      status: input.decision,
      approver_id: actor.employeeId,
      approver_comments: input.comments ?? null,
      approved_at: input.decision === 'APPROVED' ? db.fn.now() : null,
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: `TIMESHEET_${input.decision}`,
      entityType: 'timesheet',
      entityId: timesheetId,
      metadata: { weekStart: sheet.week_start_date, comments: input.comments ?? null },
    });

    const updated = await timesheetsRepository.findById(timesheetId);
    const entries = await timesheetsRepository.entries(timesheetId);
    return toWeekDto(
      updated!,
      entries.map((entry) => ({
        projectId: entry.project_id,
        projectCode: entry.project_code,
        projectName: entry.project_name,
        billable: Boolean(entry.is_billable),
        workDate: entry.work_date,
        hours: Number(entry.hours),
        notes: entry.notes,
      })),
    );
  },

  async summary(actor: AuthenticatedUser, query: SummaryQuery) {
    const target = query.employeeId ? await resolveTarget(actor, query.employeeId) : undefined;

    const rows = await timesheetsRepository.summary({
      from: query.from,
      to: query.to,
      employeeId: target ?? (isHrOrAbove(actor.role) ? undefined : actor.employeeId ?? undefined),
      projectId: query.projectId,
    });

    const projects = rows.map((row) => ({
      projectId: row.project_id as number,
      projectCode: row.project_code as string,
      projectName: row.project_name as string,
      billable: Boolean(row.is_billable),
      totalHours: Number(row.total_hours),
      entryCount: Number(row.entry_count),
    }));

    const totalHours = projects.reduce((sum, project) => sum + project.totalHours, 0);
    const billableHours = projects
      .filter((project) => project.billable)
      .reduce((sum, project) => sum + project.totalHours, 0);

    return {
      range: { from: query.from, to: query.to },
      totalHours,
      billableHours,
      billableRatio: totalHours === 0 ? 0 : Number((billableHours / totalHours).toFixed(3)),
      projects,
    };
  },
};
