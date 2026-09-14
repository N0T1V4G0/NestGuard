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

  // Papéis de sistema. `isSystem` impede que sejam removidos pela API —
  // apagar 'admin' por engano deixaria a aplicação sem administrador.
  //
  // A hierarquia é viewer <- editor <- admin: cada um herda o anterior e
  // acrescenta. É também a demonstração de herança que a documentação usa.
  const viewer = await prisma.role.upsert({
    where: { name: 'viewer' },
    update: {},
    create: {
      name: 'viewer',
      description: 'Lê conteúdo publicado',
      isSystem: true,
      grants: { create: [{ permission: 'post:read', condition: { status: 'PUBLISHED' } }] },
    },
  });

  const editor = await prisma.role.upsert({
    where: { name: 'editor' },
    update: {},
    create: {
      name: 'editor',
      description: 'Cria e edita os próprios posts',
      isSystem: true,
      inheritsId: viewer.id,
      grants: {
        create: [
          { permission: 'post:create' },
          { permission: 'post:read', condition: { ownerId: '$user.id' } },
          { permission: 'post:update', condition: { ownerId: '$user.id' } },
          { permission: 'post:delete', condition: { ownerId: '$user.id' } },
        ],
      },
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Acesso total',
      isSystem: true,
      inheritsId: editor.id,
      grants: {
        create: [
          { permission: 'post:read' },
          { permission: 'post:update' },
          { permission: 'post:delete' },
          { permission: 'post:publish' },
        ],
      },
    },
  });

  const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  console.log(`Seed concluído. Usuário admin: ${email}`);
  console.log('Papéis de sistema: viewer, editor, admin');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
