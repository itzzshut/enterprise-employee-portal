import { ApiError } from '@utils/ApiError';
import type { LeaveStatus, Role } from '@/types';

export type LeaveAction =
  | 'MANAGER_APPROVE'
  | 'MANAGER_REJECT'
  | 'HR_APPROVE'
  | 'HR_REJECT'
  | 'CANCEL';

interface TransitionRule {
  from: LeaveStatus[];
  to: LeaveStatus;
  /** Roles permitted to perform the action at all — row ownership is checked separately. */
  roles: Role[];
  description: string;
}

/**
 * The leave workflow as data, not as scattered `if` statements.
 *
 *   PENDING ──manager approve──▶ MANAGER_APPROVED ──HR approve──▶ APPROVED
 *      │                              │
 *      └──────── reject / cancel ─────┴──▶ REJECTED / CANCELLED  (terminal)
 *
 * Every mutation in `leave.service.ts` goes through `assertTransition`, so
 * adding a stage (a second-level approval, say) is a change to this map plus a
 * new action — not an audit of every call site. The guard is also what the unit
 * tests assert against, which is why it lives in its own module with no
 * database dependency.
 */
export const TRANSITIONS: Record<LeaveAction, TransitionRule> = {
  MANAGER_APPROVE: {
    from: ['PENDING'],
    to: 'MANAGER_APPROVED',
    roles: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
    description: 'Line manager confirms team coverage',
  },
  MANAGER_REJECT: {
    from: ['PENDING'],
    to: 'REJECTED',
    roles: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
    description: 'Line manager declines the request',
  },
  HR_APPROVE: {
    from: ['MANAGER_APPROVED'],
    to: 'APPROVED',
    roles: ['HR_ADMIN', 'SUPER_ADMIN'],
    description: 'People Operations verifies balance and finalises the request',
  },
  HR_REJECT: {
    from: ['MANAGER_APPROVED'],
    to: 'REJECTED',
    roles: ['HR_ADMIN', 'SUPER_ADMIN'],
    description: 'People Operations declines after policy review',
  },
  CANCEL: {
    from: ['PENDING', 'MANAGER_APPROVED', 'APPROVED'],
    to: 'CANCELLED',
    roles: ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
    description: 'Requester withdraws, or HR cancels an approved absence',
  },
};

export const TERMINAL_STATUSES: readonly LeaveStatus[] = ['APPROVED', 'REJECTED', 'CANCELLED'];

/** Statuses that reserve days in `leave_balances.pending_days`. */
export const PENDING_STATUSES: readonly LeaveStatus[] = ['PENDING', 'MANAGER_APPROVED'];

/** Statuses that block a new overlapping request. */
export const BLOCKING_STATUSES: readonly LeaveStatus[] = [
  'PENDING',
  'MANAGER_APPROVED',
  'APPROVED',
];

export function isTransitionAllowed(action: LeaveAction, from: LeaveStatus): boolean {
  return TRANSITIONS[action].from.includes(from);
}

/**
 * Single guard for every status change. Throws 409 for an illegal transition
 * (the request has moved on — usually another approver got there first) and 403
 * when the role is not entitled to the action at all.
 */
export function assertTransition(action: LeaveAction, from: LeaveStatus, role: Role): LeaveStatus {
  const rule = TRANSITIONS[action];

  if (!rule.from.includes(from)) {
    throw ApiError.conflict(
      `Cannot ${action.toLowerCase().replace('_', ' ')} a request in state ${from}`,
      [{ field: 'status', message: `Allowed source states: ${rule.from.join(', ')}` }],
    );
  }

  if (!rule.roles.includes(role)) {
    throw ApiError.forbidden(`Role ${role} cannot perform ${action}`);
  }

  return rule.to;
}

/** Which approval stage a decision on this status belongs to. */
export function stageForStatus(status: LeaveStatus): 'MANAGER' | 'HR' {
  return status === 'PENDING' ? 'MANAGER' : 'HR';
}

export function nextApproverStage(status: LeaveStatus): 'MANAGER' | 'HR' | null {
  if (status === 'PENDING') return 'MANAGER';
  if (status === 'MANAGER_APPROVED') return 'HR';
  return null;
}
