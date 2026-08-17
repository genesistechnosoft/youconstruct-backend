import { Module } from '@nestjs/common';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsRepository } from './platform-settings.repository';
import { PlatformSettingsService } from './platform-settings.service';

@Module({
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService, PlatformSettingsRepository],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
