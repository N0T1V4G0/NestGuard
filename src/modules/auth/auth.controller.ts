import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Public } from '../../core/auth/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<{ id: string; email: string }> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    return this.auth.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: User): { id: string; email: string; name: string | null } {
    // Campos escolhidos explicitamente: devolver o registro do Prisma
    // exporia passwordHash.
    return { id: user.id, email: user.email, name: user.name };
  }
}
