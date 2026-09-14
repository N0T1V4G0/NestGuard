import { Global, Module } from '@nestjs/common';
import { PermissionCatalogValidator } from './permission-catalog.validator';

@Global()
@Module({
  providers: [PermissionCatalogValidator],
  exports: [PermissionCatalogValidator],
})
export class RbacModule {}
