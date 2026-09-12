import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../database/prisma.service';

@SkipThrottle({ sensitive: true })
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness: o processo está de pé.
   *
   * Não toca em dependências de propósito. Se esta rota falhar, o orquestrador
   * reinicia o container — e reiniciar não resolve banco fora do ar.
   */
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness: pronto para receber tráfego.
   *
   * Falha quando o banco está inacessível, para que o load balancer tire esta
   * instância da rotação sem reiniciá-la. Quando o banco volta, ela volta
   * sozinha.
   */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }

    return { status: 'ok', database: 'up' };
  }
}
