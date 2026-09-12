import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/database/prisma.service';

/**
 * Sobe a aplicação para testes.
 *
 * `env` sobrescreve variáveis de configuração. Precisa interceptar o
 * ConfigService em vez de mexer em `process.env`: o @nestjs/config lê o
 * ambiente uma única vez, no primeiro carregamento do módulo, e alterações
 * posteriores em process.env não têm efeito.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  // Os limites de rate limiting são resolvidos a cada requisição, então
  // sobrescrever aqui basta — não é preciso reconstruir o módulo.
  const config = app.get(ConfigService);
  for (const [key, value] of Object.entries(env)) {
    config.set(key, Number(value));
  }

  // Precisa espelhar o main.ts: sem isso os testes de cookie passariam ou
  // falhariam por motivo diferente do código de produção.
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.init();
  return app;
}

export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  // Ordem importa: os tokens referenciam usuários por FK.
  await prisma.refreshToken.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}
