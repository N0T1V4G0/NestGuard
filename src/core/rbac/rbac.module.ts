import { Global, Module } from '@nestjs/common';
import { PermissionCatalogValidator } from './permission-catalog.validator';
import { PermissionGuard } from './permission.guard';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  providers: [PermissionCatalogValidator, PermissionsService, PermissionGuard],
  exports: [PermissionCatalogValidator, PermissionsService, PermissionGuard],
})
export class RbacModule {}
