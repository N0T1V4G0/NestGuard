import 'dotenv/config';
import { PrismaService } from '../../src/core/database/prisma.service';
import { PermissionCatalogValidator } from '../../src/core/rbac/permission-catalog.validator';

describe('PermissionCatalogValidator', () => {
  let prisma: PrismaService;
  let validator: PermissionCatalogValidator;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    validator = new PermissionCatalogValidator(prisma);
  });

  afterEach(async () => {
    await prisma.roleGrant.deleteMany({ where: { role: { name: { startsWith: 'val-test' } } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'val-test' } } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('passa quando todas as permissões existem no catálogo', async () => {
    await prisma.role.create({
      data: {
        name: 'val-test-ok',
        grants: { create: [{ permission: 'post:read' }, { permission: 'post:update' }] },
      },
    });

    await expect(validator.validate()).resolves.toBeUndefined();
  });

  it('passa quando não há concessão alguma', async () => {
    await expect(validator.validate()).resolves.toBeUndefined();
  });

  it('lança quando há permissão fora do catálogo', async () => {
    await prisma.role.create({
      data: { name: 'val-test-orfa', grants: { create: [{ permission: 'post:inexistente' }] } },
    });

    await expect(validator.validate()).rejects.toThrow(/post:inexistente/);
  });

  it('a mensagem de erro nomeia o papel, para que dê para corrigir', async () => {
    await prisma.role.create({
      data: { name: 'val-test-nomeado', grants: { create: [{ permission: 'foo:bar' }] } },
    });

    await expect(validator.validate()).rejects.toThrow(/val-test-nomeado/);
  });

  it('lista todas as permissões órfãs de uma vez, não só a primeira', async () => {
    await prisma.role.create({
      data: {
        name: 'val-test-varias',
        grants: { create: [{ permission: 'a:b' }, { permission: 'c:d' }] },
      },
    });

    await expect(validator.validate()).rejects.toThrow(/a:b[\s\S]*c:d|c:d[\s\S]*a:b/);
  });

  it('pega o caso de permissão renomeada em código sem migrar o banco', async () => {
    // Cenário real: alguém renomeou 'post:publish' para 'post:release' no
    // catálogo e esqueceu de atualizar as concessões existentes.
    await prisma.role.create({
      data: { name: 'val-test-renomeada', grants: { create: [{ permission: 'post:release' }] } },
    });

    await expect(validator.validate()).rejects.toThrow(/post:release/);
  });
});
