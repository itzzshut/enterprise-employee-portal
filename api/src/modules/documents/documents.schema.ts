import { z } from 'zod';

export const documentIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listDocumentsQuerySchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  category: z.enum(['GENERAL', 'CONTRACT', 'POLICY', 'PAYROLL', 'CERTIFICATE', 'ID_PROOF']).optional(),
  visibility: z.enum(['PRIVATE', 'MANAGER', 'HR', 'COMPANY']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

/**
 * Upload metadata arrives as multipart text fields, so every value is a string
 * at this point — the coercions below are what make the parsed object usable.
 */
export const uploadDocumentSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    category: z
      .enum(['GENERAL', 'CONTRACT', 'POLICY', 'PAYROLL', 'CERTIFICATE', 'ID_PROOF'])
      .default('GENERAL'),
    employeeId: z.coerce.number().int().positive().optional(),
    visibility: z.enum(['PRIVATE', 'MANAGER', 'HR', 'COMPANY']).default('PRIVATE'),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
