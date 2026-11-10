import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import {
  AdminProfessionalsController,
  ProfessionalOnboardingController,
  ProfessionalRolesController,
  ProfessionalTeamController,
} from './professionals.controller';
import { ProfessionalsRepository } from './professionals.repository';
import { ProfessionalsService } from './professionals.service';

@Module({
  imports: [PlatformSettingsModule],
  controllers: [
    ProfessionalOnboardingController,
    ProfessionalTeamController,
    ProfessionalRolesController,
    AdminProfessionalsController,
  ],
  providers: [ProfessionalsService, ProfessionalsRepository],
  exports: [ProfessionalsService, ProfessionalsRepository],
})
export class ProfessionalsModule {}
