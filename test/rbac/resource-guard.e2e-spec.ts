import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createTestApp, resetDatabase } from '../helpers/app';
import { giveUserRole, resetRbac } from '../helpers/rbac';

describe('PermissionGuard — recurso único', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;
  let outroId: string;
  const dono = { email: 'dono@example.com', password: 'SenhaForte123' };
  const outro = { email: 'outro@example.com', password: 'SenhaForte123' };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetRbac(app);
    await resetDatabase(app);

    for (const c of [dono, outro]) {
      await request(app.getHttpServer()).post('/auth/register').send(c);
    }

    token = (await request(app.getHttpServer()).post('/auth/login').send(dono)).body.accessToken;

    const prisma = app.get(PrismaService);
    userId = (await prisma.user.findUniqueOrThrow({ where: { email: dono.email } })).id;
    outroId = (await prisma.user.findUniqueOrThrow({ where: { email: outro.email } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function criarPost(ownerId: string, status: 'DRAFT' | 'PUBLISHED' = 'DRAFT') {
    return app.get(PrismaService).post.create({
      data: { title: 'T', body: 'B', ownerId, status },
    });
  }

  it('permite editar o próprio post quando a condição é ownership', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:update', condition: { ownerId: '$user.id' } },
    ]);
    const post = await criarPost(userId);

    await request(app.getHttpServer())
      .patch(`/posts/${post.id}`)
      .set(auth())
      .send({ title: 'Novo' })
      .expect(200);
  });

  it('nega editar post de outro usuário', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:update', condition: { ownerId: '$user.id' } },
    ]);
    const alheio = await criarPost(outroId);

    await request(app.getHttpServer())
      .patch(`/posts/${alheio.id}`)
      .set(auth())
      .send({ title: 'Novo' })
      .expect(403);
  });

  it('permissão irrestrita edita post de qualquer um', async () => {
    await giveUserRole(app, userId, [{ permission: 'post:update' }]);
    const alheio = await criarPost(outroId);

    await request(app.getHttpServer())
      .patch(`/posts/${alheio.id}`)
      .set(auth())
      .send({ title: 'Novo' })
      .expect(200);
  });

  it('respeita condição de estado', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:update', condition: { status: 'DRAFT' } },
    ]);

    const rascunho = await criarPost(userId, 'DRAFT');
    await request(app.getHttpServer())
      .patch(`/posts/${rascunho.id}`)
      .set(auth())
      .send({ title: 'A' })
      .expect(200);

    const publicado = await criarPost(userId, 'PUBLISHED');
    await request(app.getHttpServer())
      .patch(`/posts/${publicado.id}`)
      .set(auth())
      .send({ title: 'B' })
      .expect(403);
  });

  it('basta uma condição satisfeita quando há duas concessões', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:update', condition: { ownerId: '$user.id' } },
    ]);
    await giveUserRole(app, userId, [
      { permission: 'post:update', condition: { status: 'PUBLISHED' } },
    ]);

    // Não é dono, mas está publicado: a segunda condição aprova.
    const alheioPublicado = await criarPost(outroId, 'PUBLISHED');
    await request(app.getHttpServer())
      .patch(`/posts/${alheioPublicado.id}`)
      .set(auth())
      .send({ title: 'X' })
      .expect(200);
  });

  it('exige que todas as chaves da mesma condição batam', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:update', condition: { ownerId: '$user.id', status: 'DRAFT' } },
    ]);

    // É dono, mas está publicado: a condição é conjunção, então nega.
    const meuPublicado = await criarPost(userId, 'PUBLISHED');
    await request(app.getHttpServer())
      .patch(`/posts/${meuPublicado.id}`)
      .set(auth())
      .send({ title: 'X' })
      .expect(403);
  });

  it('devolve 404 para recurso inexistente, não 403', async () => {
    await giveUserRole(app, userId, [{ permission: 'post:update' }]);

    await request(app.getHttpServer())
      .patch('/posts/nao-existe')
      .set(auth())
      .send({ title: 'X' })
      .expect(404);
  });

  it('nega com 403 quando falta a permissão, mesmo com o recurso existindo', async () => {
    const post = await criarPost(userId);

    await request(app.getHttpServer())
      .patch(`/posts/${post.id}`)
      .set(auth())
      .send({ title: 'X' })
      .expect(403);
  });

  it('injeta o recurso carregado no handler', async () => {
    await giveUserRole(app, userId, [{ permission: 'post:read' }]);
    const post = await criarPost(userId);

    const res = await request(app.getHttpServer())
      .get(`/posts/${post.id}`)
      .set(auth())
      .expect(200);

    expect(res.body.id).toBe(post.id);
  });

  it('apagar exige a própria permissão, não a de editar', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:update', condition: { ownerId: '$user.id' } },
    ]);
    const post = await criarPost(userId);

    await request(app.getHttpServer()).delete(`/posts/${post.id}`).set(auth()).expect(403);
  });

  it('permite apagar o próprio post com a permissão correta', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:delete', condition: { ownerId: '$user.id' } },
    ]);
    const post = await criarPost(userId);

    await request(app.getHttpServer()).delete(`/posts/${post.id}`).set(auth()).expect(200);
    expect(await app.get(PrismaService).post.count({ where: { id: post.id } })).toBe(0);
  });
});
