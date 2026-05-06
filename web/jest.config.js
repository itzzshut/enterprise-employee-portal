/**
 * jest-preset-angular instead of Karma + Chrome Headless.
 *
 * The CI agents are alpine Node containers with no browser, and spinning up
 * Chromium purely to assert on signal values is a slow, flaky way to do it.
 * Jest runs the same specs in jsdom in a fraction of the time and emits the
 * JUnit XML and cobertura coverage that the Jenkins post-steps publish.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/app/core/$1',
    '^@shared/(.*)$': '<rootDir>/src/app/shared/$1',
    '^@features/(.*)$': '<rootDir>/src/app/features/$1',
    '^@layout/(.*)$': '<rootDir>/src/app/layout/$1',
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/app/**/*.spec.ts',
    '!src/app/**/*.routes.ts',
    '!src/app/core/models/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'cobertura'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
