import { HealthDto } from './index.js';

const valid = {
  status: 'ok',
  version: '0.1.0',
  uptimeSeconds: 12,
  timestamp: '2026-10-01T18:00:00.000Z',
  database: 'ok',
};

describe('HealthDto', () => {
  it('acepta un payload válido (T1)', () => {
    expect(HealthDto.parse(valid)).toEqual(valid);
  });

  it.each([
    ['status distinto de ok', { ...valid, status: 'down' }],
    ['timestamp no ISO', { ...valid, timestamp: '01/10/2026 18:00' }],
    ['uptimeSeconds negativo', { ...valid, uptimeSeconds: -1 }],
    // T8 de F2: la BD es obligatoria en el health
    ['sin database', { ...valid, database: undefined }],
    ['database distinto de ok', { ...valid, database: 'down' }],
  ])('rechaza %s (T2)', (_caso, payload) => {
    expect(HealthDto.safeParse(payload).success).toBe(false);
  });
});
