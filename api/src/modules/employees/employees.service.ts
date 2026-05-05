import bcrypt from 'bcryptjs';
import { env } from '@config/env';
import { db } from '@config/knex';
import { ApiError } from '@utils/ApiError';
import { recordAudit } from '@utils/audit';
import { parsePagination, type Paginated } from '@utils/paginate';
import { employeesRepository, type EmployeeRow } from './employees.repository';
import type {
  CreateEmployeeInput,
  DirectoryQuery,
  UpdateEmployeeInput,
  UpdateSelfProfileInput,
} from './employees.schema';
import type { AuthenticatedUser } from '@/types/express';
import { isHrOrAbove } from '@/types/roles';

export interface EmployeeDto {
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
  employmentType: EmployeeRow['employment_type'];
  status: EmployeeRow['status'];
  location: string | null;
  avatarUrl: string | null
  role: string | null;
}

export function toEmployeeDto(row: EmployeeRow): EmployeeDto {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`,
    workEmail: row.work_email,
    phone: row.phone,
    jobTitle: row.job_title,
    departmentId: row.department_id,
    departmentName: row.department_name,
    managerId: row.manager_id,
    managerName: row.manager_name?.trim() || null,
    hireDate: row.hire_date,
    terminationDate: row.termination_date,
    employmentType: row.employment_type,
    status: row.status,
    location: row.location,
    avatarUrl: row.avatar_url,
    role: row.role,
  };
}

/**
 * Row-level guard.
 *
 * `authorize()` has already confirmed the *role* may call the endpoint; this
 * decides whether the actor may touch *this* record. A MANAGER is limited to
 * their own reporting line — anything else is a 403, never a 404, because the
 * directory already tells every employee that the record exists.
 */
async function assertCanMutate(actor: AuthenticatedUser, employeeId: number): Promise<void> {
  if (isHrOrAbove(actor.role)) return;
  if (actor.employeeId === employeeId) return;

  if (actor.role === 'MANAGER' && actor.employeeId) {
    const isReport = await employeesRepository.isDirectReport(actor.employeeId, employeeId);
    if (isReport) return;
    throw ApiError.forbidden('Managers may only modify their own direct reports');
  }

  throw ApiError.forbidden('You may only modify your own profile');
}

export const employeesService = {
  async directory(filters: DirectoryQuery): Promise<Paginated<EmployeeDto>> {
    const pagination = parsePagination(filters as Record<string, unknown>);
    // The directory intentionally hides terminated staff unless explicitly asked.
    const effective: DirectoryQuery = filters.status ? filters : { ...filters, status: 'ACTIVE' };
    const page = await employeesRepository.search(effective, pagination);
    return { data: page.data.map(toEmployeeDto), meta: page.meta };
  },

  async getById(id: number): Promise<EmployeeDto> {
    const row = await employeesRepository.findById(id);
    if (!row) throw ApiError.notFound('Employee');
    return toEmployeeDto(row);
  },

  async getMyProfile(actor: AuthenticatedUser): Promise<EmployeeDto> {
    if (!actor.employeeId) {
      throw ApiError.notFound('Employee profile for this account');
    }
    return this.getById(actor.employeeId);
  },

  async getDirectReports(actor: AuthenticatedUser, managerId?: number): Promise<EmployeeDto[]> {
    const target = managerId ?? actor.employeeId;
    if (!target) throw ApiError.badRequest('No manager context available');

    if (!isHrOrAbove(actor.role) && target !== actor.employeeId) {
      throw ApiError.forbidden("You cannot view another manager's team");
    }
    const rows = await employeesRepository.listDirectReports(target);
    return rows.map(toEmployeeDto);
  },

  /**
   * HR-only creation. The login row and the employee row are written in one
   * transaction so a failed employee insert cannot leave an orphan account
   * that can authenticate but has no profile.
   */
  async create(actor: AuthenticatedUser, input: CreateEmployeeInput): Promise<EmployeeDto> {
    if (input.managerId) {
      const manager = await employeesRepository.findById(input.managerId);
      if (!manager) throw ApiError.badRequest('Assigned manager does not exist');
    }

    const employeeId = await db.transaction(async (trx) => {
      let userId: number | null = null;

      if (input.createLogin && input.temporaryPassword) {
        const existing = await trx('users').where('email', input.workEmail).first();
        if (existing) throw ApiError.conflict('A login already exists for this email address');

        const [insertedUserId] = await trx('users').insert({
          email: input.workEmail,
          password_hash: await bcrypt.hash(input.temporaryPassword, env.BCRYPT_ROUNDS),
          role: input.role,
          is_active: true,
          must_change_password: true,
        });
        userId = insertedUserId as number;
      }

      return employeesRepository.create(
        {
          user_id: userId,
          employee_code: input.employeeCode,
          first_name: input.firstName,
          last_name: input.lastName,
          work_email: input.workEmail,
          phone: input.phone ?? null,
          job_title: input.jobTitle,
          department_id: input.departmentId ?? null,
          manager_id: input.managerId ?? null,
          hire_date: input.hireDate,
          employment_type: input.employmentType,
          location: input.location ?? null,
          status: 'ACTIVE',
        },
        trx,
      );
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: 'EMPLOYEE_CREATED',
      entityType: 'employee',
      entityId: employeeId,
      metadata: { employeeCode: input.employeeCode, loginProvisioned: input.createLogin },
    });

    return this.getById(employeeId);
  },

  async update(
    actor: AuthenticatedUser,
    employeeId: number,
    input: UpdateEmployeeInput,
  ): Promise<EmployeeDto> {
    const existing = await employeesRepository.findById(employeeId);
    if (!existing) throw ApiError.notFound('Employee');
    await assertCanMutate(actor, employeeId);

    // Only HR may move people between managers or change employment status;
    // a manager editing a report is limited to contact-level fields.
    if (!isHrOrAbove(actor.role)) {
      const privileged: Array<keyof UpdateEmployeeInput> = [
        'managerId',
        'departmentId',
        'status',
        'employmentType',
        'terminationDate',
      ];
      const attempted = privileged.filter((field) => input[field] !== undefined);
      if (attempted.length) {
        throw ApiError.forbidden(`Only HR can change: ${attempted.join(', ')}`);
      }
    }

    if (input.managerId === employeeId) {
      throw ApiError.badRequest('An employee cannot be their own manager');
    }
    if (input.managerId) {
      // Reassigning a manager must not create a cycle in the org tree.
      const wouldCycle = await employeesRepository.isInReportingLine(employeeId, input.managerId);
      if (wouldCycle) {
        throw ApiError.badRequest('That change would create a cycle in the reporting hierarchy');
      }
    }

    const payload: Record<string, unknown> = {};
    if (input.firstName !== undefined) payload.first_name = input.firstName;
    if (input.lastName !== undefined) payload.last_name = input.lastName;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.jobTitle !== undefined) payload.job_title = input.jobTitle;
    if (input.departmentId !== undefined) payload.department_id = input.departmentId;
    if (input.managerId !== undefined) payload.manager_id = input.managerId;
    if (input.employmentType !== undefined) payload.employment_type = input.employmentType;
    if (input.status !== undefined) payload.status = input.status;
    if (input.location !== undefined) payload.location = input.location;
    if (input.terminationDate !== undefined) payload.termination_date = input.terminationDate;

    await employeesRepository.update(employeeId, payload);

    await recordAudit({
      actorUserId: actor.userId,
      action: 'EMPLOYEE_UPDATED',
      entityType: 'employee',
      entityId: employeeId,
      metadata: { fields: Object.keys(payload) },
    });

    return this.getById(employeeId);
  },

  async updateMyProfile(actor: AuthenticatedUser, input: UpdateSelfProfileInput): Promise<EmployeeDto> {
    if (!actor.employeeId) throw ApiError.notFound('Employee profile for this account');
    await employeesRepository.update(actor.employeeId, {
      phone: input.phone ?? null,
      location: input.location ?? null,
    });
    return this.getById(actor.employeeId);
  },

  async setAvatar(actor: AuthenticatedUser, employeeId: number, storagePath: string): Promise<EmployeeDto> {
    await assertCanMutate(actor, employeeId);
    const url = `/api/v1/employees/${employeeId}/avatar/${storagePath}`;
    await employeesRepository.setAvatar(employeeId, url);
    return this.getById(employeeId);
  },
};
