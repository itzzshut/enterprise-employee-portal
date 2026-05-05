import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');

export const employeeIdParamSchema = z.object({
  id: z.coerce.number().int().positive('Employee id must be a positive integer'),
});

export const directoryQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  managerId: z.coerce.number().int().positive().optional(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.enum(['last_name', 'first_name', 'job_title', 'hire_date', 'employee_code']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const createEmployeeSchema = z
  .object({
    employeeCode: z.string().trim().regex(/^EMP-\d{4,6}$/, 'Expected the format EMP-1234'),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    workEmail: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().max(30).optional(),
    jobTitle: z.string().trim().min(2).max(120),
    departmentId: z.number().int().positive().nullable().optional(),
    managerId: z.number().int().positive().nullable().optional(),
    hireDate: isoDate,
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).default('FULL_TIME'),
    location: z.string().trim().max(120).optional(),
    // Optional login provisioning — HR can create a record first and invite later.
    createLogin: z.boolean().default(false),
    role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN']).default('EMPLOYEE'),
    temporaryPassword: z.string().min(10).max(128).optional(),
  })
  .strict()
  .refine((value) => !value.createLogin || Boolean(value.temporaryPassword), {
    path: ['temporaryPassword'],
    message: 'A temporary password is required when provisioning a login',
  });

/** Fields an employee may change on their own profile. */
export const updateSelfProfileSchema = z
  .object({
    phone: z.string().trim().max(30).nullable().optional(),
    location: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

/** Superset available to HR_ADMIN and SUPER_ADMIN. */
export const updateEmployeeSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    jobTitle: z.string().trim().min(2).max(120).optional(),
    departmentId: z.number().int().positive().nullable().optional(),
    managerId: z.number().int().positive().nullable().optional(),
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
    status: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']).optional(),
    location: z.string().trim().max(120).nullable().optional(),
    terminationDate: isoDate.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type UpdateSelfProfileInput = z.infer<typeof updateSelfProfileSchema>;
