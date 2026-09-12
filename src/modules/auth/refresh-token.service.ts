import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../core/config/env.schema';
import { TokenService } from '../../core/crypto/token.service';
import { PrismaService } from '../../core/database/prisma.service';

/**
 * Refresh tokens rotativos com detecção de reuso.
 *
 * Cada token vale uma única vez. Ao ser usado, é revogado e um novo é emitido
 * na mesma família. Se um token já revogado reaparece, só há duas explicações:
 * alguém copiou o token, ou o legítimo está repetindo uma requisição antiga.
 * Nos dois casos a resposta segura é a mesma — derrubar a família inteira e
 * forçar novo login.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private expiryDate(): Date {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /** Emite um token novo. Sem `familyId`, começa uma família — um login novo. */
  async issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    const { token, tokenHash } = this.tokens.generate();

    await this.prisma.refreshToken.create({
      data: { tokenHash, familyId, userId, expiresAt: this.expiryDate() },
    });

    return token;
  }

  async rotate(rawToken: string): Promise<{ userId: string; token: string }> {
    const tokenHash = this.tokens.hash(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    // Mensagem única para todos os casos de falha: não informa a quem
    // apresenta o token se ele é inexistente, expirado ou revogado.
    const invalid = new UnauthorizedException('Refresh token inválido');

    if (!stored) {
      throw invalid;
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw invalid;
    }

    if (stored.expiresAt < new Date()) {
      throw invalid;
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const token = await this.issue(stored.userId, stored.familyId);
    return { userId: stored.userId, token };
  }

  /** Revoga todos os tokens vivos de uma família, sem tocar nas outras sessões. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByToken(rawToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hash(rawToken) },
    });

    if (stored) {
      await this.revokeFamily(stored.familyId);
    }
  }
}
