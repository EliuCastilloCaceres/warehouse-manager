/** @type {import('jest').Config} */
module.exports = {
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
  collectCoverageFrom: [
    '<rootDir>/src/shared/api/**/*.ts',
    '<rootDir>/src/features/auth/**/*.{ts,tsx}',
    '<rootDir>/src/features/branch/**/*.{ts,tsx}',
    '<rootDir>/src/shared/scan/**/*.{ts,tsx}',
    '!<rootDir>/src/shared/scan/cameraScanner.ts',
    '!<rootDir>/src/**/*.test.{ts,tsx}',
  ],
  coverageThreshold: {
    global: { lines: 80, branches: 80 },
    './src/shared/api/': { lines: 80, branches: 80 },
    './src/features/auth/': { lines: 80, branches: 80 },
    './src/features/branch/': { lines: 80, branches: 80 },
    './src/shared/scan/': { lines: 80, branches: 80 },
  },
};
