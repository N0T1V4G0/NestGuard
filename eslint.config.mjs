import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Promise sem await é a origem mais comum de erro silencioso em código
      // assíncrono — aqui, um e-mail que nunca é enviado ou um token que
      // nunca é revogado.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  {
    // Testes acessam internals e usam mocks: as regras de tipagem estrita
    // geram mais ruído que valor aqui.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `app.getHttpServer()` é tipado como `any` pelo supertest. Manter a
      // regra aqui só produziria ruído em toda chamada de request().
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'prisma/migrations/**'] },
);
