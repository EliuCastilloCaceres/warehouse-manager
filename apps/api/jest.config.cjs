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
  collectCoverageFrom: ['<rootDir>/prisma/seed/**/*.ts', '<rootDir>/src/core/password.ts'],
  coverageThreshold: {
    global: { lines: 80, branches: 80 },
  },
};
