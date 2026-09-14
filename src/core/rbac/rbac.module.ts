import { Global, Module } from '@nestjs/common';
import { PermissionCatalogValidator } from './permission-catalog.validator';
import { PermissionGuard } from './permission.guard';
import { PermissionsService } from './permissions.service';
import { ResourceRegistry } from './resource-registry';

@Global()
@Module({
  providers: [PermissionCatalogValidator, PermissionsService, PermissionGuard, ResourceRegistry],
  exports: [PermissionCatalogValidator, PermissionsService, PermissionGuard, ResourceRegistry],
})
export class RbacModule {}
