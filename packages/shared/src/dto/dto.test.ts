import { DTO_FIXTURES } from './__fixtures__/dtoFixtures.js';

describe('DTOs (T11)', () => {
  it('hay una fixture por cada uno de los 22 DTOs', () => {
    expect(DTO_FIXTURES).toHaveLength(22);
    expect(new Set(DTO_FIXTURES.map((d) => d.name)).size).toBe(22);
  });

  describe.each(DTO_FIXTURES)('$name', ({ schema, fixture, moneyField }) => {
    it('acepta la fixture válida', () => {
      expect(schema.parse(fixture)).toEqual(fixture);
    });

    it('rechaza un id que no es UUID', () => {
      expect(schema.safeParse({ ...fixture, id: 'no-es-uuid' }).success).toBe(false);
    });

    it('rechaza una fecha que no es ISO', () => {
      expect(schema.safeParse({ ...fixture, createdAt: '01/10/2026 18:00' }).success).toBe(false);
    });

    if (moneyField) {
      it(`rechaza un monto decimal en ${moneyField}`, () => {
        expect(schema.safeParse({ ...fixture, [moneyField]: 10.5 }).success).toBe(false);
      });
    }

    it('cada campo nullable acepta null', () => {
      const nullable = Object.keys(schema.shape).filter(
        (key) => schema.shape[key]!.safeParse(null).success,
      );
      for (const key of nullable) {
        expect(schema.safeParse({ ...fixture, [key]: null }).success).toBe(true);
      }
    });
  });
});
