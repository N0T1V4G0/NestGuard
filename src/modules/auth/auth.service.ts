import { ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { Env } from '../../core/config/env.schema';
import { PasswordService } from '../../core/crypto/password.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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

    // Devolve apenas o que o cliente precisa: nunca o registro inteiro, que
    // carrega o passwordHash.
    return { id: user.id, email: user.email };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
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

    return { accessToken: await this.signAccessToken(user) };
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
