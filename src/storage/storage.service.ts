import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MediaAccessLevel,
  StorageDriver,
} from '../../generated/prisma/client.js';
import { STORAGE_DRIVER_CLIENT } from './storage.constants';
import type { StorageDriverClient } from './drivers/storage-driver.interface';

@Injectable()
export class StorageService {
  readonly driver: StorageDriver;

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_DRIVER_CLIENT)
    private readonly client: StorageDriverClient,
  ) {
    this.driver =
      this.config.get<string>('STORAGE_DRIVER', 'LOCAL').toUpperCase() === 'R2'
        ? StorageDriver.R2
        : StorageDriver.LOCAL;
  }

  putObject(key: string, buffer: Buffer, mimeType: string) {
    return this.client.putObject({ key, buffer, mimeType });
  }

  getObject(key: string) {
    return this.client.getObject(key);
  }

  deleteObject(key: string) {
    return this.client.deleteObject(key);
  }

  getUrl(key: string, accessLevel: MediaAccessLevel) {
    return this.client.getUrl(key, accessLevel);
  }
}
