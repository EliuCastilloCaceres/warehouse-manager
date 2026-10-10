import { z } from 'zod';

/** `'true'` | `'false'` → boolean. */
const booleanFlag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

const ConfigSchema = z.object({
  // F0
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().min(1).default('0.0.0'),
  // F2
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'Debe ser una URL postgresql://' }),
  JWT_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
  ACCESS_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  COOKIE_SECURE: booleanFlag('true'),
  UPLOADS_DIR: z.string().min(1).default('uploads'),
  TRUST_PROXY: booleanFlag('false'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/**
 * Valida las variables de entorno de la API. Lanza un error que nombra cada
 * variable inválida con su motivo.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${details}`);
  }
  return result.data;
}
