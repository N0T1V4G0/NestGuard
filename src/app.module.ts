import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from './core/config/env.schema';
import { JwtAuthGuard } from './core/auth/jwt-auth.guard';
import { HealthController } from './core/common/health.controller';
import { ConfigModule } from './core/config/config.module';
import { CryptoModule } from './core/crypto/crypto.module';
import { DatabaseModule } from './core/database/database.module';
import { MailModule } from './core/mail/mail.module';
import { PermissionGuard } from './core/rbac/permission.guard';
import { RbacModule } from './core/rbac/rbac.module';
import { AuthModule } from './modules/auth/auth.module';
import { PostsModule } from './modules/posts/posts.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CryptoModule,
    MailModule,
    RbacModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          // 'silent' desliga o log por completo — usado pela suíte de testes,
          // onde uma linha JSON por requisição enterraria a saída do Jest.
          level: process.env.LOG_LEVEL ?? 'info',
          // O request id correlaciona todas as linhas de uma requisição.
          // Respeita o x-request-id do cliente quando existe, para rastrear
          // através de um gateway ou de outro serviço.
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
          // Log legível em desenvolvimento, JSON em produção — onde a saída é
          // consumida por agregador, não por humano.
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty' }
              : undefined,
          // Sem isso, senha e token vazam para o log — que costuma ir parar
          // em serviço de terceiro e ficar retido por meses.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
            'res.headers["set-cookie"]',
          ],
        },
      }),
    }),
    // Dois limites nomeados, ambos vindos do ambiente: 'default' para tudo,
    // 'sensitive' para rotas que aceitam credenciais ou disparam e-mail. O
    // controller só referencia o nome — nenhum número fica preso em código.
    //
    // Os valores são funções, não números: o throttler as resolve a cada
    // requisição, então trocar a configuração não exige reconstruir o módulo.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const ttl = () => config.get('THROTTLE_TTL_MS', { infer: true });
        return [
          {
            name: 'default',
            ttl,
            limit: () => config.get('THROTTLE_LIMIT_DEFAULT', { infer: true }),
          },
          {
            name: 'sensitive',
            ttl,
            limit: () => config.get('THROTTLE_LIMIT_SENSITIVE', { infer: true }),
          },
        ];
      },
    }),
    UsersModule,
    AuthModule,
    PostsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordem importa: o throttler roda antes da autenticação, senão um
    // atacante gastaria tentativas de login sem nunca ser barrado.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Guard global: toda rota exige autenticação, e o acesso anônimo é
    // declarado caso a caso com @Public(). Esquecer o decorator deixa a rota
    // protegida — o erro seguro.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Depois do JwtAuthGuard: a permissão só faz sentido com o usuário já
    // resolvido no request.
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
