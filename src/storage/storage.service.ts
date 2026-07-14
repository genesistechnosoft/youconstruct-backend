import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReadStream } from 'fs';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { R2StorageDriver } from './drivers/r2-storage.driver';
import { SaveFileInput, StorageDriver } from './storage-driver.interface';

@Injectable()
export class StorageService {
  private readonly driver: StorageDriver;

  constructor(
    config: ConfigService,
    localDriver: LocalStorageDriver,
    r2Driver: R2StorageDriver,
  ) {
    const configuredDriver = config
      .get<string>('STORAGE_DRIVER', 'local')
      .toLowerCase();
    this.driver = configuredDriver === 'r2' ? r2Driver : localDriver;
  }

  save(input: SaveFileInput): Promise<void> {
    return this.driver.save(input);
  }

  delete(storageKey: string): Promise<void> {
    return this.driver.delete(storageKey);
  }

  getUrl(storageKey: string): string {
    return this.driver.getUrl(storageKey);
  }

  getReadStream(storageKey: string): ReadStream {
    return this.driver.getReadStream(storageKey);
  }
}
