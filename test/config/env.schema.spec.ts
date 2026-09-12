import { EnvSchema } from '../../src/core/config/env.schema';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: '30',
  MAIL_FROM: 'noreply@example.com',
  MAIL_HOST: 'localhost',
  MAIL_PORT: '1025',
  APP_URL: 'http://localhost:3000',
};

describe('EnvSchema', () => {
  it('aceita um ambiente válido e converte tipos numéricos', () => {
    const parsed = EnvSchema.parse(validEnv);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it('rejeita quando falta uma variável obrigatória', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitir a chave é o objetivo
    const { DATABASE_URL, ...incomplete } = validEnv;
    expect(() => EnvSchema.parse(incomplete)).toThrow();
  });

  it('rejeita JWT_ACCESS_SECRET com menos de 32 caracteres', () => {
    expect(() => EnvSchema.parse({ ...validEnv, JWT_ACCESS_SECRET: 'curto' })).toThrow();
  });

  it('rejeita DATABASE_URL que não é uma URL', () => {
    expect(() => EnvSchema.parse({ ...validEnv, DATABASE_URL: 'nao-e-url' })).toThrow();
  });

  it('rejeita NODE_ENV fora dos valores permitidos', () => {
    expect(() => EnvSchema.parse({ ...validEnv, NODE_ENV: 'staging' })).toThrow();
  });
});
