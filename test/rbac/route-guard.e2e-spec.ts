import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createTestApp, resetDatabase } from '../helpers/app';
import { giveUserRole, resetRbac } from '../helpers/rbac';

describe('PermissionGuard — rota sem recurso', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;
  const credentials = { email: 'guard@example.com', password: 'SenhaForte123' };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetRbac(app);
    await resetDatabase(app);

    await request(app.getHttpServer()).post('/auth/register').send(credentials);
    const login = await request(app.getHttpServer()).post('/auth/login').send(credentials);
    token = login.body.accessToken;

    const user = await app
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { email: credentials.email } });
    userId = user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('nega com 403 quem não tem a permissão', async () => {
    await request(app.getHttpServer())
      .post('/posts')
      .set(auth())
      .send({ title: 'T', body: 'B' })
      .expect(403);
  });

  it('permite quem tem a permissão', async () => {
    await giveUserRole(app, userId, [{ permission: 'post:create' }]);

    const res = await request(app.getHttpServer())
      .post('/posts')
      .set(auth())
      .send({ title: 'T', body: 'B' })
      .expect(201);

    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.ownerId).toBe(userId);
  });

  it('exige autenticação antes de avaliar permissão', async () => {
    await request(app.getHttpServer()).post('/posts').send({ title: 'T', body: 'B' }).expect(401);
  });

  it('permissão de outro recurso não libera a rota', async () => {
    await giveUserRole(app, userId, [{ permission: 'post:delete' }]);

    await request(app.getHttpServer())
      .post('/posts')
      .set(auth())
      .send({ title: 'T', body: 'B' })
      .expect(403);
  });

  it('permissão herdada do papel pai libera a rota', async () => {
    const parentId = await giveUserRole(app, userId, [{ permission: 'post:create' }], {
      name: 'guard-pai',
    });
    await giveUserRole(app, userId, [], { name: 'guard-filho', inheritsId: parentId });

    await request(app.getHttpServer())
      .post('/posts')
      .set(auth())
      .send({ title: 'T', body: 'B' })
      .expect(201);
  });

  it('rota pública continua acessível sem token nem permissão', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('revogar o papel tira o acesso', async () => {
    await giveUserRole(app, userId, [{ permission: 'post:create' }]);
    await request(app.getHttpServer())
      .post('/posts')
      .set(auth())
      .send({ title: 'T', body: 'B' })
      .expect(201);

    await app.get(PrismaService).userRole.deleteMany({ where: { userId } });

    await request(app.getHttpServer())
      .post('/posts')
      .set(auth())
      .send({ title: 'T', body: 'B' })
      .expect(403);
  });
});
