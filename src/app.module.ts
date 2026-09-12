import { Module } from '@nestjs/common';
import { ConfigModule } from './core/config/config.module';

@Module({
  imports: [ConfigModule],
})
export class AppModule {}
