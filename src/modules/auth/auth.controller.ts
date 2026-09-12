import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Public } from '../../core/auth/public.decorator';
import type { Env } from '../../core/config/env.schema';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_COOKIE = 'refresh_token';

/** Restringe o envio do cookie às rotas de auth, não a toda requisição. */
const REFRESH_COOKIE_PATH = '/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });

    res.cookie(REFRESH_COOKIE, token, {
      // httpOnly mantém o token fora do alcance de JavaScript: um XSS não
      // consegue lê-lo.
      httpOnly: true,
      // Em produção o cookie só trafega por HTTPS. Em dev seria impeditivo.
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: days * 24 * 60 * 60 * 1000,
    });
  }

  private refreshTokenFrom(req: Request): string {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

    if (!raw) {
      throw new UnauthorizedException('Refresh token ausente');
    }

    return raw;
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<{ id: string; email: string }> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.auth.login(dto);
    this.setRefreshCookie(res, refreshToken);

    // O refresh token sai apenas no cookie httpOnly, nunca no corpo.
    return { accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.auth.refresh(this.refreshTokenFrom(req));
    this.setRefreshCookie(res, refreshToken);

    return { accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

    // Logout é idempotente: sem cookie, apenas limpa e responde 204.
    if (raw) {
      await this.auth.logout(raw);
    }

    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @Get('me')
  me(@CurrentUser() user: User): { id: string; email: string; name: string | null } {
    // Campos escolhidos explicitamente: devolver o registro do Prisma
    // exporia passwordHash.
    return { id: user.id, email: user.email, name: user.name };
  }
}
