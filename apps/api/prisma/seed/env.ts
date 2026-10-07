import { z } from 'zod';

const password = (name: string) =>
  z.string({ error: `Falta ${name}` }).min(8, `${name} debe tener al menos 8 caracteres`);

const SeedEnvSchema = z.object({
  DATABASE_URL: z.string({ error: 'Falta DATABASE_URL' }).min(1, 'Falta DATABASE_URL'),
  OWNER_INITIAL_PASSWORD: password('OWNER_INITIAL_PASSWORD'),
  ADMIN_INITIAL_PASSWORD: password('ADMIN_INITIAL_PASSWORD'),
});

export type SeedEnv = z.infer<typeof SeedEnvSchema>;

/** Valida las variables del seed base. Lanza un error en español que nombra cada variable inválida. */
export function parseSeedEnv(env: NodeJS.ProcessEnv): SeedEnv {
  const result = SeedEnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `- ${issue.message}`).join('\n');
    throw new Error(`Variables de entorno inválidas para el seed:\n${details}`);
  }
  return result.data;
}
