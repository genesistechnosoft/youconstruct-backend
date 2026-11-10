import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ProfessionalDiscoveryController } from './professional-discovery.controller';
import { ProfessionalDiscoveryRepository } from './professional-discovery.repository';
import { ProfessionalDiscoveryService } from './professional-discovery.service';

@Module({
  imports: [MediaModule],
  controllers: [ProfessionalDiscoveryController],
  providers: [ProfessionalDiscoveryService, ProfessionalDiscoveryRepository],
})
export class ProfessionalDiscoveryModule {}
