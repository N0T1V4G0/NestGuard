import 'dotenv/config';
import { PrismaService } from '../../src/core/database/prisma.service';

describe('Schema do RBAC', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterEach(async () => {
    // Filtrar por prefixo é obrigatório: um deleteMany() sem where apagaria
    // os vínculos criados pelo seed, deixando o admin sem papel.
    await prisma.userRole.deleteMany({ where: { role: { name: { startsWith: 'schema-test' } } } });
    await prisma.roleGrant.deleteMany({ where: { role: { name: { startsWith: 'schema-test' } } } });
    await prisma.post.deleteMany({ where: { owner: { email: { contains: 'schema-test' } } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'schema-test' } } });
    await prisma.user.deleteMany({ where: { email: { contains: 'schema-test' } } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('cria um papel com concessões', async () => {
    const role = await prisma.role.create({
      data: {
        name: 'schema-test-editor',
        grants: {
          create: [
            { permission: 'post:read' },
            { permission: 'post:update', condition: { ownerId: '$user.id' } },
          ],
        },
      },
      include: { grants: true },
    });

    expect(role.grants).toHaveLength(2);
    expect(role.grants.find((g) => g.permission === 'post:update')!.condition).toEqual({
      ownerId: '$user.id',
    });
  });

  it('impede a mesma permissão duas vezes no mesmo papel', async () => {
    const role = await prisma.role.create({ data: { name: 'schema-test-dup' } });
    await prisma.roleGrant.create({ data: { roleId: role.id, permission: 'post:read' } });

    await expect(
      prisma.roleGrant.create({ data: { roleId: role.id, permission: 'post:read' } }),
    ).rejects.toThrow();
  });

  it('apaga as concessões junto com o papel', async () => {
    const role = await prisma.role.create({
      data: { name: 'schema-test-cascade', grants: { create: [{ permission: 'post:read' }] } },
    });

    await prisma.role.delete({ where: { id: role.id } });

    expect(await prisma.roleGrant.count({ where: { roleId: role.id } })).toBe(0);
  });

  it('permite hierarquia de papéis', async () => {
    const parent = await prisma.role.create({ data: { name: 'schema-test-viewer' } });
    const child = await prisma.role.create({
      data: { name: 'schema-test-child', inheritsId: parent.id },
      include: { inherits: true },
    });

    expect(child.inherits!.name).toBe('schema-test-viewer');
  });

  it('vincula usuário e papel sem duplicar', async () => {
    const user = await prisma.user.create({
      data: { email: 'schema-test@example.com', passwordHash: 'x' },
    });
    const role = await prisma.role.create({ data: { name: 'schema-test-link' } });

    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    await expect(
      prisma.userRole.create({ data: { userId: user.id, roleId: role.id } }),
    ).rejects.toThrow();
  });

  it('post nasce como rascunho e sem tenant', async () => {
    const user = await prisma.user.create({
      data: { email: 'schema-test-owner@example.com', passwordHash: 'x' },
    });
    const post = await prisma.post.create({
      data: { title: 'T', body: 'B', ownerId: user.id },
    });

    expect(post.status).toBe('DRAFT');
    expect(post.tenantId).toBeNull();
  });

  it('apagar o usuário apaga seus posts e vínculos de papel', async () => {
    const user = await prisma.user.create({
      data: { email: 'schema-test-cascade@example.com', passwordHash: 'x' },
    });
    const role = await prisma.role.create({ data: { name: 'schema-test-orfao' } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await prisma.post.create({ data: { title: 'T', body: 'B', ownerId: user.id } });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.post.count({ where: { ownerId: user.id } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(0);
    // O papel sobrevive: ele não pertence ao usuário.
    expect(await prisma.role.count({ where: { id: role.id } })).toBe(1);
  });
});
