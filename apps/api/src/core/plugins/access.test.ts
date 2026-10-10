import { fakePrisma, testConfig } from '../../../test/helpers/config.js';
import { buildApp } from '../../app.js';

describe('access: config.access obligatorio (T9)', () => {
  it('buildApp falla con una ruta sin config.access y nombra método y URL', async () => {
    await expect(
      buildApp(testConfig(), {
        prisma: fakePrisma(),
        logger: false,
        registerExtra: (api) => {
          api.get('/test/sin-acceso', async () => ({ ok: true }));
        },
      }),
    ).rejects.toThrow('La ruta GET /api/v1/test/sin-acceso no declara config.access');
  });

  it('con config.access arranca', async () => {
    const app = await buildApp(testConfig(), {
      prisma: fakePrisma(),
      logger: false,
      registerExtra: (api) => {
        api.get('/test/con-acceso', { config: { access: 'public' } }, async () => ({ ok: true }));
      },
    });
    try {
      await app.ready();
      const res = await app.inject({ method: 'GET', url: '/api/v1/test/con-acceso' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
