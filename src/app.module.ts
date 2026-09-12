import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './core/auth/jwt-auth.guard';
import { ConfigModule } from './core/config/config.module';
import { CryptoModule } from './core/crypto/crypto.module';
import { DatabaseModule } from './core/database/database.module';
import { MailModule } from './core/mail/mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [ConfigModule, DatabaseModule, CryptoModule, MailModule, UsersModule, AuthModule],
  providers: [
    // Guard global: toda rota exige autenticação, e o acesso anônimo é
    // declarado caso a caso com @Public(). Esquecer o decorator deixa a rota
    // protegida — o erro seguro.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
