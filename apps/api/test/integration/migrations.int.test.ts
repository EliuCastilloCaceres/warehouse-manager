import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { PrismaClient } from '../../src/core/prisma-client.js';
import { createTestClient } from './helpers/db.js';
import { testDatabaseUrl } from './helpers/env.js';

const API_DIR = resolve(__dirname, '../..');

describe('migraciones (T16)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('las 2 migraciones están aplicadas', async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`;
    expect(rows.map((r) => r.migration_name.replace(/^\d+_/, ''))).toEqual(['init', 'constraints']);
    for (const row of rows) expect(row.finished_at).not.toBeNull();
  });

  it('prisma migrate diff (BD contra schema) no reporta diferencias', () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve(API_DIR, 'node_modules/prisma/build/index.js'),
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      {
        cwd: API_DIR,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl(), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
        encoding: 'utf8',
      },
    );
    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: expect.stringContaining('No difference detected'),
    });
  });
});
