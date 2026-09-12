import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca uma rota como acessível sem autenticação.
 *
 * O guard de JWT é global: toda rota exige token por padrão, e o acesso
 * anônimo é a exceção declarada. O inverso — proteger rota a rota — deixa
 * endpoint desprotegido quando alguém esquece o decorator.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
