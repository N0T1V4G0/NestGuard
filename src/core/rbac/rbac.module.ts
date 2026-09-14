import { Global, Module } from '@nestjs/common';
import { PermissionCatalogValidator } from './permission-catalog.validator';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  providers: [PermissionCatalogValidator, PermissionsService],
  exports: [PermissionCatalogValidator, PermissionsService],
})
export class RbacModule {}
