import { z } from 'zod';
import dayjs from 'dayjs';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');

export const leaveIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listLeaveQuerySchema = z.object({
  status: z.enum(['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  leaveTypeId: z.coerce.number().int().positive().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  sortBy: z.enum(['start_date', 'submitted_at', 'total_days', 'status']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const calendarQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    departmentId: z.coerce.number().int().positive().optional(),
    scope: z.enum(['ME', 'TEAM', 'COMPANY']).default('TEAM'),
  })
  .refine((value) => dayjs(value.to).diff(dayjs(value.from), 'day') >= 0, {
    path: ['to'],
    message: '`to` must be on or after `from`',
  })
  // A calendar query is a range scan; cap it so the endpoint cannot be used to
  // pull the entire leave history in one call.
  .refine((value) => dayjs(value.to).diff(dayjs(value.from), 'day') <= 186, {
    path: ['to'],
    message: 'Calendar range cannot exceed six months',
  });

export const balanceQuerySchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const createLeaveRequestSchema = z
  .object({
    leaveTypeId: z.number().int().positive(),
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().trim().min(10, 'Please give at least a short reason').max(500),
    halfDay: z.boolean().default(false),
  })
  .strict()
  // Cross-field rule 1: ordering.
  .refine((value) => dayjs(value.endDate).isSame(value.startDate) || dayjs(value.endDate).isAfter(value.startDate), {
    path: ['endDate'],
    message: 'End date must be on or after the start date',
  })
  // Cross-field rule 2: a half day is a single calendar day by definition.
  .refine((value) => !value.halfDay || value.startDate === value.endDate, {
    path: ['halfDay'],
    message: 'A half day must start and end on the same date',
  })
  // Cross-field rule 3: no back-dating beyond a fortnight. Sick leave entered
  // late is common, so the window is generous rather than zero.
  .refine((value) => dayjs(value.startDate).isAfter(dayjs().subtract(15, 'day')), {
    path: ['startDate'],
    message: 'Leave cannot be requested more than 14 days in the past',
  })
  // Cross-field rule 4: a single request cannot span more than a quarter.
  .refine((value) => dayjs(value.endDate).diff(dayjs(value.startDate), 'day') <= 90, {
    path: ['endDate'],
    message: 'A single request cannot span more than 90 days',
  });

export const decisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comments: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => value.decision === 'APPROVED' || Boolean(value.comments?.length), {
    path: ['comments'],
    message: 'A comment is required when rejecting a request',
  });

export const cancelSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type ListLeaveQuery = z.infer<typeof listLeaveQuerySchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
