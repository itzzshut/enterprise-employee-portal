/**
 * Wire models shared across features.
 *
 * These mirror the API DTOs one-for-one (see api/src/docs/openapi.ts). They are
 * intentionally plain interfaces rather than classes: nothing needs behaviour,
 * and keeping them structural means a response can be used directly without a
 * mapping layer.
 */
export type Role = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'SUPER_ADMIN';

export type LeaveStatus =
  | 'PENDING'
  | 'MANAGER_APPROVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
export type DocumentVisibility = 'PRIVATE' | 'MANAGER' | 'HR' | 'COMPANY';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: ApiErrorDetail[] };
  requestId?: string;
}

export interface SessionUser {
  userId: number;
  employeeId: number | null;
  email: string;
  role: Role;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  departmentId: number | null;
  departmentName: string | null;
  managerId: number | null;
  mustChangePassword: boolean;
}

export interface AuthResult {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface Employee {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string;
  phone: string | null;
  jobTitle: string;
  departmentId: number | null;
  departmentName: string | null;
  managerId: number | null;
  managerName: string | null;
  hireDate: string;
  terminationDate: string | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  location: string | null;
  avatarUrl: string | null;
  role: Role | null;
}

export interface Department {
  id: number;
  code: string;
  name: string;
  description: string | null;
  location: string | null;
  annualBudget: number | null;
  isActive: boolean;
  headEmployeeId: number | null;
  headName: string | null;
  headcount: number;
}

export interface LeaveType {
  id: number;
  code: string;
  name: string;
  default_annual_days: number;
  requires_attachment: boolean;
  is_paid: boolean;
  color_hex: string;
}

export interface LeaveBalance {
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

export interface LeaveRequest {
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

export interface LeaveApprovalEntry {
  id: number;
  stage: 'MANAGER' | 'HR';
  decision: 'APPROVED' | 'REJECTED';
  comments: string | null;
  approverName: string;
  decidedAt: string;
}

export interface LeaveRequestDetail {
  request: LeaveRequest;
  approvals: LeaveApprovalEntry[];
}

export interface CalendarEntry {
  id: number;
  employeeId: number;
  employeeName: string;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  halfDay: boolean;
  leaveTypeCode: string;
  leaveTypeName: string;
  colorHex: string;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  client_name: string | null;
  is_billable: boolean;
}

export interface TimesheetEntry {
  projectId: number;
  projectCode: string;
  projectName: string;
  billable: boolean;
  workDate: string;
  hours: number;
  notes: string | null;
}

export interface TimesheetWeek {
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
  entries: TimesheetEntry[];
}

export interface DocumentRecord {
  id: number;
  employeeId: number | null;
  employeeName: string | null;
  uploadedById: number;
  uploadedByName: string;
  title: string;
  category: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  visibility: DocumentVisibility;
  expiresOn: string | null;
  createdAt: string;
  downloadUrl: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: 'ALL' | 'DEPARTMENT' | 'MANAGERS';
  departmentId: number | null;
  departmentName: string | null;
  authorId: number;
  authorName: string;
  isPinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  isRead: boolean;
  readCount: number;
}

export interface OrgNode {
  id: number;
  managerId: number | null;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  departmentName: string | null;
  location: string | null;
  avatarUrl: string | null;
  depth: number;
  directReports: number;
  totalReports: number;
  children: OrgNode[];
}

export interface OrgChartResponse {
  tree: OrgNode | null;
  breadcrumb: Array<{ id: number; fullName: string; jobTitle: string }>;
  stats: {
    totalActive: number;
    managers: number;
    maxDepth: number;
    nodesReturned: number;
    depthLimit: number;
  };
}

export interface DashboardKpi {
  key: string;
  label: string;
  value: number;
  unit?: string;
  hint?: string;
}

export interface DashboardSummary {
  generatedAt: string;
  role: Role;
  kpis: DashboardKpi[];
  leaveBalances: LeaveBalance[];
  upcomingAbsences: Array<{
    id: number;
    employeeName: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    status: LeaveStatus;
    leaveTypeName: string;
    colorHex: string;
  }>;
  headcountByDepartment: Array<{ code: string; name: string; headcount: number }>;
  leaveTrend: Array<{ month: string; requests: number; days: number }>;
  unreadAnnouncements: number;
}
