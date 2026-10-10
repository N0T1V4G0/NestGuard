import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PermissionsCacheService } from './permissions-cache.service';

/**
 * Atribuição e revogação de papéis.
 *
 * É o caminho oficial para mexer no vínculo usuário↔papel: escrever direto
 * pelo Prisma deixa o cache servindo a permissão antiga até o TTL expirar, o
 * que na prática é permissão revogada que continua valendo por minutos.
 * Aqui a invalidação acontece junto com a escrita.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PermissionsCacheService,
  ) {}

  /** Idempotente: atribuir duas vezes deixa um vínculo só. */
  async assign(userId: string, roleId: string): Promise<void> {
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: {},
    });

    await this.cache.invalidateUser(userId);
  }

  /** Silencioso se o vínculo não existir — revogar o que já não vale é no-op. */
  async revoke(userId: string, roleId: string): Promise<void> {
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });

    await this.cache.invalidateUser(userId);
  }

  /**
   * Invalida todo mundo. Usar ao mudar as concessões de um papel ou a
   * hierarquia: descobrir exatamente quem foi afetado exigiria percorrer a
   * árvore inteira, e errar nessa conta deixa permissão revogada valendo.
   */
  async invalidateEveryone(): Promise<void> {
    await this.cache.invalidateAll();
  }
}
