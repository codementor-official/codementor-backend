/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/apps', '<rootDir>/libs'],
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: {
    // Đường sâu (`@codementor/platform/config/x`) như alias `@codementor/*/*` trong tsconfig:
    // cho phép import một file mà không kéo cả barrel (barrel nạp jwks-rsa, ESM, jest không chạy).
    '^@codementor/([^/]+)/(.+)$': '<rootDir>/libs/$1/src/$2',
    '^@codementor/(.*)$': '<rootDir>/libs/$1/src',
  },
  collectCoverageFrom: [
    'apps/**/*.ts',
    'libs/**/*.ts',
    '!**/*.module.ts',
    '!**/main.ts',
    '!**/*.dto.ts',
    '!**/*.public.ts',
    '!**/port/**',
    '!**/index.ts',
  ],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  coverageThreshold: {
    'apps/*/src/contexts/*/domain/model/*.ts': {
      branches: 70,
      functions: 50,
      lines: 65,
      statements: 65,
    },
  },
};
