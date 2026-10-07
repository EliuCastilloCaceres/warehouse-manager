import * as shared from '@warehouse-manager/shared';
import type { z } from 'zod';
import { parsePrismaSchema, scalarFields } from './prismaSchema.js';

const MODELS_WITHOUT_DTO = [
  'RefreshToken',
  'BranchCounter',
  'RolePermission',
  'UserPermission',
  'UserBranch',
  'AuditLog',
];
const EXCLUDED_FIELDS: Record<string, string[]> = { User: ['passwordHash'] };

describe('paridad de DTOs shared ↔ Prisma (T15)', () => {
  const schema = parsePrismaSchema();
  const models = Object.keys(schema.models);
  const dtoOf = (model: string) =>
    (shared as Record<string, unknown>)[`${model}Dto`] as z.ZodObject | undefined;
  const withDto = models.filter((m) => dtoOf(m));

  it('los modelos sin DTO son exactamente los 6 declarados', () => {
    expect(models.filter((m) => !dtoOf(m)).sort()).toEqual([...MODELS_WITHOUT_DTO].sort());
    expect(withDto).toHaveLength(22);
  });

  it.each(withDto)(
    '%sDto tiene los campos escalares del modelo y la misma nulabilidad',
    (model) => {
      const dto = dtoOf(model)!;
      const fields = scalarFields(schema, model).filter(
        (f) => !(EXCLUDED_FIELDS[model] ?? []).includes(f.name),
      );

      expect(Object.keys(dto.shape).sort()).toEqual(fields.map((f) => f.name).sort());
      for (const field of fields) {
        const acceptsNull = dto.shape[field.name]!.safeParse(null).success;
        expect({ field: field.name, nullable: acceptsNull }).toEqual({
          field: field.name,
          nullable: field.optional,
        });
      }
    },
  );
});
