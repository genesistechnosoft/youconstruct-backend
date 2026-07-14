import { Global, Module } from '@nestjs/common';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { R2StorageDriver } from './drivers/r2-storage.driver';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [StorageService, LocalStorageDriver, R2StorageDriver],
  exports: [StorageService],
})
export class StorageModule {}
