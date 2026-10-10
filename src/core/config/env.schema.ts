import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de ao menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Rate limiting. Configurável porque cada aplicação tem um perfil de
  // tráfego diferente — e porque "edite o controller" é resposta ruim.
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT_DEFAULT: z.coerce.number().int().positive().default(100),
  THROTTLE_LIMIT_SENSITIVE: z.coerce.number().int().positive().default(5),
  // Cache de permissões. Desligável: nem todo projeto tem Redis, e a
  // resolução funciona sem ele.
  //
  // Não usar `z.coerce.boolean()`: ele aplica `Boolean(valor)`, e toda string
  // não-vazia vira `true` — `RBAC_CACHE_ENABLED=false` no .env ligaria o
  // cache. Aqui o literal é comparado explicitamente.
  RBAC_CACHE_ENABLED: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(true)
    .transform((v) => v === true || v === 'true'),
  RBAC_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MAIL_FROM: z.email(),
  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.coerce.number().int().positive(),
  APP_URL: z.url(),
});

export type Env = z.infer<typeof EnvSchema>;
