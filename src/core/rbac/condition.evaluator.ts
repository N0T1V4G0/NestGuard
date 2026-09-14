import type { Condition } from './permission.types';
import { USER_ID_PLACEHOLDER } from './permission.types';

/** Lê `author.teamId` em `{ author: { teamId } }`. Um nível de profundidade. */
function readPath(resource: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) {
    return resource[path];
  }

  const [head, tail] = path.split('.', 2);
  const nested = resource[head];

  if (nested === null || typeof nested !== 'object') {
    return undefined;
  }

  return (nested as Record<string, unknown>)[tail];
}

/**
 * Avalia uma condição contra um recurso já carregado.
 *
 * Todas as chaves precisam bater (conjunção). A comparação é estrita: um
 * `'10'` vindo de query string não vira `10`, porque coerção silenciosa em
 * decisão de autorização é fonte de falso positivo.
 */
export function evaluateCondition(
  condition: Condition,
  resource: Record<string, unknown>,
  userId: string,
): boolean {
  return Object.entries(condition).every(([path, expected]) => {
    const wanted = expected === USER_ID_PLACEHOLDER ? userId : expected;
    return readPath(resource, path) === wanted;
  });
}
