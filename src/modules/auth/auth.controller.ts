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
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { User } from '@prisma/client';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Public } from '../../core/auth/public.decorator';
import type { Env } from '../../core/config/env.schema';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestResetDto } from './dto/request-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const REFRESH_COOKIE = 'refresh_token';

/** Restringe o envio do cookie às rotas de auth, não a toda requisição. */
const REFRESH_COOKIE_PATH = '/auth';

@ApiTags('auth')
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

  @ApiOperation({ summary: 'Cria uma conta e dispara o e-mail de verificação' })
  @ApiResponse({ status: 201, description: 'Conta criada' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado' })
  @ApiResponse({ status: 429, description: 'Limite de tentativas excedido' })
  @Public()
  @SkipThrottle({ default: true })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<{ id: string; email: string }> {
    return this.auth.register(dto);
  }

  @ApiOperation({ summary: 'Autentica e devolve o access token' })
  @ApiResponse({ status: 200, description: 'Autenticado; refresh token vai no cookie httpOnly' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  @ApiResponse({ status: 429, description: 'Limite de tentativas excedido' })
  @Public()
  @SkipThrottle({ default: true })
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

  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Troca o refresh token do cookie por um novo access token' })
  @ApiResponse({ status: 200, description: 'Renovado; o refresh token é rotacionado' })
  @ApiResponse({ status: 401, description: 'Refresh token ausente, inválido ou já usado' })
  @Public()
  @SkipThrottle({ sensitive: true })
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

  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Encerra a sessão e limpa o cookie' })
  @ApiResponse({ status: 204, description: 'Encerrada; idempotente, mesmo sem cookie' })
  @Public()
  @SkipThrottle({ sensitive: true })
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

  @ApiOperation({ summary: 'Confirma o e-mail a partir do token enviado' })
  @ApiResponse({ status: 204, description: 'E-mail verificado' })
  @ApiResponse({ status: 400, description: 'Token inválido ou expirado' })
  @Public()
  @SkipThrottle({ sensitive: true })
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.auth.verifyEmail(dto.token);
  }

  @ApiOperation({
    summary: 'Solicita a redefinição de senha',
    description:
      'Responde 204 mesmo para e-mail inexistente: informar o contrário permitiria ' +
      'descobrir quais endereços têm conta.',
  })
  @ApiResponse({ status: 204, description: 'Se a conta existir, o e-mail foi enviado' })
  @ApiResponse({ status: 429, description: 'Limite de tentativas excedido' })
  @Public()
  @SkipThrottle({ default: true })
  @Post('request-password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  requestPasswordReset(@Body() dto: RequestResetDto): Promise<void> {
    return this.auth.requestPasswordReset(dto.email);
  }

  @ApiOperation({ summary: 'Redefine a senha a partir do token' })
  @ApiResponse({ status: 204, description: 'Senha redefinida' })
  @ApiResponse({ status: 400, description: 'Token inválido ou expirado' })
  @Public()
  @SkipThrottle({ default: true })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Devolve o usuário autenticado' })
  @ApiResponse({ status: 200, description: 'O usuário do token' })
  @ApiResponse({ status: 401, description: 'Token ausente ou inválido' })
  @SkipThrottle({ sensitive: true })
  @Get('me')
  me(@CurrentUser() user: User): { id: string; email: string; name: string | null } {
    // Campos escolhidos explicitamente: devolver o registro do Prisma
    // exporia passwordHash.
    return { id: user.id, email: user.email, name: user.name };
  }
}
