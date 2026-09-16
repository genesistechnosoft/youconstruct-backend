import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AdminBrandsController, BrandsController } from './brands.controller';
import { BrandsRepository } from './brands.repository';
import { BrandsService } from './brands.service';

@Module({
  imports: [MediaModule],
  controllers: [BrandsController, AdminBrandsController],
  providers: [BrandsService, BrandsRepository],
  exports: [BrandsService],
})
export class BrandsModule {}
