import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { MailService } from '../../src/core/mail/mail.service';
import { createTestApp, resetDatabase } from '../helpers/app';

describe('Verificação de e-mail e reset de senha', () => {
  let app: INestApplication;
  let sent: Array<{ to: string; subject: string; body: string }>;
  const credentials = { email: 'user@example.com', password: 'SenhaForte123' };

  beforeAll(async () => {
    app = await createTestApp();
    const mail = app.get(MailService);
    jest.spyOn(mail, 'send').mockImplementation((to, subject, body) => {
      sent.push({ to, subject, body });
      return Promise.resolve();
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

  it('não aceita um token de reset como token de verificação', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: credentials.email });

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: tokenFromLastMail() })
      .expect(400);
  });

  it('o e-mail de reset não vaza a senha nem o hash do token', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: credentials.email });

    const mail = sent[sent.length - 1];
    expect(mail.body).not.toContain(credentials.password);
    expect(mail.body).not.toContain('argon2');
  });
});
