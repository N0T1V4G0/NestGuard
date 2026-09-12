import { ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { Env } from '../../core/config/env.schema';
import { PasswordService } from '../../core/crypto/password.service';
import { PrismaService } from '../../core/database/prisma.service';
import { MailService } from '../../core/mail/mail.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenService } from './refresh-token.service';
import { VerificationService } from './verification.service';

@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * Hash descartável usado quando o e-mail não existe.
   *
   * Sem ele, "e-mail inexistente" responde na hora e "senha errada" gasta os
   * ~70ms do Argon2 — diferença suficiente para um atacante enumerar quais
   * e-mails estão cadastrados só medindo o tempo de resposta. Verificar contra
   * este hash iguala os dois caminhos.
   */
  private dummyHash!: string;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly refreshTokens: RefreshTokenService,
    private readonly verification: VerificationService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Senha aleatória: ninguém conhece o valor que gera este hash.
    this.dummyHash = await this.passwords.hash(randomBytes(32).toString('hex'));
  }

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('E-mail já cadastrado');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
    });

    await this.sendVerificationEmail(user.id, user.email);

    // Devolve apenas o que o cliente precisa: nunca o registro inteiro, que
    // carrega o passwordHash.
    return { id: user.id, email: user.email };
  }

  private async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = await this.verification.issue(userId, 'EMAIL_VERIFICATION');
    const appUrl = this.config.get('APP_URL', { infer: true });

    await this.mail.send(
      email,
      'Confirme seu e-mail',
      `Acesse ${appUrl}/verify-email?token=${token} para confirmar seu e-mail.`,
    );
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.verification.consume(token, 'EMAIL_VERIFICATION');

    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);

    // Silêncio proposital: responder 204 mesmo sem usuário impede que a rota
    // vire um oráculo de quais e-mails estão cadastrados.
    if (!user) {
      return;
    }

    const token = await this.verification.issue(user.id, 'PASSWORD_RESET');
    const appUrl = this.config.get('APP_URL', { infer: true });

    await this.mail.send(
      user.email,
      'Redefinição de senha',
      `Acesse ${appUrl}/reset-password?token=${token} para redefinir sua senha.`,
    );
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.verification.consume(token, 'PASSWORD_RESET');
    const passwordHash = await this.passwords.hash(password);

    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Trocar a senha derruba todas as sessões. Quem redefine a senha
    // normalmente suspeita de invasão, e manter sessões vivas manteria o
    // invasor dentro.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.users.findByEmail(dto.email);

    // Mensagem idêntica nos dois casos: não revela quais e-mails existem.
    const invalid = new UnauthorizedException('Credenciais inválidas');

    if (!user) {
      await this.passwords.verify(this.dummyHash, dto.password);
      throw invalid;
    }

    const matches = await this.passwords.verify(user.passwordHash, dto.password);
    if (!matches) {
      throw invalid;
    }

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: await this.refreshTokens.issue(user.id),
    };
  }

  async refresh(rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { userId, token } = await this.refreshTokens.rotate(rawToken);
    const user = await this.users.findById(userId);

    // O usuário pode ter sido removido depois da emissão do refresh token.
    if (!user) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    return { accessToken: await this.signAccessToken(user), refreshToken: token };
  }

  logout(rawToken: string): Promise<void> {
    return this.refreshTokens.revokeByToken(rawToken);
  }

  private signAccessToken(user: { id: string; email: string }): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      },
    );
  }
}
