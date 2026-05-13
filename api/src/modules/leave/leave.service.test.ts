import dayjs from 'dayjs';
import {
  assertSufficientBalance,
  calculateLeaveDays,
  leaveService,
} from './leave.service';
import { leaveRepository } from './leave.repository';
import { employeesRepository } from '@modules/employees/employees.repository';
import {
  assertTransition,
  isTransitionAllowed,
  stageForStatus,
  TRANSITIONS,
} from './leave.state';
import type { AuthenticatedUser } from '@/types/express';

jest.mock('./leave.repository');
jest.mock('@modules/employees/employees.repository');
jest.mock('@utils/audit', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@config/knex', () => {
  const trx = { fn: { now: () => 'CURRENT_TIMESTAMP' } };
  return {
    db: {
      transaction: (callback: (t: unknown) => Promise<unknown>) => callback(trx),
      fn: { now: () => 'CURRENT_TIMESTAMP' },
    },
    pingDatabase: jest.fn(),
    closeDatabase: jest.fn(),
  };
});

const repo = leaveRepository as jest.Mocked<typeof leaveRepository>;
const employees = employeesRepository as jest.Mocked<typeof employeesRepository>;

const EMPLOYEE: AuthenticatedUser = {
  userId: 4,
  email: 'employee@portal.dev',
  role: 'EMPLOYEE',
  employeeId: 4,
};

// A fixed future Monday keeps the working-day arithmetic deterministic.
const monday = dayjs().add(3, 'week').startOf('week').add(1, 'day');
const friday = monday.add(4, 'day');

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 55,
    employee_id: 4,
    employee_name: 'Priya Raman',
    employee_code: 'EMP-1004',
    avatar_url: null,
    department_name: 'Engineering',
    leave_type_id: 1,
    leave_type_name: 'Annual Leave',
    leave_type_code: 'ANNUAL',
    color_hex: '#2563eb',
    start_date: monday.format('YYYY-MM-DD'),
    end_date: friday.format('YYYY-MM-DD'),
    total_days: '5.0',
    half_day: 0,
    reason: 'Family wedding in Chennai.',
    status: 'PENDING',
    current_approver_id: 3,
    current_approver_name: 'Marcus Lee',
    submitted_at: new Date(),
    decided_at: null,
    ...overrides,
  } as never;
}

// ---------------------------------------------------------------------------
// Working-day arithmetic
// ---------------------------------------------------------------------------
describe('calculateLeaveDays', () => {
  it('counts a Monday-to-Friday range as five days', () => {
    expect(calculateLeaveDays(monday.format('YYYY-MM-DD'), friday.format('YYYY-MM-DD'))).toBe(5);
  });

  it('excludes the weekend from a Monday-to-Monday range', () => {
    // Mon -> next Mon spans 8 calendar days but only 6 working days.
    expect(
      calculateLeaveDays(monday.format('YYYY-MM-DD'), monday.add(7, 'day').format('YYYY-MM-DD')),
    ).toBe(6);
  });

  it('charges nothing for a weekend-only range', () => {
    const saturday = monday.add(5, 'day').format('YYYY-MM-DD');
    const sunday = monday.add(6, 'day').format('YYYY-MM-DD');
    expect(calculateLeaveDays(saturday, sunday)).toBe(0);
  });

  it('charges a single day for one weekday', () => {
    expect(calculateLeaveDays(monday.format('YYYY-MM-DD'), monday.format('YYYY-MM-DD'))).toBe(1);
  });

  it('charges half a day for a half-day request', () => {
    expect(calculateLeaveDays(monday.format('YYYY-MM-DD'), monday.format('YYYY-MM-DD'), true)).toBe(0.5);
  });

  it('rejects a half day that spans two dates', () => {
    expect(() =>
      calculateLeaveDays(monday.format('YYYY-MM-DD'), monday.add(1, 'day').format('YYYY-MM-DD'), true),
    ).toThrow(/same date/);
  });

  it('rejects an inverted range', () => {
    expect(() => calculateLeaveDays(friday.format('YYYY-MM-DD'), monday.format('YYYY-MM-DD'))).toThrow(
      /on or after/,
    );
  });

  it('rejects an unparseable date', () => {
    expect(() => calculateLeaveDays('not-a-date', friday.format('YYYY-MM-DD'))).toThrow(/Invalid leave dates/);
  });
});

// ---------------------------------------------------------------------------
// Balance gate
// ---------------------------------------------------------------------------
describe('assertSufficientBalance', () => {
  it('allows a request that fits the remaining balance', () => {
    expect(() =>
      assertSufficientBalance({ entitled: 20, carried: 3, used: 4, pending: 0 }, 5, 'Annual Leave'),
    ).not.toThrow();
  });

  it('allows a request that consumes the balance exactly', () => {
    expect(() =>
      assertSufficientBalance({ entitled: 10, carried: 0, used: 5, pending: 0 }, 5, 'Annual Leave'),
    ).not.toThrow();
  });

  it('counts in-flight requests against the balance', () => {
    // 20 + 0 - 10 used - 8 pending = 2 available, so 3 must fail.
    expect(() =>
      assertSufficientBalance({ entitled: 20, carried: 0, used: 10, pending: 8 }, 3, 'Annual Leave'),
    ).toThrow(/Insufficient Annual Leave balance/);
  });

  it('returns a 422 with the requested and available figures', () => {
    try {
      assertSufficientBalance({ entitled: 5, carried: 0, used: 0, pending: 0 }, 9, 'Sick Leave');
      throw new Error('expected assertSufficientBalance to throw');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 422, code: 'UNPROCESSABLE_ENTITY' });
      expect((error as { details: Array<{ message: string }> }).details).toEqual([
        { field: 'totalDays', message: 'Requested: 9' },
        { field: 'availableDays', message: 'Available: 5' },
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// Workflow state machine
// ---------------------------------------------------------------------------
describe('leave workflow transition guards', () => {
  it('moves PENDING to MANAGER_APPROVED for a manager', () => {
    expect(assertTransition('MANAGER_APPROVE', 'PENDING', 'MANAGER')).toBe('MANAGER_APPROVED');
  });

  it('moves MANAGER_APPROVED to APPROVED for HR', () => {
    expect(assertTransition('HR_APPROVE', 'MANAGER_APPROVED', 'HR_ADMIN')).toBe('APPROVED');
  });

  it('refuses a manager approval on an already manager-approved request', () => {
    expect(() => assertTransition('MANAGER_APPROVE', 'MANAGER_APPROVED', 'MANAGER')).toThrow(
      /Cannot manager approve a request in state MANAGER_APPROVED/,
    );
  });

  it('refuses the HR stage to a plain manager', () => {
    expect(() => assertTransition('HR_APPROVE', 'MANAGER_APPROVED', 'MANAGER')).toThrow(
      /cannot perform HR_APPROVE/,
    );
  });

  it('refuses any approval action to an employee', () => {
    expect(() => assertTransition('MANAGER_APPROVE', 'PENDING', 'EMPLOYEE')).toThrow(
      /cannot perform MANAGER_APPROVE/,
    );
  });

  it.each(['APPROVED', 'REJECTED', 'CANCELLED'] as const)(
    'treats %s as terminal for approvals',
    (status) => {
      expect(isTransitionAllowed('MANAGER_APPROVE', status)).toBe(false);
      expect(isTransitionAllowed('HR_APPROVE', status)).toBe(false);
    },
  );

  it('allows cancellation from every non-terminal state and from APPROVED', () => {
    expect(isTransitionAllowed('CANCEL', 'PENDING')).toBe(true);
    expect(isTransitionAllowed('CANCEL', 'MANAGER_APPROVED')).toBe(true);
    expect(isTransitionAllowed('CANCEL', 'APPROVED')).toBe(true);
    expect(isTransitionAllowed('CANCEL', 'CANCELLED')).toBe(false);
    expect(isTransitionAllowed('CANCEL', 'REJECTED')).toBe(false);
  });

  it('derives the approval stage from the current status', () => {
    expect(stageForStatus('PENDING')).toBe('MANAGER');
    expect(stageForStatus('MANAGER_APPROVED')).toBe('HR');
  });

  it('never allows a transition into the state it came from', () => {
    for (const rule of Object.values(TRANSITIONS)) {
      expect(rule.from).not.toContain(rule.to);
    }
  });
});

// ---------------------------------------------------------------------------
// Submission: overlap + balance enforcement
// ---------------------------------------------------------------------------
describe('leaveService.submit', () => {
  const input = {
    leaveTypeId: 1,
    startDate: monday.format('YYYY-MM-DD'),
    endDate: friday.format('YYYY-MM-DD'),
    reason: 'Family wedding in Chennai.',
    halfDay: false,
  };

  beforeEach(() => {
    repo.findLeaveType.mockResolvedValue({
      id: 1,
      code: 'ANNUAL',
      name: 'Annual Leave',
      is_paid: 1,
      default_annual_days: 20,
    } as never);
    employees.findById.mockResolvedValue({ id: 4, manager_id: 3 } as never);
    repo.findHrApproverId.mockResolvedValue(2);
    repo.findOverlapping.mockResolvedValue([]);
    repo.ensureBalanceRow.mockResolvedValue(undefined);
    repo.lockBalance.mockResolvedValue({
      id: 100,
      entitled_days: '20.0',
      used_days: '0.0',
      pending_days: '0.0',
      carried_over_days: '3.0',
    });
    repo.create.mockResolvedValue(55);
    repo.adjustBalance.mockResolvedValue(undefined);
    repo.findById.mockResolvedValue(requestRow());
  });

  it('creates the request, routes it to the line manager and reserves the days', async () => {
    const result = await leaveService.submit(EMPLOYEE, input);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        employee_id: 4,
        total_days: 5,
        status: 'PENDING',
        current_approver_id: 3,
      }),
      expect.anything(),
    );
    expect(repo.adjustBalance).toHaveBeenCalledWith(100, { pending: 5 }, expect.anything());
    expect(result).toMatchObject({ id: 55, status: 'PENDING', totalDays: 5 });
  });

  it('routes straight to HR when the employee has no manager', async () => {
    employees.findById.mockResolvedValue({ id: 1, manager_id: null } as never);
    repo.findById.mockResolvedValue(requestRow({ status: 'MANAGER_APPROVED', current_approver_id: 2 }));

    await leaveService.submit({ ...EMPLOYEE, employeeId: 1 }, input);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'MANAGER_APPROVED', current_approver_id: 2 }),
      expect.anything(),
    );
  });

  it('rejects a range that overlaps an existing blocking request', async () => {
    repo.findOverlapping.mockResolvedValue([
      requestRow({ id: 41, status: 'APPROVED' }) as never,
    ]);

    await expect(leaveService.submit(EMPLOYEE, input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.adjustBalance).not.toHaveBeenCalled();
  });

  it('rejects a request larger than the available balance', async () => {
    repo.lockBalance.mockResolvedValue({
      id: 100,
      entitled_days: '20.0',
      used_days: '17.0',
      pending_days: '1.0',
      carried_over_days: '0.0',
    });

    await expect(leaveService.submit(EMPLOYEE, input)).rejects.toMatchObject({ statusCode: 422 });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('skips the balance gate for unpaid leave', async () => {
    repo.findLeaveType.mockResolvedValue({
      id: 5,
      code: 'UNPAID',
      name: 'Unpaid Leave',
      is_paid: 0,
      default_annual_days: 0,
    } as never);
    repo.lockBalance.mockResolvedValue({
      id: 101,
      entitled_days: '0.0',
      used_days: '0.0',
      pending_days: '0.0',
      carried_over_days: '0.0',
    });

    await expect(leaveService.submit(EMPLOYEE, { ...input, leaveTypeId: 5 })).resolves.toMatchObject({
      id: 55,
    });
  });

  it('rejects a weekend-only range before touching the database', async () => {
    const saturday = monday.add(5, 'day').format('YYYY-MM-DD');
    const sunday = monday.add(6, 'day').format('YYYY-MM-DD');

    await expect(
      leaveService.submit(EMPLOYEE, { ...input, startDate: saturday, endDate: sunday }),
    ).rejects.toThrow(/no working days/);
    expect(repo.findOverlapping).not.toHaveBeenCalled();
  });

  it('rejects an unknown leave type', async () => {
    repo.findLeaveType.mockResolvedValue(undefined as never);
    await expect(leaveService.submit(EMPLOYEE, input)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
describe('leaveService.decide', () => {
  const MANAGER: AuthenticatedUser = {
    userId: 3,
    email: 'manager@portal.dev',
    role: 'MANAGER',
    employeeId: 3,
  };
  const HR: AuthenticatedUser = {
    userId: 2,
    email: 'hr@portal.dev',
    role: 'HR_ADMIN',
    employeeId: 2,
  };

  beforeEach(() => {
    repo.findHrApproverId.mockResolvedValue(2);
    repo.updateStatus.mockResolvedValue(1);
    repo.recordApproval.mockResolvedValue(undefined);
    repo.adjustBalance.mockResolvedValue(undefined);
    repo.lockBalance.mockResolvedValue({
      id: 100,
      entitled_days: '20.0',
      used_days: '0.0',
      pending_days: '5.0',
      carried_over_days: '3.0',
    });
    employees.isInReportingLine.mockResolvedValue(true);
  });

  it('advances a PENDING request to MANAGER_APPROVED and keeps the reservation', async () => {
    repo.findById.mockResolvedValue(requestRow());

    await leaveService.decide(MANAGER, 55, { decision: 'APPROVED' });

    expect(repo.updateStatus).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ status: 'MANAGER_APPROVED', current_approver_id: 2 }),
      expect.anything(),
    );
    // Days stay reserved until HR finalises the request.
    expect(repo.adjustBalance).not.toHaveBeenCalled();
  });

  it('converts reserved days into used days on HR approval', async () => {
    repo.findById.mockResolvedValue(requestRow({ status: 'MANAGER_APPROVED', current_approver_id: 2 }));

    await leaveService.decide(HR, 55, { decision: 'APPROVED' });

    expect(repo.adjustBalance).toHaveBeenCalledWith(
      100,
      { pending: -5, used: 5 },
      expect.anything(),
    );
  });

  it('releases the reservation on rejection', async () => {
    repo.findById.mockResolvedValue(requestRow());

    await leaveService.decide(MANAGER, 55, { decision: 'REJECTED', comments: 'Release freeze.' });

    expect(repo.adjustBalance).toHaveBeenCalledWith(100, { pending: -5 }, expect.anything());
  });

  it('refuses a manager who is outside the reporting line', async () => {
    repo.findById.mockResolvedValue(requestRow({ current_approver_id: 99 }));
    employees.isInReportingLine.mockResolvedValue(false);

    await expect(
      leaveService.decide({ ...MANAGER, employeeId: 11 }, 55, { decision: 'APPROVED' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses self-approval', async () => {
    repo.findById.mockResolvedValue(requestRow({ employee_id: 3 }));

    await expect(leaveService.decide(MANAGER, 55, { decision: 'APPROVED' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('returns 409 when the request has already moved on', async () => {
    repo.findById
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce(requestRow({ status: 'MANAGER_APPROVED' }));

    await expect(leaveService.decide(MANAGER, 55, { decision: 'APPROVED' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('returns 404 for an unknown request', async () => {
    repo.findById.mockResolvedValue(undefined);
    await expect(leaveService.decide(MANAGER, 999, { decision: 'APPROVED' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
