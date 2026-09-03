import { z } from 'zod';

/** Long enough to be worth the scrypt cost; the UI states the minimum. */
const passwordSchema = z.string().min(12).max(200);

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: z.enum(['member', 'admin']),
});

export const registerSchema = z.object({
  email: z.email(),
  password: passwordSchema,
  displayName: z.string().min(1).max(80),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

/**
 * Self-registration only exists to create the first account, so the login page
 * has to know which of the two forms to render before anyone is signed in.
 */
export const setupStateSchema = z.object({ needsSetup: z.boolean() });

/** Members may change their own password and nothing else about their account. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/** An admin resetting someone else's password does not know the current one. */
export const resetPasswordSchema = z.object({ password: passwordSchema });

export const createUserSchema = registerSchema.extend({
  role: z.enum(['member', 'admin']).default('member'),
});

export type User = z.infer<typeof userSchema>;
export type Register = z.infer<typeof registerSchema>;
export type Login = z.infer<typeof loginSchema>;
export type SetupState = z.infer<typeof setupStateSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
