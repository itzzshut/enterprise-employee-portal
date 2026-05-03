import dayjs from 'dayjs';
import { employeesRepository } from '@modules/employees/employees.repository';
import { leaveService } from '@modules/leave/leave.service';
import { timesheetsRepository } from '@modules/timesheets/timesheets.repository';
import { announcementsService } from '@modules/announcements/announcements.service';
import { dashboardRepository } from './dashboard.repository';
import type { AuthenticatedUser } from '@/types/express';
import { isHrOrAbove } from '@/types/roles';

export interface DashboardSummary {
  generatedAt: string;
  role: string;
  kpis: Array<{ key: string; label: string; value: number; unit?: string; hint?: string }>;
  leaveBalances: Awaited<ReturnType<typeof leaveService.getBalances>>;
  upcomingAbsences: Array<Record<string, unknown>>;
  headcountByDepartment: Array<{ code: string; name: string; headcount: number }>;
  leaveTrend: Array<{ month: string; requests: number; days: number }>;
  unreadAnnouncements: number;
}

export const dashboardService = {
  /**
   * One request, one screen.
   *
   * The dashboard deliberately returns a composed payload instead of making the
   * SPA fan out to six endpoints: it halves time-to-first-paint on the landing
   * page and keeps the role-specific tile set decided on the server, where the
   * authorisation rules already live.
   */
  async summary(actor: AuthenticatedUser): Promise<DashboardSummary> {
    const weekStart = dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD');

    const [company, headcount, trend, unread] = await Promise.all([
      dashboardRepository.companyKpis(),
      dashboardRepository.headcountByDepartment(),
      dashboardRepository.leaveTrend(),
      announcementsService.unreadCount(actor),
    ]);

    const kpis: DashboardSummary['kpis'] = [];
    let upcomingAbsences: Array<Record<string, unknown>> = [];
    let leaveBalances: DashboardSummary['leaveBalances'] = [];

    if (actor.employeeId) {
      leaveBalances = await leaveService.getBalances(actor);

      const annual = leaveBalances.find((balance) => balance.code === 'ANNUAL');
      const hoursThisWeek = await timesheetsRepository.hoursThisWeek(actor.employeeId, weekStart);

      kpis.push(
        {
          key: 'annualLeaveAvailable',
          label: 'Annual leave available',
          value: annual?.availableDays ?? 0,
          unit: 'days',
          hint: `${annual?.pendingDays ?? 0} day(s) awaiting approval`,
        },
        {
          key: 'hoursThisWeek',
          label: 'Hours logged this week',
          value: hoursThisWeek,
          unit: 'hrs',
          hint: `Week commencing ${weekStart}`,
        },
        {
          key: 'unreadAnnouncements',
          label: 'Unread announcements',
          value: unread,
        },
      );
    }

    if (actor.role === 'MANAGER' || isHrOrAbove(actor.role)) {
      if (actor.employeeId) {
        const pending = await dashboardRepository.pendingApprovalsFor(actor.employeeId);
        const reports = await employeesRepository.listDirectReports(actor.employeeId);
        kpis.push(
          {
            key: 'pendingApprovals',
            label: 'Awaiting my approval',
            value: pending,
            hint: 'Leave requests routed to you',
          },
          { key: 'directReports', label: 'Direct reports', value: reports.length },
        );

        upcomingAbsences = (await dashboardRepository.upcomingAbsences(
          isHrOrAbove(actor.role) ? undefined : reports.map((report) => report.id),
        )) as Array<Record<string, unknown>>;
      }
    }

    if (isHrOrAbove(actor.role)) {
      kpis.push(
        { key: 'activeEmployees', label: 'Active employees', value: company.activeEmployees },
        { key: 'openLeaveRequests', label: 'Open leave requests', value: company.openLeaveRequests },
        {
          key: 'timesheetsAwaitingApproval',
          label: 'Timesheets awaiting approval',
          value: company.timesheetsAwaitingApproval,
        },
        {
          key: 'hiresLast90Days',
          label: 'New hires (90 days)',
          value: company.hiresLast90Days,
        },
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      role: actor.role,
      kpis,
      leaveBalances,
      upcomingAbsences: upcomingAbsences.map((row) => ({
        id: row.id,
        employeeName: row.employee_name,
        startDate: row.start_date,
        endDate: row.end_date,
        totalDays: Number(row.total_days),
        status: row.status,
        leaveTypeName: row.leave_type_name,
        colorHex: row.color_hex,
      })),
      headcountByDepartment: headcount.map((row) => ({
        code: row.code as string,
        name: row.name as string,
        headcount: Number(row.headcount),
      })),
      leaveTrend: trend.map((row) => ({
        month: row.month as string,
        requests: Number(row.requests),
        days: Number(row.days ?? 0),
      })),
      unreadAnnouncements: unread,
    };
  },
};
