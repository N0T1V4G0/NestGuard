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

  it('liveness não depende do banco', async () => {
    // Diferença que importa em produção: se o banco cai, o orquestrador deve
    // tirar a instância da rotação (readiness), não reiniciá-la (liveness).
    const prisma = app.get<{ $queryRaw: unknown }>(
      (await import('../../src/core/database/prisma.service')).PrismaService,
    );
    const original = prisma.$queryRaw;
    prisma.$queryRaw = jest.fn().mockRejectedValue(new Error('banco fora'));

    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(503);

    prisma.$queryRaw = original;
  });
});
