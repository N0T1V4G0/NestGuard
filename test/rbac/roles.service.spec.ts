import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/core/config/env.schema';
import { PrismaService } from '../../src/core/database/prisma.service';
import { PermissionsCacheService } from '../../src/core/rbac/permissions-cache.service';
import { PermissionsService } from '../../src/core/rbac/permissions.service';
import { RolesService } from '../../src/core/rbac/roles.service';

describe('RolesService', () => {
  let prisma: PrismaService;
  let cache: PermissionsCacheService;
  let permissions: PermissionsService;
  let roles: RolesService;
  let userId: string;
  let roleId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await prisma.userRole.deleteMany({ where: { role: { name: { startsWith: 'roles-test' } } } });
    await prisma.roleGrant.deleteMany({ where: { role: { name: { startsWith: 'roles-test' } } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'roles-test' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'roles-test' } } });

    userId = (
      await prisma.user.create({ data: { email: 'roles-test@example.com', passwordHash: 'x' } })
    ).id;
    roleId = (
      await prisma.role.create({
        data: { name: 'roles-test-a', grants: { create: [{ permission: 'post:create' }] } },
      })
    ).id;

    cache = new PermissionsCacheService(
      new ConfigService({
        REDIS_URL: process.env.REDIS_URL,
        RBAC_CACHE_ENABLED: true,
        RBAC_CACHE_TTL_SECONDS: 300,
      }) as unknown as ConfigService<Env, true>,
    );
    cache.onModuleInit();
    await cache.invalidateAll();

    permissions = new PermissionsService(prisma, cache);
    roles = new RolesService(prisma, cache);
  });

  afterEach(async () => {
    await cache.onModuleDestroy();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('atribuir o papel concede a permissão', async () => {
    await roles.assign(userId, roleId);

    expect(await permissions.has(userId, 'post:create')).toBe(true);
  });

  // O ponto da task: sem invalidar, o cache continuaria servindo a permissão
  // revogada até o TTL expirar.
  it('revogar o papel tira a permissão imediatamente, mesmo com o cache quente', async () => {
    await roles.assign(userId, roleId);
    expect(await permissions.has(userId, 'post:create')).toBe(true);

    await roles.revoke(userId, roleId);

    expect(await permissions.has(userId, 'post:create')).toBe(false);
  });

  it('atribuir invalida o cache de quem não tinha nada', async () => {
    // Esquenta o cache com o conjunto vazio antes de conceder.
    expect(await permissions.has(userId, 'post:create')).toBe(false);

    await roles.assign(userId, roleId);

    expect(await permissions.has(userId, 'post:create')).toBe(true);
  });

  it('atribuir duas vezes não quebra nem duplica o vínculo', async () => {
    await roles.assign(userId, roleId);
    await roles.assign(userId, roleId);

    const vinculos = await prisma.userRole.count({ where: { userId, roleId } });
    expect(vinculos).toBe(1);
  });

  it('revogar um papel que o usuário não tem é silencioso', async () => {
    await expect(roles.revoke(userId, roleId)).resolves.not.toThrow();
  });
});
