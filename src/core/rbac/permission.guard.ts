import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '@prisma/client';
import { evaluateCondition } from './condition.evaluator';
import { CURRENT_RESOURCE } from './current-resource.decorator';
import { PermissionsService } from './permissions.service';
import { PERMISSION_KEY, type PermissionMetadata } from './require-permission.decorator';
import { ResourceRegistry } from './resource-registry';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
    private readonly resources: ResourceRegistry,
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

    const request = context.switchToHttp().getRequest<
      { user?: User; params?: Record<string, string> } & Record<string, unknown>
    >();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Acesso negado');
    }

    const conditions = (await this.permissions.resolve(user.id)).get(metadata.permission);

    if (!conditions) {
      throw new ForbiddenException('Acesso negado');
    }

    // Concessão irrestrita: nada a avaliar contra o recurso.
    if (conditions.includes(null)) {
      // Ainda assim carrega o recurso quando a rota pede, para injetar no
      // handler e devolver 404 coerente em vez de 200 sobre nada.
      if (metadata.resource) {
        request[CURRENT_RESOURCE] = await this.loadOrFail(metadata, request.params ?? {});
      }
      return true;
    }

    // Só há concessões condicionais, e não há recurso para avaliá-las contra.
    // Negar é o correto: uma condição que não pode ser verificada não autoriza.
    if (!metadata.resource) {
      throw new ForbiddenException('Acesso negado');
    }

    const resource = await this.loadOrFail(metadata, request.params ?? {});

    // Basta uma condição satisfeita: papéis somam acesso.
    const allowed = conditions.some(
      (condition) => condition !== null && evaluateCondition(condition, resource, user.id),
    );

    if (!allowed) {
      throw new ForbiddenException('Acesso negado');
    }

    request[CURRENT_RESOURCE] = resource;
    return true;
  }

  private async loadOrFail(
    metadata: PermissionMetadata,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const id = params[metadata.param ?? 'id'];
    const resource = await this.resources.load(metadata.resource!, id);

    if (!resource) {
      throw new NotFoundException('Recurso não encontrado');
    }

    return resource;
  }
}
