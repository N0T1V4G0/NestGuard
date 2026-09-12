import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from '../helpers/app';

describe('Rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Limite baixo explícito: as demais suítes rodam com limite alto para não
    // serem barradas, então este teste precisa configurar o seu.
    app = await createTestApp({ THROTTLE_LIMIT_SENSITIVE: '5', THROTTLE_TTL_MS: '60000' });
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

  it('limita também o pedido de reset de senha', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/request-password-reset')
        .send({ email: 'qualquer@example.com' });

    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(204);
    }

    expect((await attempt()).status).toBe(429);
  });
});
