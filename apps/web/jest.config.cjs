/** @type {import('jest').Config} */
module.exports = {
  // Con la suite completa en paralelo, las pruebas de formularios grandes (p. ej. el selector de
  // zonas horarias de Ajustes) pueden pasar de los 5 s por defecto (decisión de F8, 2026-10-15).
  testTimeout: 15_000,
  testEnvironment: '<rootDir>/src/test/jsdom-environment.cjs',
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '\\.css$': 'identity-obj-proxy',
    '^@warehouse-manager/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // F3: el adaptador de cámara (cameraScanner.ts) se verifica a mano (CA7).
  // F4: users, F5: settings, F6: products, F7: warehouse y F8: pos, sin sus datos de prueba
  // (testing.ts); F5: shared/ticket.
  collectCoverageFrom: [
    '<rootDir>/src/shared/api/**/*.ts',
    '<rootDir>/src/features/auth/**/*.{ts,tsx}',
    '<rootDir>/src/features/branch/**/*.{ts,tsx}',
    '<rootDir>/src/shared/scan/**/*.{ts,tsx}',
    '!<rootDir>/src/shared/scan/cameraScanner.ts',
    '<rootDir>/src/features/users/**/*.{ts,tsx}',
    '!<rootDir>/src/features/users/testing.ts',
    '<rootDir>/src/features/settings/**/*.{ts,tsx}',
    '!<rootDir>/src/features/settings/testing.ts',
    '<rootDir>/src/shared/ticket/**/*.{ts,tsx}',
    '<rootDir>/src/features/products/**/*.{ts,tsx}',
    '!<rootDir>/src/features/products/testing.ts',
    '<rootDir>/src/features/warehouse/**/*.{ts,tsx}',
    '!<rootDir>/src/features/warehouse/testing.ts',
    '<rootDir>/src/features/pos/**/*.{ts,tsx}',
    '!<rootDir>/src/features/pos/testing.ts',
    '!<rootDir>/src/**/*.test.{ts,tsx}',
  ],
  coverageThreshold: {
    global: { lines: 80, branches: 80 },
    './src/shared/api/': { lines: 80, branches: 80 },
    './src/features/auth/': { lines: 80, branches: 80 },
    './src/features/branch/': { lines: 80, branches: 80 },
    './src/shared/scan/': { lines: 80, branches: 80 },
    './src/features/users/': { lines: 80, branches: 80 },
    './src/features/settings/': { lines: 80, branches: 80 },
    './src/shared/ticket/': { lines: 80, branches: 80 },
    './src/features/products/': { lines: 80, branches: 80 },
    './src/features/warehouse/': { lines: 80, branches: 80 },
    './src/features/pos/': { lines: 80, branches: 80 },
  },
};
