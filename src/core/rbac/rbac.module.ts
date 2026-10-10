import { Global, Module } from '@nestjs/common';
import { PermissionCatalogValidator } from './permission-catalog.validator';
import { PermissionGuard } from './permission.guard';
import { PermissionsCacheService } from './permissions-cache.service';
import { PermissionsService } from './permissions.service';
import { ResourceRegistry } from './resource-registry';
import { RolesService } from './roles.service';

@Global()
@Module({
  providers: [
    PermissionCatalogValidator,
    PermissionsCacheService,
    PermissionsService,
    PermissionGuard,
    ResourceRegistry,
    RolesService,
  ],
  exports: [
    PermissionCatalogValidator,
    PermissionsCacheService,
    PermissionsService,
    PermissionGuard,
    ResourceRegistry,
    RolesService,
  ],
})
export class RbacModule {}
