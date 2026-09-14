import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Permission } from './permissions';

export const PERMISSION_KEY = 'requiredPermission';

export interface PermissionMetadata {
  permission: Permission;
  /** Nome do recurso no registry, quando a checagem depende de carregá-lo. */
  resource?: string;
  /** Parâmetro de rota que contém o id do recurso. Default: 'id'. */
  param?: string;
}

/**
 * Exige uma permissão para acessar a rota.
 *
 * Sem `resource`, a checagem é apenas "o usuário tem esta permissão?".
 * Com `resource`, o guard carrega o recurso e avalia as condições da
 * concessão contra ele — é assim que ownership funciona.
 *
 * O tipo `Permission` faz um typo falhar no build, em vez de virar acesso
 * negado inexplicável em produção.
 */
export const RequirePermission = (
  permission: Permission,
  options: Omit<PermissionMetadata, 'permission'> = {},
): CustomDecorator =>
  SetMetadata<string, PermissionMetadata>(PERMISSION_KEY, { permission, ...options });
