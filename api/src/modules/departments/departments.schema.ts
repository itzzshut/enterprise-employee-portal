import { z } from 'zod';

export const departmentIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listDepartmentsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const createDepartmentSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(20)
      .regex(/^[A-Z0-9_-]+$/, 'Use uppercase letters, digits, dashes or underscores'),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    location: z.string().trim().max(120).optional(),
    annualBudget: z.number().nonnegative().max(999_999_999).optional(),
    headEmployeeId: z.number().int().positive().nullable().optional(),
  })
  .strict();

export const updateDepartmentSchema = createDepartmentSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
