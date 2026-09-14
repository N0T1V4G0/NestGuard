import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { conditionToPrisma } from './condition.to-prisma';
import type { Condition, ResolvedPermissions } from './permission.types';
import { isPermission, type Permission } from './permissions';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Monta o conjunto efetivo de permissões do usuário: os papéis diretos,
   * mais tudo que eles herdam, com as condições anexadas.
   *
   * Papéis somam acesso e nunca subtraem. Por isso uma concessão sem condição
   * absorve as condicionais da mesma permissão — restringir depois de já ter
   * concedido irrestritamente não faria sentido.
   */
  async resolve(userId: string): Promise<ResolvedPermissions> {
    const directRoles = await this.prisma.userRole.findMany({
      where: { userId },
      select: { roleId: true },
    });

    const roleIds = await this.expandHierarchy(directRoles.map((r) => r.roleId));

    if (roleIds.length === 0) {
      return new Map();
    }

    const grants = await this.prisma.roleGrant.findMany({
      where: { roleId: { in: roleIds } },
      select: { permission: true, condition: true },
    });

    const resolved: ResolvedPermissions = new Map();

    for (const grant of grants) {
      // Concessão cuja permissão saiu do catálogo é ignorada. O boot já recusa
      // subir nesse estado; isto protege o caso de a linha aparecer com a
      // aplicação no ar.
      if (!isPermission(grant.permission)) {
        continue;
      }

      const condition = (grant.condition as Condition | null) ?? null;
      const current = resolved.get(grant.permission) ?? [];

      // Já é irrestrita: nada a acrescentar, independente da ordem em que as
      // concessões vieram do banco.
      if (current.includes(null)) {
        continue;
      }

      if (condition === null) {
        resolved.set(grant.permission, [null]);
        continue;
      }

      current.push(condition);
      resolved.set(grant.permission, current);
    }

    return resolved;
  }

  async has(userId: string, permission: Permission): Promise<boolean> {
    return (await this.resolve(userId)).has(permission);
  }

  /**
   * Devolve o fragmento `where` que restringe uma listagem ao que o usuário
   * pode ver.
   *
   * - sem a permissão            → `null` (o chamador não deve retornar nada)
   * - permissão irrestrita       → `{}`
   * - uma condição               → o filtro daquela condição
   * - várias condições           → `{ OR: [...] }`, porque papéis somam acesso
   *
   * O `null` é deliberadamente diferente de `{}`: confundir os dois faria uma
   * listagem sem permissão devolver a tabela inteira.
   */
  async scopeFor(
    userId: string,
    permission: Permission,
  ): Promise<Record<string, unknown> | null> {
    const conditions = (await this.resolve(userId)).get(permission);

    if (!conditions) {
      return null;
    }

    if (conditions.includes(null)) {
      return {};
    }

    const filters = conditions
      .filter((c): c is Condition => c !== null)
      .map((c) => conditionToPrisma(c, userId));

    if (filters.length === 1) {
      return filters[0];
    }

    return { OR: filters };
  }

  /**
   * Expande a hierarquia seguindo `inheritsId` para cima.
   *
   * O Set de visitados não é otimização: sem ele, uma hierarquia com ciclo
   * (que o schema não impede) trava o processo em laço infinito.
   */
  private async expandHierarchy(roleIds: string[]): Promise<string[]> {
    const visited = new Set<string>();
    let frontier = roleIds;

    while (frontier.length > 0) {
      const novel = frontier.filter((id) => !visited.has(id));

      if (novel.length === 0) {
        break;
      }

      novel.forEach((id) => visited.add(id));

      const parents = await this.prisma.role.findMany({
        where: { id: { in: novel }, inheritsId: { not: null } },
        select: { inheritsId: true },
      });

      frontier = parents.map((p) => p.inheritsId!).filter((id) => !visited.has(id));
    }

    return [...visited];
  }
}
