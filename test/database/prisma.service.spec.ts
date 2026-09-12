import 'dotenv/config';
import { PrismaService } from '../../src/core/database/prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeAll(async () => {
    service = new PrismaService();
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('conecta ao banco e executa uma query', async () => {
    const result = await service.$queryRaw`SELECT 1 as one`;
    expect(result).toEqual([{ one: 1 }]);
  });

  it('expõe o model user', async () => {
    const count = await service.user.count();
    expect(typeof count).toBe('number');
  });

  it('expõe os models de token criados na migration', async () => {
    await expect(service.refreshToken.count()).resolves.toEqual(expect.any(Number));
    await expect(service.verificationToken.count()).resolves.toEqual(expect.any(Number));
  });
});
