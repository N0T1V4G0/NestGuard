import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createTestApp, resetDatabase } from '../helpers/app';

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

  it('não permite injetar emailVerifiedAt pelo corpo da requisição', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'novo@example.com',
        password: 'SenhaForte123',
        emailVerifiedAt: new Date().toISOString(),
      })
      .expect(201);

    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { email: 'novo@example.com' } });
    expect(user!.emailVerifiedAt).toBeNull();
  });
});
