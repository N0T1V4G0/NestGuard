import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Config da CLI do Prisma (migrate, studio, generate). O client em runtime não
// passa por aqui — ele recebe o adapter montado no PrismaService.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
