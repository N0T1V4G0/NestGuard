/**
 * Permissões do módulo posts.
 *
 * Cada módulo declara o próprio bloco e o catálogo central apenas compõe.
 * Apagar o módulo remove as permissões junto, sem deixar resíduo — e o
 * gerador de módulo (plano 3) cria este arquivo automaticamente.
 */
export const POST_PERMISSIONS = {
  post: ['create', 'read', 'update', 'delete', 'publish'],
} as const;
