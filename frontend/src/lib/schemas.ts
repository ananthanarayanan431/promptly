import * as z from 'zod';

export const loginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
});

export type RegisterFormData = z.infer<typeof registerSchema>;

export const optimizePromptSchema = z.object({
  prompt: z.string().min(10, { message: 'Prompt must be at least 10 characters long' }).optional().or(z.literal('')),
  prompt_id: z.string().uuid().optional(),
  name: z.string().optional(),
  feedback: z.string().optional(),
  session_id: z.string().uuid().optional(),
}).refine(data => data.prompt || data.prompt_id, {
  message: 'Either a new prompt or an existing prompt ID is required',
  path: ['prompt'], // Set path of the error
});

export type OptimizePromptFormData = z.infer<typeof optimizePromptSchema>;

export const healthScoreSchema = z.object({
  prompt: z.string().min(10, { message: 'Prompt parameter required' }),
});

export type HealthScoreFormData = z.infer<typeof healthScoreSchema>;

export const advisorySchema = z.object({
  prompt: z.string().min(10, { message: 'Prompt parameter required' }),
});

export type AdvisoryFormData = z.infer<typeof advisorySchema>;
