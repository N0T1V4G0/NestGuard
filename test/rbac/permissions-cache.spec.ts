import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/core/config/env.schema';
import { PrismaService } from '../../src/core/database/prisma.service';
import { PermissionsCacheService } from '../../src/core/rbac/permissions-cache.service';
import { PermissionsService } from '../../src/core/rbac/permissions.service';

// O serviço recebe um ConfigService<Env, true> (validado no boot). Aqui o
// objeto é montado à mão, então o cast declara a mesma garantia.
function configWith(overrides: Record<string, unknown>): ConfigService<Env, true> {
  return new ConfigService({
    REDIS_URL: process.env.REDIS_URL,
    RBAC_CACHE_ENABLED: true,
    RBAC_CACHE_TTL_SECONDS: 300,
    ...overrides,
  }) as unknown as ConfigService<Env, true>;
}

describe('PermissionsCacheService', () => {
  let prisma: PrismaService;
  let cache: PermissionsCacheService;
  let service: PermissionsService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await prisma.userRole.deleteMany({ where: { role: { name: { startsWith: 'cache-test' } } } });
    await prisma.roleGrant.deleteMany({ where: { role: { name: { startsWith: 'cache-test' } } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'cache-test' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'cache-test' } } });

    const user = await prisma.user.create({
      data: { email: 'cache-test@example.com', passwordHash: 'x' },
    });
    userId = user.id;

    cache = new PermissionsCacheService(configWith({}));
    cache.onModuleInit();
    await cache.invalidateAll();
    service = new PermissionsService(prisma, cache);
  });

  afterEach(async () => {
    await cache.onModuleDestroy();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function giveRole(name: string, permission: string) {
    const role = await prisma.role.create({
      data: { name, grants: { create: [{ permission }] } },
    });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  }

  it('a segunda chamada não consulta o banco', async () => {
    await giveRole('cache-test-a', 'post:read');

    await service.resolve(userId);
    const spy = jest.spyOn(prisma.roleGrant, 'findMany');
    await service.resolve(userId);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('devolve o mesmo resultado do banco', async () => {
    await giveRole('cache-test-b', 'post:update');

    const primeira = await service.resolve(userId);
    const segunda = await service.resolve(userId);

    expect([...segunda.keys()]).toEqual([...primeira.keys()]);
  });

  it('invalidar o usuário força nova consulta', async () => {
    await giveRole('cache-test-c', 'post:read');
    await service.resolve(userId);

    await cache.invalidateUser(userId);
    const spy = jest.spyOn(prisma.roleGrant, 'findMany');
    await service.resolve(userId);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('permissão revogada some depois da invalidação', async () => {
    await giveRole('cache-test-d', 'post:delete');
    expect((await service.resolve(userId)).has('post:delete')).toBe(true);

    await prisma.userRole.deleteMany({ where: { userId } });
    await cache.invalidateUser(userId);

    expect((await service.resolve(userId)).has('post:delete')).toBe(false);
  });

  it('com o cache desligado sempre consulta o banco', async () => {
    const semCache = new PermissionsCacheService(configWith({ RBAC_CACHE_ENABLED: false }));
    semCache.onModuleInit();
    const semCacheService = new PermissionsService(prisma, semCache);

    await giveRole('cache-test-e', 'post:read');
    await semCacheService.resolve(userId);

    const spy = jest.spyOn(prisma.roleGrant, 'findMany');
    await semCacheService.resolve(userId);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    await semCache.onModuleDestroy();
  });

  it('usuário sem papel também é cacheado', async () => {
    await service.resolve(userId);

    const spy = jest.spyOn(prisma.userRole, 'findMany');
    const resolved = await service.resolve(userId);

    expect(resolved.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
