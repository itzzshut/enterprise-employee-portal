import { z } from 'zod';

export const announcementIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listAnnouncementsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  includeExpired: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
});

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(5).max(180),
    body: z.string().trim().min(20, 'Give the announcement some substance').max(20_000),
    audience: z.enum(['ALL', 'DEPARTMENT', 'MANAGERS']).default('ALL'),
    departmentId: z.number().int().positive().nullable().optional(),
    isPinned: z.boolean().default(false),
    publishNow: z.boolean().default(true),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  // A DEPARTMENT-scoped announcement without a department would be invisible.
  .refine((value) => value.audience !== 'DEPARTMENT' || Boolean(value.departmentId), {
    path: ['departmentId'],
    message: 'A department is required when the audience is DEPARTMENT',
  });

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;
