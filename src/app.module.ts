import { Module } from '@nestjs/common';
import { ConfigModule } from './core/config/config.module';
import { DatabaseModule } from './core/database/database.module';

@Module({
  imports: [ConfigModule, DatabaseModule],
})
export class AppModule {}
