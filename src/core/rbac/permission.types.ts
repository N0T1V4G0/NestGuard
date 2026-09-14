import type { Permission } from './permissions';

/**
 * Condição declarativa de uma concessão.
 *
 * Chave é um campo do recurso; valor é o esperado. O literal `$user.id` é
 * substituído pelo id de quem está pedindo — é assim que ownership se
 * expressa: `{ ownerId: '$user.id' }`.
 */
export type Condition = Record<string, unknown>;

/** `null` na lista significa concessão irrestrita para aquela permissão. */
export type ResolvedPermissions = Map<Permission, (Condition | null)[]>;

/**
 * Substituível em condições.
 *
 * Const compartilhada entre o avaliador (que compara contra um recurso
 * carregado) e o tradutor para Prisma (que monta o `where`): os dois precisam
 * reconhecer exatamente o mesmo literal.
 */
export const USER_ID_PLACEHOLDER = '$user.id';
