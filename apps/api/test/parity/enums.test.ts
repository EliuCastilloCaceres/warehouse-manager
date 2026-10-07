import * as shared from '@warehouse-manager/shared';
import { parsePrismaSchema } from './prismaSchema.js';

describe('paridad de enums shared ↔ Prisma (T14)', () => {
  const { enums } = parsePrismaSchema();

  it('hay 10 enums en schema.prisma', () => {
    expect(Object.keys(enums)).toHaveLength(10);
  });

  it.each(Object.entries(enums))('%s coincide con shared', (name, values) => {
    const zodEnum = (shared as Record<string, unknown>)[name] as { options?: string[] } | undefined;
    expect(zodEnum?.options).toBeDefined();
    expect([...zodEnum!.options!].sort()).toEqual([...values].sort());
  });
});
