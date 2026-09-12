import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { EnvSchema } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // `loose` preserva as variáveis que não declaramos (PATH, HOME e afins).
      // Sem isso, o ConfigService passaria a enxergar apenas o nosso subconjunto.
      validate: (raw) => EnvSchema.loose().parse(raw),
    }),
  ],
})
export class ConfigModule {}
