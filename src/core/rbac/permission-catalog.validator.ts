import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { isPermission } from './permissions';

/**
 * Confere, no boot, que toda concessão no banco aponta para uma permissão que
 * existe no catálogo.
 *
 * Pega dois erros que de outra forma seriam silenciosos: typo numa concessão
 * criada à mão, e permissão renomeada em código sem migrar as linhas do banco.
 * Nos dois casos o efeito em runtime seria acesso negado sem explicação — o
 * tipo de bug que custa horas porque o código parece correto.
 */
@Injectable()
export class PermissionCatalogValidator implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogValidator.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.validate();
  }

  async validate(): Promise<void> {
    const grants = await this.prisma.roleGrant.findMany({
      select: { permission: true, role: { select: { name: true } } },
    });

    const orphans = grants.filter((grant) => !isPermission(grant.permission));

    if (orphans.length > 0) {
      const detail = orphans
        .map((orphan) => `  - "${orphan.permission}" no papel "${orphan.role.name}"`)
        .join('\n');

      // Falhar o boot é deliberado: subir com autorização inconsistente é
      // pior que não subir. O erro lista todas as órfãs de uma vez para que
      // a correção não vire tentativa e erro.
      throw new Error(
        `Permissões que não existem no catálogo:\n${detail}\n\n` +
          'Corrija a concessão no banco ou declare a permissão no bloco do módulo ' +
          '(<modulo>.permissions.ts) e componha em src/core/rbac/permissions.ts.',
      );
    }

    this.logger.log(`Catálogo de permissões validado: ${grants.length} concessões conferidas`);
  }
}
