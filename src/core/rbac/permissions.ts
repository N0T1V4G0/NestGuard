import { POST_PERMISSIONS } from '../../modules/posts/posts.permissions';

/**
 * Catálogo de permissões do sistema, composto pelos blocos que cada módulo
 * declara. Para adicionar um módulo: crie `<modulo>.permissions.ts` e inclua
 * o bloco aqui.
 */
export const PERMISSIONS = {
  ...POST_PERMISSIONS,
} as const;

type Catalog = typeof PERMISSIONS;

/**
 * União literal de todas as permissões: 'post:create' | 'post:read' | ...
 *
 * É este tipo que faz `@RequirePermission('post:updaet')` falhar no build, em
 * vez de silenciosamente negar acesso em runtime.
 */
export type Permission = {
  [R in keyof Catalog]: `${R}:${Catalog[R][number]}`;
}[keyof Catalog];

export const ALL_PERMISSIONS: readonly Permission[] = Object.entries(PERMISSIONS).flatMap(
  ([resource, actions]) => (actions as readonly string[]).map((action) => `${resource}:${action}`),
) as Permission[];

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/** Guarda de tipo para validar strings vindas do banco ou de configuração. */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
