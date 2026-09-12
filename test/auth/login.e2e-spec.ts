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

  it('rejeita um token assinado com outro segredo com 401', async () => {
    // Token bem-formado, assinatura inválida: o guard precisa verificar a
    // assinatura, não apenas decodificar o payload.
    const { sign } = await import('jsonwebtoken');
    const forged = sign({ sub: 'qualquer', email: credentials.email }, 'segredo-do-atacante', {
      expiresIn: '15m',
    });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('rejeita token de usuário que não existe mais com 401', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send(credentials);
    await resetDatabase(app);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
  });
});
