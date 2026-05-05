import dayjs from 'dayjs';
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');

/** A week is always addressed by its Monday. */
const mondayDate = isoDate.refine((value) => dayjs(value).day() === 1, {
  message: 'weekStart must be a Monday',
});

export const timesheetIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const weekQuerySchema = z.object({
  weekStart: mondayDate,
  employeeId: z.coerce.number().int().positive().optional(),
});

export const entrySchema = z.object({
  projectId: z.number().int().positive(),
  workDate: isoDate,
  hours: z
    .number()
    .min(0)
    .max(24)
    // Quarter-hour granularity keeps the decimal(4,2) column exact.
    .refine((value) => Math.round(value * 4) === value * 4, {
      message: 'Hours must be in quarter-hour increments',
    }),
  notes: z.string().trim().max(300).optional(),
});

export const saveWeekSchema = z
  .object({
    weekStart: mondayDate,
    entries: z.array(entrySchema).max(70, 'A week cannot hold more than 70 cells'),
  })
  .strict()
  // Every cell must fall inside the addressed week — otherwise a client could
  // smuggle hours into an already-approved week.
  .refine(
    (value) =>
      value.entries.every((entry) => {
        const offset = dayjs(entry.workDate).diff(dayjs(value.weekStart), 'day');
        return offset >= 0 && offset <= 6;
      }),
    { path: ['entries'], message: 'All entries must fall within the selected week' },
  )
  // Daily total guard: 24h is physically possible, 16h is the policy ceiling.
  .refine(
    (value) => {
      const perDay = new Map<string, number>();
      for (const entry of value.entries) {
        perDay.set(entry.workDate, (perDay.get(entry.workDate) ?? 0) + entry.hours);
      }
      return [...perDay.values()].every((total) => total <= 16);
    },
    { path: ['entries'], message: 'A single day cannot exceed 16 hours' },
  );

export const timesheetDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comments: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => value.decision === 'APPROVED' || Boolean(value.comments?.length), {
    path: ['comments'],
    message: 'A comment is required when rejecting a timesheet',
  });

export const summaryQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    employeeId: z.coerce.number().int().positive().optional(),
    projectId: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => dayjs(value.to).diff(dayjs(value.from), 'day') >= 0, {
    path: ['to'],
    message: '`to` must be on or after `from`',
  });

export type SaveWeekInput = z.infer<typeof saveWeekSchema>;
export type TimesheetDecisionInput = z.infer<typeof timesheetDecisionSchema>;
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
