/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/db/migrations/**',
    '!src/db/seeds/**',
    '!src/docs/**',
    '!src/server.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'cobertura'],
  coverageThreshold: {
    global: { statements: 55, branches: 45, functions: 55, lines: 55 },
  },
  setupFiles: ['<rootDir>/src/__tests__/setup-env.ts'],
  testTimeout: 15000,
};
