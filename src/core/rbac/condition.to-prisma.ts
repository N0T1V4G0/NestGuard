import type { Condition } from './permission.types';
import { USER_ID_PLACEHOLDER } from './permission.types';

/**
 * Traduz uma condição declarativa em fragmento `where` do Prisma.
 *
 * É o que permite a autorização rodar dentro da query, em vez de filtrar a
 * lista depois de buscá-la — filtrar depois quebraria paginação e vazaria a
 * contagem de registros que o usuário não pode ver.
 *
 * Suporta campo plano e um nível de relação. Profundidade maior lança erro
 * explícito: um filtro silenciosamente errado numa decisão de autorização é
 * pior que uma falha ruidosa.
 */
export function conditionToPrisma(
  condition: Condition,
  userId: string,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const [path, expected] of Object.entries(condition)) {
    const value = expected === USER_ID_PLACEHOLDER ? userId : expected;
    const segments = path.split('.');

    if (segments.length === 1) {
      where[path] = value;
      continue;
    }

    if (segments.length > 2) {
      throw new Error(
        `Condição "${path}" tem mais de um nível de relação. ` +
          'O scopeFor da v1 suporta campo plano e um nível (ex.: "author.teamId"). ' +
          'Reescreva a condição ou desnormalize o campo no recurso.',
      );
    }

    const [relation, field] = segments;
    const nested = (where[relation] as Record<string, unknown> | undefined) ?? {};
    nested[field] = value;
    where[relation] = nested;
  }

  return where;
}
