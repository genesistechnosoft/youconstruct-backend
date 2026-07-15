import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { R2StorageDriver } from './drivers/r2-storage.driver';
import { StorageDriverClient } from './drivers/storage-driver.interface';
import { STORAGE_DRIVER_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    StorageService,
    {
      provide: STORAGE_DRIVER_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriverClient => {
        const driver = config
          .get<string>('STORAGE_DRIVER', 'LOCAL')
          .toUpperCase();
        return driver === 'R2'
          ? new R2StorageDriver(config)
          : new LocalStorageDriver(config);
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
