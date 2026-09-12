import { Module } from '@nestjs/common';
import { ConfigModule } from './core/config/config.module';
import { CryptoModule } from './core/crypto/crypto.module';
import { DatabaseModule } from './core/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule, CryptoModule],
})
export class AppModule {}
