import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createTestApp, resetDatabase } from '../helpers/app';

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

    // Reuso do token antigo: alguém tem uma cópia. Dispara a detecção.
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(401);

    // O token que ainda era válido morre junto com a família.
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', current).expect(401);
  });

  it('não afeta outras sessões do mesmo usuário ao invalidar uma família', async () => {
    const sessionA = await login();
    const sessionB = await login();

    const tokenA = cookieFrom(sessionA);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', tokenA).expect(200);
    // Reuso na sessão A mata apenas a família de A.
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', tokenA).expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookieFrom(sessionB))
      .expect(200);
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

  it('mantém a mesma família ao rotacionar', async () => {
    const res = await login();
    const prisma = app.get(PrismaService);
    const before = await prisma.refreshToken.findFirst();

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookieFrom(res))
      .expect(200);

    const all = await prisma.refreshToken.findMany();
    expect(all).toHaveLength(2);
    expect(all.every((t) => t.familyId === before!.familyId)).toBe(true);
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
