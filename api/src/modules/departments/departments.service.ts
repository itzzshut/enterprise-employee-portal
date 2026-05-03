import { ApiError } from '@utils/ApiError';
import { recordAudit } from '@utils/audit';
import { departmentsRepository, type DepartmentRow } from './departments.repository';
import type { CreateDepartmentInput, UpdateDepartmentInput } from './departments.schema';
import type { AuthenticatedUser } from '@/types/express';

export interface DepartmentDto {
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

function toDto(row: DepartmentRow): DepartmentDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    location: row.location,
    annualBudget: row.annual_budget === null ? null : Number(row.annual_budget),
    isActive: Boolean(row.is_active),
    headEmployeeId: row.head_employee_id,
    headName: row.head_name?.trim() || null,
    headcount: Number(row.headcount),
  };
}

export const departmentsService = {
  async list(includeInactive = false): Promise<DepartmentDto[]> {
    const rows = await departmentsRepository.list(includeInactive);
    return rows.map(toDto);
  },

  async getById(id: number): Promise<DepartmentDto> {
    const row = await departmentsRepository.findById(id);
    if (!row) throw ApiError.notFound('Department');
    return toDto(row);
  },

  async create(actor: AuthenticatedUser, input: CreateDepartmentInput): Promise<DepartmentDto> {
    const existing = await departmentsRepository.findByCode(input.code);
    if (existing) throw ApiError.conflict(`Department code ${input.code} is already in use`);

    const id = await departmentsRepository.create({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      location: input.location ?? null,
      annual_budget: input.annualBudget ?? null,
      head_employee_id: input.headEmployeeId ?? null,
    });

    await recordAudit({
      actorUserId: actor.userId,
      action: 'DEPARTMENT_CREATED',
      entityType: 'department',
      entityId: id,
      metadata: { code: input.code },
    });

    return this.getById(id);
  },

  async update(
    actor: AuthenticatedUser,
    id: number,
    input: UpdateDepartmentInput,
  ): Promise<DepartmentDto> {
    await this.getById(id);

    // Deactivating a department that still has people would leave those rows
    // pointing at a hidden department, so the reassignment has to happen first.
    if (input.isActive === false) {
      const headcount = await departmentsRepository.countEmployees(id);
      if (headcount > 0) {
        throw ApiError.conflict(
          `Cannot deactivate a department with ${headcount} assigned employees — reassign them first`,
        );
      }
    }

    const payload: Record<string, unknown> = {};
    if (input.code !== undefined) payload.code = input.code;
    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description;
    if (input.location !== undefined) payload.location = input.location;
    if (input.annualBudget !== undefined) payload.annual_budget = input.annualBudget;
    if (input.headEmployeeId !== undefined) payload.head_employee_id = input.headEmployeeId;
    if (input.isActive !== undefined) payload.is_active = input.isActive;

    await departmentsRepository.update(id, payload);

    await recordAudit({
      actorUserId: actor.userId,
      action: 'DEPARTMENT_UPDATED',
      entityType: 'department',
      entityId: id,
      metadata: { fields: Object.keys(payload) },
    });

    return this.getById(id);
  },
};
