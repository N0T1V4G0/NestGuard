import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { createTestApp, resetDatabase } from '../helpers/app';
import { giveUserRole, resetRbac } from '../helpers/rbac';

describe('scopeFor — listagem autorizada', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;
  let outroId: string;
  const dono = { email: 'lista@example.com', password: 'SenhaForte123' };
  const outro = { email: 'lista-outro@example.com', password: 'SenhaForte123' };

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

    await prisma.post.createMany({
      data: [
        { title: 'meu rascunho', body: 'B', ownerId: userId, status: 'DRAFT' },
        { title: 'meu publicado', body: 'B', ownerId: userId, status: 'PUBLISHED' },
        { title: 'alheio rascunho', body: 'B', ownerId: outroId, status: 'DRAFT' },
        { title: 'alheio publicado', body: 'B', ownerId: outroId, status: 'PUBLISHED' },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const titles = (body: { title: string }[]) => body.map((p) => p.title).sort();

  it('sem permissão devolve lista vazia, não 403', async () => {
    // 403 numa listagem vazaria a existência de registros invisíveis.
    const res = await request(app.getHttpServer()).get('/posts').set(auth()).expect(200);
    expect(res.body).toEqual([]);
  });

  it('permissão irrestrita devolve tudo', async () => {
    await giveUserRole(app, userId, [{ permission: 'post:read' }]);

    const res = await request(app.getHttpServer()).get('/posts').set(auth()).expect(200);
    expect(res.body).toHaveLength(4);
  });

  it('ownership devolve apenas os próprios', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:read', condition: { ownerId: '$user.id' } },
    ]);

    const res = await request(app.getHttpServer()).get('/posts').set(auth()).expect(200);
    expect(titles(res.body)).toEqual(['meu publicado', 'meu rascunho']);
  });

  it('condição de estado devolve apenas os que batem', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:read', condition: { status: 'PUBLISHED' } },
    ]);

    const res = await request(app.getHttpServer()).get('/posts').set(auth()).expect(200);
    expect(titles(res.body)).toEqual(['alheio publicado', 'meu publicado']);
  });

  it('duas condições somam em OR', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:read', condition: { ownerId: '$user.id' } },
    ]);
    await giveUserRole(app, userId, [
      { permission: 'post:read', condition: { status: 'PUBLISHED' } },
    ]);

    const res = await request(app.getHttpServer()).get('/posts').set(auth()).expect(200);
    expect(titles(res.body)).toEqual(['alheio publicado', 'meu publicado', 'meu rascunho']);
  });

  it('o filtro roda no banco, não em memória', async () => {
    await giveUserRole(app, userId, [
      { permission: 'post:read', condition: { ownerId: '$user.id' } },
    ]);

    const prisma = app.get(PrismaService);
    const spy = jest.spyOn(prisma.post, 'findMany');

    await request(app.getHttpServer()).get('/posts').set(auth()).expect(200);

    // A garantia que importa: o `where` chegou ao Prisma. Sem isso, paginação
    // e contagem ficariam erradas mesmo com a resposta parecendo correta.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: userId } }));
    spy.mockRestore();
  });

  it('a permissão herdada também escopa a listagem', async () => {
    const paiId = await giveUserRole(
      app,
      userId,
      [{ permission: 'post:read', condition: { status: 'PUBLISHED' } }],
      { name: 'scope-pai' },
    );
    await giveUserRole(app, userId, [], { name: 'scope-filho', inheritsId: paiId });

    const res = await request(app.getHttpServer()).get('/posts').set(auth()).expect(200);
    expect(titles(res.body)).toEqual(['alheio publicado', 'meu publicado']);
  });
});
