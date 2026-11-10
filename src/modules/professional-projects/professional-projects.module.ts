import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MediaModule } from '../media/media.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ProfessionalsModule } from '../professionals/professionals.module';
import { PURGE_PROJECT_MEDIA_QUEUE } from '../../queue/queue.constants';
import { PurgeProjectMediaProcessor } from '../../queue/processors/purge-project-media.processor';
import {
  AdminProjectsController,
  ProfessionalProjectsController,
} from './professional-projects.controller';
import { ProfessionalProjectsRepository } from './professional-projects.repository';
import { ProfessionalProjectsService } from './professional-projects.service';
@Module({
  imports: [
    BullModule.registerQueue({ name: PURGE_PROJECT_MEDIA_QUEUE }),
    forwardRef(() => ProfessionalsModule),
    MediaModule,
    PlatformSettingsModule,
  ],
  controllers: [ProfessionalProjectsController, AdminProjectsController],
  providers: [
    ProfessionalProjectsService,
    ProfessionalProjectsRepository,
    PurgeProjectMediaProcessor,
  ],
  exports: [ProfessionalProjectsService],
})
export class ProfessionalProjectsModule {}
