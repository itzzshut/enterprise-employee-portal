export type { Role } from './roles';
export { ROLES, ROLE_RANK, hasAtLeast, isHrOrAbove } from './roles';
export type { AuthenticatedUser } from './express';

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';

export type LeaveStatus =
  | 'PENDING'
  | 'MANAGER_APPROVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type ApprovalStage = 'MANAGER' | 'HR';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';
export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type DocumentVisibility = 'PRIVATE' | 'MANAGER' | 'HR' | 'COMPANY';
export type AnnouncementAudience = 'ALL' | 'DEPARTMENT' | 'MANAGERS';

export interface AuditEvent {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
}
