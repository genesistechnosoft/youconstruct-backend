import { Global, Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { NotificationEmitterService } from './notification-emitter.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [PlatformSettingsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationEmitterService,
    NotificationsService,
    NotificationsRepository,
  ],
  exports: [NotificationEmitterService],
})
export class NotificationsModule {}
