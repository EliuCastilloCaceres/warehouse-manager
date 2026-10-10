const tsJest = [
  'ts-jest',
  {
    tsconfig: '<rootDir>/tsconfig.test.json',
    // El cliente de Prisma usa import.meta.url; ver test/jest/import-meta-transformer.cjs.
    astTransformers: { before: ['<rootDir>/test/jest/import-meta-transformer.cjs'] },
  },
];

const shared = {
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': tsJest },
  moduleNameMapper: {
    '^@warehouse-manager/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

/** @type {import('jest').Config} */
module.exports = {
  // Con la caché de Jest fría, cargar Fastify + Swagger UI (ESM vía require(esm)) o preparar
  // la BD puede pasar de los 5 s por defecto en un hook.
  testTimeout: 30_000,
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: [
        '<rootDir>/src/**/*.test.ts',
        '<rootDir>/test/unit/**/*.test.ts',
        '<rootDir>/test/parity/**/*.test.ts',
      ],
    },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.int.test.ts'],
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
    },
  ],
  // F1: seeds + password.ts · F2: core, auth e inventory.
  collectCoverageFrom: [
    '<rootDir>/prisma/seed/**/*.ts',
    '<rootDir>/src/core/**/*.ts',
    '<rootDir>/src/modules/auth/**/*.ts',
    '<rootDir>/src/modules/inventory/**/*.ts',
    '!<rootDir>/src/**/*.test.ts',
  ],
  coverageThreshold: {
    global: { lines: 80, branches: 80 },
    './prisma/seed/': { lines: 80, branches: 80 },
    './src/core/': { lines: 80, branches: 80 },
    './src/modules/auth/': { lines: 80, branches: 80 },
    './src/modules/inventory/': { lines: 80, branches: 80 },
  },
};
