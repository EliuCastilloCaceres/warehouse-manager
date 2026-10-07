import { z } from 'zod';

export const HealthDto = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(), // ISO 8601 UTC (plan §3)
});
export type HealthDto = z.infer<typeof HealthDto>;
