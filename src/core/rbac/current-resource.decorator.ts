import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CURRENT_RESOURCE = 'currentResource';

/**
 * Injeta o recurso que o guard já carregou para avaliar a condição.
 * Evita que o service busque o mesmo registro uma segunda vez.
 */
export const CurrentResource = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Record<string, unknown>>()[CURRENT_RESOURCE];
});
