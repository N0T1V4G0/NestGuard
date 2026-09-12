import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123';

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  // upsert: rodar o seed duas vezes não duplica nem sobrescreve o que já
  // existe — importante porque ele roda em cada setup de ambiente.
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: 'Admin',
      // O admin do seed já nasce verificado: não há caixa de entrada para
      // confirmar num ambiente de desenvolvimento.
      emailVerifiedAt: new Date(),
    },
  });

  console.log(`Seed concluído. Usuário admin: ${email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
