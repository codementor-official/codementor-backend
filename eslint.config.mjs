// Ranh giới kiến trúc được cưỡng chế ở đây, không chỉ nằm trong tài liệu.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

const APPS = ['core-service','learning-service','exercise-service','workspace-service','document-service','submission-service','judge-service','ai-service','realtime-service'];

// Service KHÔNG được import code của service khác. Muốn dùng thì qua libs/contracts.
const crossServiceZones = APPS.flatMap((from) =>
  APPS.filter((to) => to !== from).map((to) => ({
    target: `./apps/${from}`,
    from: `./apps/${to}`,
    message: `Service "${from}" không được import code của "${to}". Dùng HTTP client hoặc Kafka event trong libs/contracts — xem docs/02-service-architecture.md §4`,
  })),
);

// libs/kernel là DDD thuần: không được biết tới hạ tầng.
const kernelZones = [
  { target: './libs/kernel', from: './libs/platform', message: 'libs/kernel phải thuần TypeScript, không phụ thuộc hạ tầng' },
  { target: './libs/kernel', from: './libs/messaging', message: 'libs/kernel không được phụ thuộc messaging' },
  { target: './libs/contracts', from: './libs/platform', message: 'libs/contracts chỉ chứa kiểu dữ liệu, không phụ thuộc hạ tầng' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'generated/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'import/no-restricted-paths': ['error', { zones: [...crossServiceZones, ...kernelZones] }],
    },
  },
  {
    // Tầng domain phải thuần TypeScript: không framework, không ORM, không HTTP.
    // Đây là điều kiện để business logic không phụ thuộc NestJS/database.
    files: ['apps/*/src/contexts/*/domain/**/*.ts', 'libs/kernel/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'domain/ không được phụ thuộc NestJS' },
            { group: ['@prisma/*', 'prisma', '.prisma/*'], message: 'domain/ không được phụ thuộc Prisma' },
            { group: ['mongoose', '@nestjs/mongoose'], message: 'domain/ không được phụ thuộc Mongoose' },
            { group: ['fastify', 'express'], message: 'domain/ không được phụ thuộc HTTP framework' },
            { group: ['kafkajs'], message: 'domain/ không được phụ thuộc Kafka — phát event qua port EventBus' },
            { group: ['@codementor/messaging'], message: 'domain/ không được biết tới messaging; application layer mới phát event' },
            { group: ['@codementor/platform'], message: 'domain/ không được phụ thuộc hạ tầng' },
                      ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
