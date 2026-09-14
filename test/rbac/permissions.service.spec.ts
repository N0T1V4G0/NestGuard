import 'dotenv/config';
import { PrismaService } from '../../src/core/database/prisma.service';
import { PermissionsService } from '../../src/core/rbac/permissions.service';

describe('PermissionsService.resolve', () => {
  let prisma: PrismaService;
  let service: PermissionsService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new PermissionsService(prisma);
  });

  beforeEach(async () => {
    await prisma.userRole.deleteMany({ where: { role: { name: { startsWith: 'res-test' } } } });
    await prisma.roleGrant.deleteMany({ where: { role: { name: { startsWith: 'res-test' } } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'res-test' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'res-test' } } });

    const user = await prisma.user.create({
      data: { email: 'res-test@example.com', passwordHash: 'x' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function giveRole(
    name: string,
    grants: { permission: string; condition?: object }[],
    inheritsId?: string,
  ) {
    const role = await prisma.role.create({
      data: {
        name,
        inheritsId,
        grants: {
          create: grants.map((g) => ({ permission: g.permission, condition: g.condition })),
        },
      },
    });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
    return role;
  }

  it('usuário sem papel não tem permissão alguma', async () => {
    const resolved = await service.resolve(userId);
    expect(resolved.size).toBe(0);
  });

  it('resolve permissão sem condição como irrestrita', async () => {
    await giveRole('res-test-a', [{ permission: 'post:read' }]);

    const resolved = await service.resolve(userId);
    expect(resolved.get('post:read')).toEqual([null]);
  });

  it('resolve permissão com condição', async () => {
    await giveRole('res-test-b', [
      { permission: 'post:update', condition: { ownerId: '$user.id' } },
    ]);

    const resolved = await service.resolve(userId);
    expect(resolved.get('post:update')).toEqual([{ ownerId: '$user.id' }]);
  });

  it('soma condições de papéis diferentes para a mesma permissão', async () => {
    await giveRole('res-test-c', [
      { permission: 'post:read', condition: { ownerId: '$user.id' } },
    ]);
    await giveRole('res-test-d', [
      { permission: 'post:read', condition: { status: 'PUBLISHED' } },
    ]);

    const conditions = (await service.resolve(userId)).get('post:read')!;
    expect(conditions).toHaveLength(2);
    expect(conditions).toContainEqual({ ownerId: '$user.id' });
    expect(conditions).toContainEqual({ status: 'PUBLISHED' });
  });

  it('concessão irrestrita absorve as condicionais da mesma permissão', async () => {
    await giveRole('res-test-e', [
      { permission: 'post:read', condition: { ownerId: '$user.id' } },
    ]);
    await giveRole('res-test-f', [{ permission: 'post:read' }]);

    // Acesso irrestrito torna a condição irrelevante: papéis somam acesso.
    expect((await service.resolve(userId)).get('post:read')).toEqual([null]);
  });

  it('a ordem não muda o resultado: irrestrita primeiro também absorve', async () => {
    await giveRole('res-test-e2', [{ permission: 'post:read' }]);
    await giveRole('res-test-f2', [
      { permission: 'post:read', condition: { ownerId: '$user.id' } },
    ]);

    expect((await service.resolve(userId)).get('post:read')).toEqual([null]);
  });

  it('herda as permissões do papel pai', async () => {
    const parent = await prisma.role.create({
      data: { name: 'res-test-pai', grants: { create: [{ permission: 'post:read' }] } },
    });
    await giveRole('res-test-filho', [{ permission: 'post:update' }], parent.id);

    const resolved = await service.resolve(userId);
    expect(resolved.has('post:read')).toBe(true);
    expect(resolved.has('post:update')).toBe(true);
  });

  it('herda por mais de um nível', async () => {
    const avo = await prisma.role.create({
      data: { name: 'res-test-avo', grants: { create: [{ permission: 'post:read' }] } },
    });
    const pai = await prisma.role.create({
      data: {
        name: 'res-test-pai2',
        inheritsId: avo.id,
        grants: { create: [{ permission: 'post:update' }] },
      },
    });
    await giveRole('res-test-neto', [{ permission: 'post:delete' }], pai.id);

    const resolved = await service.resolve(userId);
    expect(resolved.has('post:read')).toBe(true);
    expect(resolved.has('post:update')).toBe(true);
    expect(resolved.has('post:delete')).toBe(true);
  });

  it('não entra em laço infinito se a hierarquia tiver ciclo', async () => {
    const a = await prisma.role.create({ data: { name: 'res-test-ciclo-a' } });
    const b = await prisma.role.create({ data: { name: 'res-test-ciclo-b', inheritsId: a.id } });
    await prisma.role.update({ where: { id: a.id }, data: { inheritsId: b.id } });
    await prisma.userRole.create({ data: { userId, roleId: a.id } });

    await expect(service.resolve(userId)).resolves.toBeDefined();
  });

  it('has() responde true para permissão concedida', async () => {
    await giveRole('res-test-g', [{ permission: 'post:publish' }]);
    await expect(service.has(userId, 'post:publish')).resolves.toBe(true);
  });

  it('has() responde false para permissão não concedida', async () => {
    await expect(service.has(userId, 'post:publish')).resolves.toBe(false);
  });

  it('ignora concessões cuja permissão saiu do catálogo', async () => {
    const role = await prisma.role.create({ data: { name: 'res-test-orfa' } });
    await prisma.roleGrant.create({ data: { roleId: role.id, permission: 'post:sumiu' } });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });

    const resolved = await service.resolve(userId);
    expect([...resolved.keys()]).not.toContain('post:sumiu');
  });

  it('não vaza permissões de outro usuário', async () => {
    const outro = await prisma.user.create({
      data: { email: 'res-test-outro@example.com', passwordHash: 'x' },
    });
    const role = await prisma.role.create({
      data: { name: 'res-test-alheio', grants: { create: [{ permission: 'post:delete' }] } },
    });
    await prisma.userRole.create({ data: { userId: outro.id, roleId: role.id } });

    expect((await service.resolve(userId)).size).toBe(0);
    expect((await service.resolve(outro.id)).has('post:delete')).toBe(true);
  });
});
