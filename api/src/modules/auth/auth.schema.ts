import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid work email is required'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(20, 'A refresh token is required'),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8).max(128),
    newPassword: z
      .string()
      .min(10, 'New password must be at least 10 characters')
      .max(128)
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/\d/, 'Include at least one digit'),
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
