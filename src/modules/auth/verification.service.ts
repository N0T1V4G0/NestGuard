import { BadRequestException, Injectable } from '@nestjs/common';
import { VerificationTokenType } from '@prisma/client';
import { TokenService } from '../../core/crypto/token.service';
import { PrismaService } from '../../core/database/prisma.service';

/**
 * Janelas de validade por tipo.
 *
 * Reset de senha é curto porque o token dá acesso à conta: se o e-mail for
 * comprometido depois, a janela de ataque é de uma hora, não de um dia.
 * Verificação de e-mail é longa porque não concede acesso — apenas confirma
 * um endereço — e expirar cedo demais gera atrito e suporte.
 */
const TTL_BY_TYPE: Record<VerificationTokenType, number> = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async issue(userId: string, type: VerificationTokenType): Promise<string> {
    const { token, tokenHash } = this.tokens.generate();

    await this.prisma.verificationToken.create({
      data: { tokenHash, type, userId, expiresAt: new Date(Date.now() + TTL_BY_TYPE[type]) },
    });

    return token;
  }

  /** Consome o token e devolve o dono. Um token serve uma única vez. */
  async consume(rawToken: string, type: VerificationTokenType): Promise<string> {
    const stored = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(rawToken) },
    });

    // Mensagem única: não distingue inexistente, do tipo errado, já usado ou
    // expirado. O tipo faz parte da validação — um token de verificação de
    // e-mail não pode redefinir senha.
    const invalid = new BadRequestException('Token inválido ou expirado');

    if (!stored || stored.type !== type || stored.usedAt || stored.expiresAt < new Date()) {
      throw invalid;
    }

    await this.prisma.verificationToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    });

    return stored.userId;
  }
}
