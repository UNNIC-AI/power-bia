import { z } from 'zod';

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(200),
  displayName: z.string().min(1).max(80),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: z.enum(['member', 'admin']),
});

export type Register = z.infer<typeof registerSchema>;
export type Login = z.infer<typeof loginSchema>;
export type User = z.infer<typeof userSchema>;
