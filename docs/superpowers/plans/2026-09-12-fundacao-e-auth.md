# Fundação e Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma API NestJS com autenticação completa — registro, login, refresh token rotativo com detecção de reuso, reset de senha e verificação de e-mail — rodando sobre Postgres e Redis em Docker, com testes e2e cobrindo os fluxos críticos.

**Architecture:** NestJS modular por feature, com `src/core` para o que é transversal e `src/modules` para domínios. Prisma como ORM sobre Postgres. Access token JWT curto no header `Authorization`, refresh token opaco persistido em cookie httpOnly, rotacionado a cada uso e agrupado em família para detectar reuso. Senhas com Argon2. Este plano é o pré-requisito dos três seguintes (RBAC, gerador de módulo, billing).

**Tech Stack:** Node 24, NestJS 11, TypeScript, Prisma, PostgreSQL 16, Redis 7, Argon2, Zod, Pino, Jest, Supertest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-12-nestjs-rbac-boilerplate-design.md`

## Global Constraints

- **Runtime de dev e CI:** Node 24. Arquivo `.nvmrc` com `24`.
- **Piso de versão declarado:** `"engines": { "node": ">=20.19" }` no `package.json` — piso real do NestJS 11.
- **Hash de senha:** Argon2 (`argon2` package), nunca bcrypt.
- **Tokens de reset e verificação:** armazenados como hash SHA-256 no banco, nunca em texto puro.
- **Variáveis de ambiente:** validadas no boot com Zod. A aplicação não sobe com env inválido.
- **Multi-tenancy:** fora deste plano, mas o campo `tenantId String?` aparece nos modelos indicados e permanece sempre `null` na v1.
- **Estrutura:** `src/core/` para transversal, `src/modules/` para domínios. Nunca criar pastas de camada técnica no topo (`src/services/`, `src/controllers/`).
- **Commits:** um por tarefa, mensagem em inglês no formato Conventional Commits.
- **Testes:** TDD. O teste vem antes da implementação, e deve falhar antes de passar.

---

### Task 1: Scaffolding do projeto e validação de ambiente

**Files:**
- Create: `package.json`, `tsconfig.json`, `nest-cli.json`, `.nvmrc`, `.gitignore`, `.env.example`
- Create: `src/main.ts`, `src/app.module.ts`
- Create: `src/core/config/env.schema.ts`, `src/core/config/config.module.ts`
- Test: `test/config/env.schema.spec.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: `EnvSchema` (Zod schema), `Env` (tipo inferido), `ConfigModule` (módulo global do Nest expondo `ConfigService<Env>`)

- [ ] **Step 1: Inicializar o repositório git e o Node**

```bash
git init
echo "24" > .nvmrc
nvm install 24 && nvm use 24
npm init -y
```

- [ ] **Step 2: Instalar dependências**

```bash
npm install @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11 \
  @nestjs/config@^4 reflect-metadata rxjs zod
npm install -D typescript @types/node @nestjs/cli@^11 @nestjs/schematics@^11 \
  @nestjs/testing@^11 jest @types/jest ts-jest supertest @types/supertest \
  ts-node source-map-support
```

- [ ] **Step 3: Criar `package.json` com engines e scripts**

Editar `package.json` para conter:

```json
{
  "name": "nestjs-rbac-boilerplate",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=20.19" },
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config test/jest-e2e.json"
  }
}
```

- [ ] **Step 4: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "lib": ["ES2023"],
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": true,
    "paths": {
      "@core/*": ["src/core/*"],
      "@modules/*": ["src/modules/*"]
    }
  }
}
```

- [ ] **Step 5: Criar `nest-cli.json` e `.gitignore`**

`nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

`.gitignore`:

```
node_modules/
dist/
.env
*.log
coverage/
```

- [ ] **Step 6: Escrever o teste do schema de ambiente**

Criar `test/config/env.schema.spec.ts`:

```ts
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
    const { DATABASE_URL, ...incomplete } = validEnv;
    expect(() => EnvSchema.parse(incomplete)).toThrow();
  });

  it('rejeita JWT_ACCESS_SECRET com menos de 32 caracteres', () => {
    expect(() => EnvSchema.parse({ ...validEnv, JWT_ACCESS_SECRET: 'curto' })).toThrow();
  });

  it('rejeita DATABASE_URL que não é uma URL', () => {
    expect(() => EnvSchema.parse({ ...validEnv, DATABASE_URL: 'nao-e-url' })).toThrow();
  });
});
```

- [ ] **Step 7: Criar a config do Jest e rodar o teste para vê-lo falhar**

Adicionar ao `package.json`:

```json
"jest": {
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "collectCoverageFrom": ["src/**/*.(t|j)s"],
  "testEnvironment": "node"
}
```

Run: `npx jest test/config/env.schema.spec.ts`
Expected: FAIL — `Cannot find module '../../src/core/config/env.schema'`

- [ ] **Step 8: Implementar o schema de ambiente**

Criar `src/core/config/env.schema.ts`:

```ts
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de ao menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAIL_FROM: z.string().email(),
  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.coerce.number().int().positive(),
  APP_URL: z.string().url(),
});

export type Env = z.infer<typeof EnvSchema>;
```

- [ ] **Step 9: Rodar o teste para vê-lo passar**

Run: `npx jest test/config/env.schema.spec.ts`
Expected: PASS — 4 testes

- [ ] **Step 10: Criar o ConfigModule que valida no boot**

Criar `src/core/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { EnvSchema } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => EnvSchema.parse(raw),
    }),
  ],
})
export class ConfigModule {}
```

- [ ] **Step 11: Criar `app.module.ts` e `main.ts`**

`src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './core/config/config.module';

@Module({
  imports: [ConfigModule],
})
export class AppModule {}
```

`src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './core/config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
```

- [ ] **Step 12: Criar `.env.example`**

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/boilerplate
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=troque-isto-por-uma-string-de-32-caracteres-ou-mais
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
MAIL_FROM=noreply@example.com
MAIL_HOST=localhost
MAIL_PORT=1025
APP_URL=http://localhost:3000
```

- [ ] **Step 13: Verificar que a aplicação sobe e falha com env inválido**

```bash
cp .env.example .env
npm run build && node dist/main.js
```
Expected: sobe na porta 3000. Encerrar com Ctrl+C.

```bash
JWT_ACCESS_SECRET=curto node dist/main.js
```
Expected: falha no boot com erro do Zod mencionando `JWT_ACCESS_SECRET`.

- [ ] **Step 14: Commit**

```bash
git add .
git commit -m "feat: scaffold NestJS project with Zod-validated environment config"
```

---

### Task 2: Docker Compose, Prisma e o schema de usuário

**Files:**
- Create: `docker-compose.yml`, `prisma/schema.prisma`
- Create: `src/core/database/prisma.service.ts`, `src/core/database/database.module.ts`
- Modify: `src/app.module.ts`
- Test: `test/database/prisma.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigModule` da Task 1
- Produces: `PrismaService` (estende `PrismaClient`, com `onModuleInit`/`onModuleDestroy`), `DatabaseModule` (global), modelos `User`, `RefreshToken`, `VerificationToken`

- [ ] **Step 1: Criar o `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: boilerplate
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      retries: 5

  mailhog:
    image: mailhog/mailhog
    ports: ['1025:1025', '8025:8025']

volumes:
  pgdata:
```

- [ ] **Step 2: Subir a infraestrutura e confirmar que está saudável**

```bash
docker compose up -d
docker compose ps
```
Expected: `postgres` e `redis` com status `healthy`, `mailhog` rodando. Interface web do Mailhog em http://localhost:8025.

- [ ] **Step 3: Instalar o Prisma**

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 4: Escrever o schema Prisma**

Substituir `prisma/schema.prisma` por:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String
  name            String?
  emailVerifiedAt DateTime?
  tenantId        String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  refreshTokens      RefreshToken[]
  verificationTokens VerificationToken[]

  @@index([tenantId])
}

model RefreshToken {
  id         String    @id @default(cuid())
  tokenHash  String    @unique
  familyId   String
  userId     String
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
}

enum VerificationTokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

model VerificationToken {
  id        String                @id @default(cuid())
  tokenHash String                @unique
  type      VerificationTokenType
  userId    String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime              @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
}
```

Nota: `tokenHash` guarda SHA-256 do token, nunca o valor bruto. `familyId` agrupa refresh tokens de uma mesma sessão para permitir a detecção de reuso da Task 6.

- [ ] **Step 5: Rodar a primeira migration**

```bash
npx prisma migrate dev --name init
```
Expected: cria `prisma/migrations/<timestamp>_init/` e aplica no banco.

- [ ] **Step 6: Escrever o teste do PrismaService**

Criar `test/database/prisma.service.spec.ts`:

```ts
import { PrismaService } from '../../src/core/database/prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeAll(async () => {
    service = new PrismaService();
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('conecta ao banco e executa uma query', async () => {
    const result = await service.$queryRaw`SELECT 1 as one`;
    expect(result).toEqual([{ one: 1 }]);
  });

  it('expõe o model user', async () => {
    const count = await service.user.count();
    expect(typeof count).toBe('number');
  });
});
```

- [ ] **Step 7: Rodar o teste para vê-lo falhar**

Run: `npx jest test/database/prisma.service.spec.ts`
Expected: FAIL — `Cannot find module '../../src/core/database/prisma.service'`

- [ ] **Step 8: Implementar o PrismaService e o DatabaseModule**

Criar `src/core/database/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

Criar `src/core/database/database.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

- [ ] **Step 9: Rodar o teste para vê-lo passar**

Run: `npx jest test/database/prisma.service.spec.ts`
Expected: PASS — 2 testes

- [ ] **Step 10: Registrar o DatabaseModule no AppModule**

Substituir `src/app.module.ts` por:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './core/config/config.module';
import { DatabaseModule } from './core/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
})
export class AppModule {}
```

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: add Docker Compose infra and Prisma with user and token models"
```

---

### Task 3: Hashing de senha e de token

**Files:**
- Create: `src/core/crypto/password.service.ts`, `src/core/crypto/token.service.ts`, `src/core/crypto/crypto.module.ts`
- Test: `test/crypto/password.service.spec.ts`, `test/crypto/token.service.spec.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `PasswordService.hash(plain: string): Promise<string>`
  - `PasswordService.verify(hash: string, plain: string): Promise<boolean>`
  - `TokenService.generate(): { token: string; tokenHash: string }`
  - `TokenService.hash(token: string): string`
  - `CryptoModule` (global, exporta ambos)

- [ ] **Step 1: Instalar o Argon2**

```bash
npm install argon2
```

- [ ] **Step 2: Escrever o teste do PasswordService**

Criar `test/crypto/password.service.spec.ts`:

```ts
import { PasswordService } from '../../src/core/crypto/password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('gera um hash no formato argon2id', async () => {
    const hash = await service.hash('senha-secreta');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatório)', async () => {
    const a = await service.hash('senha-secreta');
    const b = await service.hash('senha-secreta');
    expect(a).not.toBe(b);
  });

  it('verifica uma senha correta', async () => {
    const hash = await service.hash('senha-secreta');
    await expect(service.verify(hash, 'senha-secreta')).resolves.toBe(true);
  });

  it('rejeita uma senha incorreta', async () => {
    const hash = await service.hash('senha-secreta');
    await expect(service.verify(hash, 'senha-errada')).resolves.toBe(false);
  });

  it('retorna false em vez de lançar quando o hash é malformado', async () => {
    await expect(service.verify('nao-e-um-hash', 'qualquer')).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Rodar o teste para vê-lo falhar**

Run: `npx jest test/crypto/password.service.spec.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 4: Implementar o PasswordService**

Criar `src/core/crypto/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 5: Rodar o teste para vê-lo passar**

Run: `npx jest test/crypto/password.service.spec.ts`
Expected: PASS — 5 testes

- [ ] **Step 6: Escrever o teste do TokenService**

Criar `test/crypto/token.service.spec.ts`:

```ts
import { TokenService } from '../../src/core/crypto/token.service';

describe('TokenService', () => {
  const service = new TokenService();

  it('gera um token url-safe de 64 caracteres hex', () => {
    const { token } = service.generate();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gera tokens diferentes a cada chamada', () => {
    expect(service.generate().token).not.toBe(service.generate().token);
  });

  it('devolve o hash correspondente ao token gerado', () => {
    const { token, tokenHash } = service.generate();
    expect(tokenHash).toBe(service.hash(token));
  });

  it('produz hash SHA-256 determinístico', () => {
    expect(service.hash('abc')).toBe(service.hash('abc'));
    expect(service.hash('abc')).not.toBe(service.hash('abd'));
  });

  it('nunca devolve o hash igual ao token', () => {
    const { token, tokenHash } = service.generate();
    expect(tokenHash).not.toBe(token);
  });
});
```

- [ ] **Step 7: Rodar o teste para vê-lo falhar**

Run: `npx jest test/crypto/token.service.spec.ts`
Expected: FAIL — módulo não encontrado

- [ ] **Step 8: Implementar o TokenService**

Criar `src/core/crypto/token.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class TokenService {
  generate(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
```

- [ ] **Step 9: Rodar o teste para vê-lo passar**

Run: `npx jest test/crypto/token.service.spec.ts`
Expected: PASS — 5 testes

- [ ] **Step 10: Criar o CryptoModule e registrá-lo**

Criar `src/core/crypto/crypto.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [PasswordService, TokenService],
  exports: [PasswordService, TokenService],
})
export class CryptoModule {}
```

Adicionar `CryptoModule` ao array `imports` de `src/app.module.ts`.

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: add Argon2 password hashing and SHA-256 token service"
```

---

### Task 4: Registro de usuário

**Files:**
- Create: `src/modules/users/users.service.ts`, `src/modules/users/users.module.ts`
- Create: `src/modules/auth/dto/register.dto.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.module.ts`
- Create: `src/core/common/validation.pipe.ts`
- Modify: `src/main.ts`, `src/app.module.ts`
- Test: `test/auth/register.e2e-spec.ts`, `test/jest-e2e.json`, `test/helpers/app.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 2), `PasswordService` (Task 3)
- Produces:
  - `UsersService.findByEmail(email: string): Promise<User | null>`
  - `UsersService.create(data: { email: string; passwordHash: string; name?: string }): Promise<User>`
  - `AuthService.register(dto: RegisterDto): Promise<{ id: string; email: string }>`
  - `POST /auth/register` → 201 `{ id, email }`
  - `createTestApp(): Promise<INestApplication>` (helper de teste)

- [ ] **Step 1: Instalar dependências de validação**

```bash
npm install class-validator class-transformer
npm install -D @nestjs/testing
```

- [ ] **Step 2: Criar a config de e2e e o helper de app de teste**

Criar `test/jest-e2e.json`:

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "maxWorkers": 1
}
```

Criar `test/helpers/app.ts`:

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/database/prisma.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.refreshToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}
```

- [ ] **Step 3: Escrever o teste e2e de registro**

Criar `test/auth/register.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from '../helpers/app';
import { PrismaService } from '../../src/core/database/prisma.service';

describe('POST /auth/register', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registra um usuário novo e devolve id e email', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'novo@example.com', password: 'SenhaForte123', name: 'Novo' })
      .expect(201);

    expect(res.body).toEqual({ id: expect.any(String), email: 'novo@example.com' });
  });

  it('nunca devolve o hash da senha na resposta', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'novo@example.com', password: 'SenhaForte123' })
      .expect(201);

    expect(JSON.stringify(res.body)).not.toContain('argon2');
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('persiste a senha como hash argon2, nunca em texto puro', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'novo@example.com', password: 'SenhaForte123' })
      .expect(201);

    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { email: 'novo@example.com' } });
    expect(user!.passwordHash).not.toBe('SenhaForte123');
    expect(user!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejeita e-mail duplicado com 409', async () => {
    const payload = { email: 'dup@example.com', password: 'SenhaForte123' };
    await request(app.getHttpServer()).post('/auth/register').send(payload).expect(201);
    await request(app.getHttpServer()).post('/auth/register').send(payload).expect(409);
  });

  it('rejeita e-mail inválido com 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'nao-e-email', password: 'SenhaForte123' })
      .expect(400);
  });

  it('rejeita senha com menos de 8 caracteres com 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'novo@example.com', password: 'curta' })
      .expect(400);
  });

  it('ignora campos não declarados no DTO', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'novo@example.com', password: 'SenhaForte123', isAdmin: true })
      .expect(201);

    expect(res.body.isAdmin).toBeUndefined();
  });
});
```

- [ ] **Step 4: Rodar o teste para vê-lo falhar**

Run: `npx jest --config test/jest-e2e.json test/auth/register.e2e-spec.ts`
Expected: FAIL — 404 nas rotas, ou erro de módulo não encontrado

- [ ] **Step 5: Implementar o UsersService**

Criar `src/modules/users/users.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: { email: string; passwordHash: string; name?: string }): Promise<User> {
    return this.prisma.user.create({ data });
  }
}
```

Criar `src/modules/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: Implementar o DTO de registro**

Criar `src/modules/auth/dto/register.dto.ts`:

```ts
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres' })
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}
```

- [ ] **Step 7: Implementar o AuthService com o método register**

Criar `src/modules/auth/auth.service.ts`:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { PasswordService } from '../../core/crypto/password.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('E-mail já cadastrado');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
    });

    return { id: user.id, email: user.email };
  }
}
```

- [ ] **Step 8: Implementar o controller e o módulo de auth**

Criar `src/modules/auth/auth.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<{ id: string; email: string }> {
    return this.auth.register(dto);
  }
}
```

Criar `src/modules/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 9: Registrar o AuthModule e o ValidationPipe global**

Adicionar `AuthModule` e `UsersModule` ao array `imports` de `src/app.module.ts`.

Em `src/main.ts`, adicionar antes do `app.listen`:

```ts
import { ValidationPipe } from '@nestjs/common';
// ...
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
```

- [ ] **Step 10: Rodar o teste para vê-lo passar**

Run: `npx jest --config test/jest-e2e.json test/auth/register.e2e-spec.ts`
Expected: PASS — 7 testes

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: add user registration with Argon2 password hashing"
```

---

### Task 5: Login e access token JWT

**Files:**
- Create: `src/modules/auth/dto/login.dto.ts`, `src/core/auth/jwt.strategy.ts`, `src/core/auth/jwt-auth.guard.ts`, `src/core/auth/current-user.decorator.ts`, `src/core/auth/public.decorator.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.module.ts`, `src/app.module.ts`
- Test: `test/auth/login.e2e-spec.ts`

**Interfaces:**
- Consumes: `UsersService`, `PasswordService`, `ConfigService<Env>`
- Produces:
  - `AuthService.login(dto: LoginDto): Promise<{ accessToken: string }>`
  - `JwtPayload = { sub: string; email: string }`
  - `@CurrentUser()` — injeta `User` no handler
  - `@Public()` — marca rota como não autenticada
  - `JwtAuthGuard` registrado globalmente
  - `POST /auth/login` → 200 `{ accessToken }`
  - `GET /auth/me` → 200 `{ id, email, name }`

- [ ] **Step 1: Instalar dependências de JWT**

```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install -D @types/passport-jwt
```

- [ ] **Step 2: Escrever o teste e2e de login**

Criar `test/auth/login.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from '../helpers/app';

describe('POST /auth/login', () => {
  let app: INestApplication;
  const credentials = { email: 'user@example.com', password: 'SenhaForte123' };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await request(app.getHttpServer()).post('/auth/register').send(credentials);
  });

  afterAll(async () => {
    await app.close();
  });

  it('devolve um access token para credenciais válidas', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send(credentials)
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.accessToken.split('.')).toHaveLength(3);
  });

  it('rejeita senha errada com 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ ...credentials, password: 'SenhaErrada123' })
      .expect(401);
  });

  it('rejeita e-mail inexistente com 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'naoexiste@example.com', password: 'SenhaForte123' })
      .expect(401);
  });

  it('usa a mesma mensagem para e-mail inexistente e senha errada', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ ...credentials, password: 'SenhaErrada123' });
    const wrongEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'naoexiste@example.com', password: 'SenhaForte123' });

    expect(wrongPassword.body.message).toBe(wrongEmail.body.message);
  });

  it('aceita o access token em GET /auth/me', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send(credentials);

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(credentials.email);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('rejeita GET /auth/me sem token com 401', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('rejeita GET /auth/me com token inválido com 401', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer token.invalido.aqui')
      .expect(401);
  });
});
```

- [ ] **Step 3: Rodar o teste para vê-lo falhar**

Run: `npx jest --config test/jest-e2e.json test/auth/login.e2e-spec.ts`
Expected: FAIL — 404 em `/auth/login`

- [ ] **Step 4: Criar o DTO de login**

Criar `src/modules/auth/dto/login.dto.ts`:

```ts
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
```

- [ ] **Step 5: Criar os decorators `@Public()` e `@CurrentUser()`**

Criar `src/core/auth/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

Criar `src/core/auth/current-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 6: Criar a estratégia JWT e o guard global**

Criar `src/core/auth/jwt.strategy.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { User } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../modules/users/users.service';
import type { Env } from '../config/env.schema';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
```

Criar `src/core/auth/jwt-auth.guard.ts`:

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }
}
```

- [ ] **Step 7: Implementar o login no AuthService**

Adicionar a `src/modules/auth/auth.service.ts` — novos imports e método:

```ts
import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../core/config/env.schema';
import { LoginDto } from './dto/login.dto';
```

Adicionar ao construtor: `private readonly jwt: JwtService`, `private readonly config: ConfigService<Env, true>`.

Adicionar o método:

```ts
async login(dto: LoginDto): Promise<{ accessToken: string }> {
  const user = await this.users.findByEmail(dto.email);
  // Mensagem idêntica para e-mail inexistente e senha errada: não vaza quais
  // e-mails estão cadastrados.
  const invalid = new UnauthorizedException('Credenciais inválidas');
  if (!user) {
    // Gasta o mesmo tempo de um verify real, para não vazar existência por timing.
    await this.passwords.verify('$argon2id$v=19$m=65536,t=3,p=4$invalid$invalid', dto.password);
    throw invalid;
  }

  const matches = await this.passwords.verify(user.passwordHash, dto.password);
  if (!matches) {
    throw invalid;
  }

  const accessToken = await this.jwt.signAsync(
    { sub: user.id, email: user.email },
    {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    },
  );

  return { accessToken };
}
```

- [ ] **Step 8: Adicionar as rotas ao controller**

Em `src/modules/auth/auth.controller.ts`, adicionar imports e rotas:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Public } from '../../core/auth/public.decorator';
import { LoginDto } from './dto/login.dto';
```

Marcar `register` com `@Public()` e adicionar:

```ts
@Public()
@Post('login')
@HttpCode(HttpStatus.OK)
login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
  return this.auth.login(dto);
}

@Get('me')
me(@CurrentUser() user: User): { id: string; email: string; name: string | null } {
  return { id: user.id, email: user.email, name: user.name };
}
```

- [ ] **Step 9: Registrar JwtModule, estratégia e guard global**

Substituir `src/modules/auth/auth.module.ts` por:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../../core/auth/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

Em `src/app.module.ts`, registrar o guard global:

```ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './core/auth/jwt-auth.guard';

// dentro do @Module:
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
```

- [ ] **Step 10: Rodar o teste para vê-lo passar**

Run: `npx jest --config test/jest-e2e.json test/auth/login.e2e-spec.ts`
Expected: PASS — 7 testes

- [ ] **Step 11: Rodar a suíte inteira para confirmar que nada quebrou**

Run: `npx jest && npx jest --config test/jest-e2e.json`
Expected: todos passam. O teste de registro continua verde porque `register` foi marcado `@Public()`.

- [ ] **Step 12: Commit**

```bash
git add .
git commit -m "feat: add login with JWT access token and global auth guard"
```

---

### Task 6: Refresh token rotativo com detecção de reuso

**Files:**
- Create: `src/modules/auth/refresh-token.service.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.module.ts`, `src/main.ts`
- Test: `test/auth/refresh.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `TokenService`, `ConfigService<Env>`
- Produces:
  - `RefreshTokenService.issue(userId: string, familyId?: string): Promise<string>` — devolve o token bruto
  - `RefreshTokenService.rotate(rawToken: string): Promise<{ userId: string; token: string }>`
  - `RefreshTokenService.revokeFamily(familyId: string): Promise<void>`
  - `POST /auth/refresh` → 200 `{ accessToken }`, novo cookie
  - `POST /auth/logout` → 204

Este é o núcleo de segurança do plano. A regra: cada refresh token vale uma
única vez. Ao ser usado, é revogado e um novo é emitido na mesma família. Se um
token já revogado for apresentado de novo, isso significa que alguém copiou o
token — a família inteira é invalidada.

- [ ] **Step 1: Instalar o parser de cookie**

```bash
npm install cookie-parser
npm install -D @types/cookie-parser
```

- [ ] **Step 2: Escrever o teste e2e de refresh**

Criar `test/auth/refresh.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from '../helpers/app';
import { PrismaService } from '../../src/core/database/prisma.service';

function cookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('refresh_token='))!.split(';')[0];
}

describe('POST /auth/refresh', () => {
  let app: INestApplication;
  const credentials = { email: 'user@example.com', password: 'SenhaForte123' };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await request(app.getHttpServer()).post('/auth/register').send(credentials);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login() {
    return request(app.getHttpServer()).post('/auth/login').send(credentials);
  }

  it('o login devolve um cookie httpOnly de refresh', async () => {
    const res = await login();
    const raw = res.headers['set-cookie'] as unknown as string[];
    const cookie = raw.find((c) => c.startsWith('refresh_token='))!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('troca um refresh token válido por um novo access token', async () => {
    const res = await login();
    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookieFrom(res))
      .expect(200);

    expect(refreshed.body.accessToken).toEqual(expect.any(String));
  });

  it('rotaciona o token: o cookie devolvido é diferente do enviado', async () => {
    const res = await login();
    const original = cookieFrom(res);
    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', original)
      .expect(200);

    expect(cookieFrom(refreshed)).not.toBe(original);
  });

  it('rejeita o token antigo depois da rotação', async () => {
    const res = await login();
    const original = cookieFrom(res);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(200);

    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(401);
  });

  it('invalida a família inteira quando um token já usado reaparece', async () => {
    const res = await login();
    const original = cookieFrom(res);
    const first = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', original)
      .expect(200);
    const current = cookieFrom(first);

    // Reuso do token antigo: dispara a detecção
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(401);

    // O token que era válido também morre junto com a família
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', current).expect(401);
  });

  it('rejeita requisição sem cookie com 401', async () => {
    await request(app.getHttpServer()).post('/auth/refresh').expect(401);
  });

  it('rejeita um token que não existe no banco com 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${'0'.repeat(64)}`)
      .expect(401);
  });

  it('rejeita um token expirado com 401', async () => {
    const res = await login();
    const prisma = app.get(PrismaService);
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookieFrom(res))
      .expect(401);
  });

  it('nunca grava o token bruto no banco', async () => {
    const res = await login();
    const raw = cookieFrom(res).split('=')[1];
    const prisma = app.get(PrismaService);
    const stored = await prisma.refreshToken.findFirst();

    expect(stored!.tokenHash).not.toBe(raw);
  });

  it('logout revoga a família e limpa o cookie', async () => {
    const res = await login();
    const cookie = cookieFrom(res);
    const out = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);

    const cleared = (out.headers['set-cookie'] as unknown as string[])[0];
    expect(cleared).toContain('refresh_token=;');

    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });
});
```

- [ ] **Step 3: Rodar o teste para vê-lo falhar**

Run: `npx jest --config test/jest-e2e.json test/auth/refresh.e2e-spec.ts`
Expected: FAIL — não há cookie `refresh_token` na resposta do login

- [ ] **Step 4: Implementar o RefreshTokenService**

Criar `src/modules/auth/refresh-token.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../core/config/env.schema';
import { TokenService } from '../../core/crypto/token.service';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private expiryDate(): Date {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  async issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    const { token, tokenHash } = this.tokens.generate();
    await this.prisma.refreshToken.create({
      data: { tokenHash, familyId, userId, expiresAt: this.expiryDate() },
    });
    return token;
  }

  async rotate(rawToken: string): Promise<{ userId: string; token: string }> {
    const tokenHash = this.tokens.hash(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    // Reuso detectado: o token já foi rotacionado antes. Alguém tem uma cópia.
    // Mata a família inteira — todas as sessões derivadas deste login.
    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const token = await this.issue(stored.userId, stored.familyId);
    return { userId: stored.userId, token };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByToken(rawToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hash(rawToken) },
    });
    if (stored) {
      await this.revokeFamily(stored.familyId);
    }
  }
}
```

- [ ] **Step 5: Ajustar o AuthService para emitir e renovar**

Em `src/modules/auth/auth.service.ts`, injetar `private readonly refreshTokens: RefreshTokenService` no construtor e extrair a assinatura do access token para um método reutilizável:

```ts
private signAccessToken(user: { id: string; email: string }): Promise<string> {
  return this.jwt.signAsync(
    { sub: user.id, email: user.email },
    {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    },
  );
}
```

Substituir o final do `login` para devolver também o refresh token:

```ts
async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
  // ... validação de credenciais igual à Task 5 ...
  const accessToken = await this.signAccessToken(user);
  const refreshToken = await this.refreshTokens.issue(user.id);
  return { accessToken, refreshToken };
}

async refresh(rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const { userId, token } = await this.refreshTokens.rotate(rawToken);
  const user = await this.users.findById(userId);
  if (!user) {
    throw new UnauthorizedException('Refresh token inválido');
  }
  return { accessToken: await this.signAccessToken(user), refreshToken: token };
}
```

- [ ] **Step 6: Ajustar o controller para escrever o cookie**

Em `src/modules/auth/auth.controller.ts`, adicionar imports:

```ts
import { Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../core/config/env.schema';
```

Injetar `private readonly config: ConfigService<Env, true>` no construtor e adicionar:

```ts
private setRefreshCookie(res: Response, token: string): void {
  const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
    sameSite: 'strict',
    path: '/auth',
    maxAge: days * 24 * 60 * 60 * 1000,
  });
}
```

Substituir o `login` e adicionar `refresh` e `logout`:

```ts
@Public()
@Post('login')
@HttpCode(HttpStatus.OK)
async login(
  @Body() dto: LoginDto,
  @Res({ passthrough: true }) res: Response,
): Promise<{ accessToken: string }> {
  const { accessToken, refreshToken } = await this.auth.login(dto);
  this.setRefreshCookie(res, refreshToken);
  return { accessToken };
}

@Public()
@Post('refresh')
@HttpCode(HttpStatus.OK)
async refresh(
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
): Promise<{ accessToken: string }> {
  const raw = req.cookies?.refresh_token;
  if (!raw) {
    throw new UnauthorizedException('Refresh token ausente');
  }
  const { accessToken, refreshToken } = await this.auth.refresh(raw);
  this.setRefreshCookie(res, refreshToken);
  return { accessToken };
}

@Public()
@Post('logout')
@HttpCode(HttpStatus.NO_CONTENT)
async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
  const raw = req.cookies?.refresh_token;
  if (raw) {
    await this.auth.logout(raw);
  }
  res.clearCookie('refresh_token', { path: '/auth' });
}
```

Adicionar ao `AuthService`:

```ts
logout(rawToken: string): Promise<void> {
  return this.refreshTokens.revokeByToken(rawToken);
}
```

Importar `UnauthorizedException` no controller.

- [ ] **Step 7: Registrar o RefreshTokenService e o cookie-parser**

Adicionar `RefreshTokenService` ao array `providers` de `src/modules/auth/auth.module.ts`.

Em `src/main.ts`, antes do `useGlobalPipes`:

```ts
import cookieParser from 'cookie-parser';
// ...
app.use(cookieParser());
```

Em `test/helpers/app.ts`, adicionar a mesma linha antes do `app.init()`:

```ts
import cookieParser from 'cookie-parser';
// ...
app.use(cookieParser());
```

- [ ] **Step 8: Rodar o teste para vê-lo passar**

Run: `npx jest --config test/jest-e2e.json test/auth/refresh.e2e-spec.ts`
Expected: PASS — 10 testes

- [ ] **Step 9: Rodar a suíte inteira**

Run: `npx jest && npx jest --config test/jest-e2e.json`
Expected: todos passam.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat: add rotating refresh tokens with reuse detection"
```

---

### Task 7: Verificação de e-mail e reset de senha

**Files:**
- Create: `src/core/mail/mail.service.ts`, `src/core/mail/mail.module.ts`
- Create: `src/modules/auth/verification.service.ts`
- Create: `src/modules/auth/dto/request-reset.dto.ts`, `src/modules/auth/dto/reset-password.dto.ts`, `src/modules/auth/dto/verify-email.dto.ts`
- Modify: `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.module.ts`, `src/app.module.ts`
- Test: `test/auth/verification.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `TokenService`, `PasswordService`, `UsersService`, `RefreshTokenService`
- Produces:
  - `MailService.send(to: string, subject: string, body: string): Promise<void>`
  - `VerificationService.issue(userId, type): Promise<string>`
  - `VerificationService.consume(rawToken, type): Promise<string>` — devolve `userId`
  - `POST /auth/verify-email`, `POST /auth/request-password-reset`, `POST /auth/reset-password`

- [ ] **Step 1: Instalar o nodemailer**

```bash
npm install nodemailer
npm install -D @types/nodemailer
```

- [ ] **Step 2: Escrever o teste e2e**

Criar `test/auth/verification.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from '../helpers/app';
import { PrismaService } from '../../src/core/database/prisma.service';
import { MailService } from '../../src/core/mail/mail.service';

describe('Verificação de e-mail e reset de senha', () => {
  let app: INestApplication;
  let sent: Array<{ to: string; body: string }>;
  const credentials = { email: 'user@example.com', password: 'SenhaForte123' };

  beforeAll(async () => {
    app = await createTestApp();
    const mail = app.get(MailService);
    jest.spyOn(mail, 'send').mockImplementation(async (to, _subject, body) => {
      sent.push({ to, body });
    });
  });

  beforeEach(async () => {
    sent = [];
    await resetDatabase(app);
    await request(app.getHttpServer()).post('/auth/register').send(credentials);
  });

  afterAll(async () => {
    await app.close();
  });

  function tokenFromLastMail(): string {
    return sent[sent.length - 1].body.match(/token=([a-f0-9]{64})/)![1];
  }

  it('o registro dispara um e-mail de verificação', () => {
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(credentials.email);
  });

  it('verifica o e-mail com um token válido', async () => {
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: tokenFromLastMail() })
      .expect(204);

    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { email: credentials.email } });
    expect(user!.emailVerifiedAt).not.toBeNull();
  });

  it('rejeita o mesmo token de verificação na segunda vez', async () => {
    const token = tokenFromLastMail();
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(204);
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(400);
  });

  it('rejeita um token de verificação inexistente', async () => {
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: '0'.repeat(64) })
      .expect(400);
  });

  it('nunca grava o token de verificação em texto puro', async () => {
    const token = tokenFromLastMail();
    const prisma = app.get(PrismaService);
    const stored = await prisma.verificationToken.findFirst();
    expect(stored!.tokenHash).not.toBe(token);
  });

  it('responde 204 ao pedir reset, mesmo para e-mail inexistente', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: 'naoexiste@example.com' })
      .expect(204);

    // Nenhum e-mail novo foi enviado, mas a resposta não denuncia isso.
    expect(sent).toHaveLength(1);
  });

  it('redefine a senha com um token válido', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: credentials.email })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: tokenFromLastMail(), password: 'NovaSenha456' })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: 'NovaSenha456' })
      .expect(200);

    await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(401);
  });

  it('revoga todas as sessões ao redefinir a senha', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send(credentials);
    const raw = login.headers['set-cookie'] as unknown as string[];
    const cookie = raw.find((c) => c.startsWith('refresh_token='))!.split(';')[0];

    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: credentials.email });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: tokenFromLastMail(), password: 'NovaSenha456' })
      .expect(204);

    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('rejeita o token de reset na segunda vez', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: credentials.email });
    const token = tokenFromLastMail();

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'NovaSenha456' })
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'OutraSenha789' })
      .expect(400);
  });

  it('rejeita um token de reset expirado', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: credentials.email });
    const token = tokenFromLastMail();

    const prisma = app.get(PrismaService);
    await prisma.verificationToken.updateMany({
      where: { type: 'PASSWORD_RESET' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token, password: 'NovaSenha456' })
      .expect(400);
  });

  it('não aceita um token de verificação como token de reset', async () => {
    const verificationToken = tokenFromLastMail();
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: verificationToken, password: 'NovaSenha456' })
      .expect(400);
  });
});
```

- [ ] **Step 3: Rodar o teste para vê-lo falhar**

Run: `npx jest --config test/jest-e2e.json test/auth/verification.e2e-spec.ts`
Expected: FAIL — `MailService` não existe

- [ ] **Step 4: Implementar o MailService**

Criar `src/core/mail/mail.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import type { Env } from '../config/env.schema';

@Injectable()
export class MailService {
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.transporter = createTransport({
      host: this.config.get('MAIL_HOST', { infer: true }),
      port: this.config.get('MAIL_PORT', { infer: true }),
      secure: false,
    });
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM', { infer: true }),
      to,
      subject,
      text: body,
    });
  }
}
```

Criar `src/core/mail/mail.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
```

Adicionar `MailModule` ao `imports` de `src/app.module.ts`.

- [ ] **Step 5: Implementar o VerificationService**

Criar `src/modules/auth/verification.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { VerificationTokenType } from '@prisma/client';
import { TokenService } from '../../core/crypto/token.service';
import { PrismaService } from '../../core/database/prisma.service';

const TTL_BY_TYPE: Record<VerificationTokenType, number> = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async issue(userId: string, type: VerificationTokenType): Promise<string> {
    const { token, tokenHash } = this.tokens.generate();
    await this.prisma.verificationToken.create({
      data: {
        tokenHash,
        type,
        userId,
        expiresAt: new Date(Date.now() + TTL_BY_TYPE[type]),
      },
    });
    return token;
  }

  async consume(rawToken: string, type: VerificationTokenType): Promise<string> {
    const stored = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(rawToken) },
    });

    const invalid = new BadRequestException('Token inválido ou expirado');
    // O tipo faz parte da validação: um token de verificação de e-mail não
    // pode ser usado para redefinir senha.
    if (!stored || stored.type !== type || stored.usedAt || stored.expiresAt < new Date()) {
      throw invalid;
    }

    await this.prisma.verificationToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    });

    return stored.userId;
  }
}
```

- [ ] **Step 6: Criar os DTOs**

`src/modules/auth/dto/verify-email.dto.ts`:

```ts
import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @Length(64, 64)
  token!: string;
}
```

`src/modules/auth/dto/request-reset.dto.ts`:

```ts
import { IsEmail } from 'class-validator';

export class RequestResetDto {
  @IsEmail()
  email!: string;
}
```

`src/modules/auth/dto/reset-password.dto.ts`:

```ts
import { IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Length(64, 64)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa de ao menos 8 caracteres' })
  password!: string;
}
```

- [ ] **Step 7: Implementar os fluxos no AuthService**

Injetar no construtor do `AuthService`: `private readonly verification: VerificationService`, `private readonly mail: MailService`, `private readonly prisma: PrismaService`.

Ao final do `register`, antes do `return`, disparar a verificação:

```ts
const token = await this.verification.issue(user.id, 'EMAIL_VERIFICATION');
const appUrl = this.config.get('APP_URL', { infer: true });
await this.mail.send(
  user.email,
  'Confirme seu e-mail',
  `Acesse ${appUrl}/verify-email?token=${token} para confirmar seu e-mail.`,
);
```

Adicionar os três métodos:

```ts
async verifyEmail(token: string): Promise<void> {
  const userId = await this.verification.consume(token, 'EMAIL_VERIFICATION');
  await this.prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
}

async requestPasswordReset(email: string): Promise<void> {
  const user = await this.users.findByEmail(email);
  // Silêncio proposital: responder 204 mesmo sem usuário evita que a rota
  // vire um oráculo de quais e-mails estão cadastrados.
  if (!user) {
    return;
  }

  const token = await this.verification.issue(user.id, 'PASSWORD_RESET');
  const appUrl = this.config.get('APP_URL', { infer: true });
  await this.mail.send(
    user.email,
    'Redefinição de senha',
    `Acesse ${appUrl}/reset-password?token=${token} para redefinir sua senha.`,
  );
}

async resetPassword(token: string, password: string): Promise<void> {
  const userId = await this.verification.consume(token, 'PASSWORD_RESET');
  const passwordHash = await this.passwords.hash(password);

  await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Trocar a senha derruba todas as sessões: é o que o usuário espera de um
  // reset feito porque a conta foi comprometida.
  await this.prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
```

- [ ] **Step 8: Adicionar as rotas ao controller**

```ts
@Public()
@Post('verify-email')
@HttpCode(HttpStatus.NO_CONTENT)
verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
  return this.auth.verifyEmail(dto.token);
}

@Public()
@Post('request-password-reset')
@HttpCode(HttpStatus.NO_CONTENT)
requestPasswordReset(@Body() dto: RequestResetDto): Promise<void> {
  return this.auth.requestPasswordReset(dto.email);
}

@Public()
@Post('reset-password')
@HttpCode(HttpStatus.NO_CONTENT)
resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
  return this.auth.resetPassword(dto.token, dto.password);
}
```

Importar os três DTOs.

- [ ] **Step 9: Registrar o VerificationService**

Adicionar `VerificationService` ao array `providers` de `src/modules/auth/auth.module.ts`.

- [ ] **Step 10: Rodar o teste para vê-lo passar**

Run: `npx jest --config test/jest-e2e.json test/auth/verification.e2e-spec.ts`
Expected: PASS — 11 testes

- [ ] **Step 11: Rodar a suíte inteira**

Run: `npx jest && npx jest --config test/jest-e2e.json`
Expected: todos passam.

- [ ] **Step 12: Commit**

```bash
git add .
git commit -m "feat: add email verification and password reset flows"
```

---

### Task 8: Rate limiting, logging estruturado e health check

**Files:**
- Create: `src/core/common/health.controller.ts`
- Modify: `src/app.module.ts`, `src/main.ts`, `src/modules/auth/auth.controller.ts`
- Test: `test/common/health.e2e-spec.ts`, `test/auth/throttle.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ConfigService<Env>`
- Produces: `GET /health/live` → 200, `GET /health/ready` → 200 ou 503; `ThrottlerGuard` global

- [ ] **Step 1: Instalar as dependências**

```bash
npm install @nestjs/throttler nestjs-pino pino-http pino-pretty
```

- [ ] **Step 2: Escrever o teste de health check**

Criar `test/common/health.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/app';

describe('Health check', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live responde 200 sem autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready responde 200 quando o banco está acessível', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.database).toBe('up');
  });
});
```

- [ ] **Step 3: Rodar o teste para vê-lo falhar**

Run: `npx jest --config test/jest-e2e.json test/common/health.e2e-spec.ts`
Expected: FAIL — 404

- [ ] **Step 4: Implementar o health controller**

Criar `src/core/common/health.controller.ts`:

```ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness: o processo está de pé. Não toca em dependências — se ele
  // falhar, o orquestrador reinicia o container.
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  // Readiness: pronto para receber tráfego. Falha se o banco caiu, para que o
  // load balancer tire esta instância da rotação sem reiniciá-la.
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}
```

Adicionar `HealthController` ao array `controllers` de `src/app.module.ts`.

- [ ] **Step 5: Rodar o teste para vê-lo passar**

Run: `npx jest --config test/jest-e2e.json test/common/health.e2e-spec.ts`
Expected: PASS — 2 testes

- [ ] **Step 6: Escrever o teste de rate limiting**

Criar `test/auth/throttle.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from '../helpers/app';

describe('Rate limiting em /auth/login', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('bloqueia com 429 após 5 tentativas de login no mesmo minuto', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'user@example.com', password: 'SenhaErrada123' });

    for (let i = 0; i < 5; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
    }

    const blocked = await attempt();
    expect(blocked.status).toBe(429);
  });

  it('não aplica o limite estrito em GET /health/live', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    }
  });
});
```

- [ ] **Step 7: Rodar o teste para vê-lo falhar**

Run: `npx jest --config test/jest-e2e.json test/auth/throttle.e2e-spec.ts`
Expected: FAIL — a sexta tentativa devolve 401, não 429

- [ ] **Step 8: Configurar o ThrottlerModule**

Em `src/app.module.ts`, adicionar aos imports:

```ts
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

// dentro de imports:
ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),

// dentro de providers, ANTES do JwtAuthGuard:
{ provide: APP_GUARD, useClass: ThrottlerGuard },
```

Em `src/modules/auth/auth.controller.ts`, aplicar o limite estrito às rotas sensíveis:

```ts
import { Throttle } from '@nestjs/throttler';
```

Anotar `login`, `register`, `request-password-reset` e `reset-password` com:

```ts
@Throttle({ default: { limit: 5, ttl: 60_000 } })
```

- [ ] **Step 9: Rodar o teste para vê-lo passar**

Run: `npx jest --config test/jest-e2e.json test/auth/throttle.e2e-spec.ts`
Expected: PASS — 2 testes

- [ ] **Step 10: Configurar o logging estruturado**

Em `src/app.module.ts`, adicionar aos imports:

```ts
import { LoggerModule } from 'nestjs-pino';

LoggerModule.forRoot({
  pinoHttp: {
    // Cada log carrega o request id, que é o que permite rastrear uma
    // requisição inteira em produção.
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
  },
}),
```

Importar `randomUUID` de `node:crypto`.

Em `src/main.ts`, após criar o app:

```ts
import { Logger } from 'nestjs-pino';
// ...
app.useLogger(app.get(Logger));
```

- [ ] **Step 11: Verificar que senhas e tokens não aparecem no log**

```bash
npm run build && NODE_ENV=development node dist/main.js
```

Em outro terminal:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"SenhaSecreta123"}'
```

Expected: no log da aplicação, o campo `password` aparece como `[Redacted]` e o header `authorization` também. Encerrar com Ctrl+C.

- [ ] **Step 12: Rodar a suíte inteira**

Run: `npx jest && npx jest --config test/jest-e2e.json`
Expected: todos passam.

- [ ] **Step 13: Commit**

```bash
git add .
git commit -m "feat: add health checks, rate limiting and structured logging"
```

---

### Task 9: Seed, Dockerfile de produção e CI

**Files:**
- Create: `prisma/seed.ts`, `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`
- Create: `eslint.config.mjs`, `.prettierrc`
- Modify: `package.json`
- Test: nenhum novo — esta tarefa garante que a suíte existente roda no CI

**Interfaces:**
- Consumes: `PrismaClient`, `PasswordService`
- Produces: comando `npm run seed`, imagem Docker de produção, pipeline de CI

- [ ] **Step 1: Instalar lint e formatação**

```bash
npm install -D eslint @eslint/js typescript-eslint eslint-config-prettier \
  eslint-plugin-prettier prettier
```

- [ ] **Step 2: Criar a config do ESLint e do Prettier**

`eslint.config.mjs`:

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'] },
);
```

`.prettierrc`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Adicionar aos scripts do `package.json`:

```json
"lint": "eslint \"{src,test}/**/*.ts\" --fix",
"format": "prettier --write \"{src,test}/**/*.ts\"",
"seed": "ts-node prisma/seed.ts"
```

- [ ] **Step 3: Escrever o seed**

Criar `prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123';

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: 'Admin',
      emailVerifiedAt: new Date(),
    },
  });

  console.log(`Seed concluído. Usuário admin: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
```

Nota para o executor: na Task de RBAC (plano 2) este seed passa a criar também os papéis de sistema. Deixe o arquivo preparado para crescer.

- [ ] **Step 4: Rodar o seed e verificar**

```bash
npm run seed
```
Expected: imprime "Seed concluído" e o usuário aparece no banco. Rodar duas vezes não duplica — o `upsert` garante idempotência.

- [ ] **Step 5: Criar o Dockerfile multi-stage**

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=builder /app/dist ./dist

# Não rodar como root: se a aplicação for comprometida, o atacante não
# começa com privilégio total no container.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

`.dockerignore`:

```
node_modules
dist
.git
.env
coverage
docs
```

- [ ] **Step 6: Verificar que a imagem constrói e sobe**

```bash
docker build -t boilerplate:test .
docker run --rm --env-file .env --network host boilerplate:test &
sleep 5 && curl -f http://localhost:3000/health/live
```
Expected: `{"status":"ok"}`. Encerrar o container.

- [ ] **Step 7: Criar o workflow de CI**

Criar `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node: ['20.19', '24']

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: boilerplate_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s
          --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s
          --health-timeout 5s --health-retries 10

    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/boilerplate_test
      REDIS_URL: redis://localhost:6379
      JWT_ACCESS_SECRET: ci-secret-com-no-minimo-32-caracteres-aqui
      JWT_ACCESS_TTL: 15m
      REFRESH_TOKEN_TTL_DAYS: 30
      MAIL_FROM: noreply@example.com
      MAIL_HOST: localhost
      MAIL_PORT: 1025
      APP_URL: http://localhost:3000

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npx prisma generate
      - run: npm run lint -- --max-warnings 0
      - run: npm run build
      - run: npx jest
      - run: npx jest --config test/jest-e2e.json
```

Nota: a matriz roda nas duas pontas do range declarado em `engines` — 20.19 é o piso do NestJS 11, 24 é o LTS de desenvolvimento. É isso que torna honesta a linha de compatibilidade na documentação.

- [ ] **Step 8: Rodar lint e corrigir o que aparecer**

Run: `npm run lint`
Expected: sem erros. Corrigir o que o `--fix` não resolver sozinho.

- [ ] **Step 9: Rodar a suíte inteira uma última vez**

Run: `npm run build && npx jest && npx jest --config test/jest-e2e.json`
Expected: todos passam.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "chore: add seed, production Dockerfile, linting and CI pipeline"
```

---

## Critério de pronto deste plano

O plano está completo quando:

1. `docker compose up -d` sobe Postgres, Redis e Mailhog saudáveis
2. `npm run seed` cria o usuário admin de forma idempotente
3. Um usuário consegue: registrar, receber e-mail de verificação, verificar, logar, renovar o access token, pedir reset, redefinir a senha e deslogar
4. Reusar um refresh token já rotacionado derruba a família inteira
5. `GET /health/live` e `GET /health/ready` respondem sem autenticação
6. Seis tentativas de login em um minuto resultam em 429
7. Senhas e tokens não aparecem em log nem em resposta de API
8. `npx jest` e `npx jest --config test/jest-e2e.json` passam
9. O CI passa nas duas versões de Node da matriz

## O que vem depois

**Plano 2 — RBAC.** O catálogo type-safe de permissões, os modelos `Role`,
`RoleGrant` e `UserRole`, o `PermissionGuard` para rota e recurso, o
`scopeFor()` para listagens, a validação de permissões no boot e a matriz de
testes. Depende deste plano.

**Plano 3 — Gerador de módulo.** Depende do plano 2.

**Plano 4 — Billing e filas.** Depende deste plano e toca o plano 2, porque
planos de assinatura mapeiam para papéis.
