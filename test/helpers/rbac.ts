import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/core/database/prisma.service';

/**
 * Cria um papel com as concessões dadas e vincula ao usuário.
 * Usado pelas suítes de RBAC para montar cenários de permissão.
 */
export async function giveUserRole(
  app: INestApplication,
  userId: string,
  grants: { permission: string; condition?: object | null }[],
  options: { name?: string; inheritsId?: string } = {},
): Promise<string> {
  const prisma = app.get(PrismaService);
  const name = options.name ?? `test-role-${Math.random().toString(36).slice(2, 10)}`;

  const role = await prisma.role.create({
    data: {
      name,
      inheritsId: options.inheritsId,
      grants: {
        create: grants.map((g) => ({
          permission: g.permission,
          condition: g.condition ?? undefined,
        })),
      },
    },
  });

  await prisma.userRole.create({ data: { userId, roleId: role.id } });
  return role.id;
}

/**
 * Remove papéis e posts criados pelos testes, preservando os de sistema.
 *
 * Nunca usar `deleteMany()` sem `where` aqui: um delete amplo apaga o vínculo
 * UserRole que o seed cria para o admin, e a suíte seguinte roda contra um
 * banco sem administrador — falha intermitente e difícil de rastrear.
 */
export async function resetRbac(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);

  await prisma.userRole.deleteMany({ where: { role: { isSystem: false } } });
  await prisma.post.deleteMany();
  await prisma.roleGrant.deleteMany({ where: { role: { isSystem: false } } });
  await prisma.role.deleteMany({ where: { isSystem: false } });
}
