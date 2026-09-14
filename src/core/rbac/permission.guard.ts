import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '@prisma/client';
import { PermissionsService } from './permissions.service';
import { PERMISSION_KEY, type PermissionMetadata } from './require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Rota sem @RequirePermission não é assunto deste guard: a autenticação
    // já foi resolvida pelo JwtAuthGuard.
    if (!metadata) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Acesso negado');
    }

    const resolved = await this.permissions.resolve(user.id);

    if (!resolved.has(metadata.permission)) {
      throw new ForbiddenException('Acesso negado');
    }

    return true;
  }
}
