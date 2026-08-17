import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import {
  AdminBannersController,
  BannersController,
} from './banners.controller';
import { BannersRepository } from './banners.repository';
import { BannersService } from './banners.service';

@Module({
  imports: [MediaModule],
  controllers: [BannersController, AdminBannersController],
  providers: [BannersService, BannersRepository],
  exports: [BannersService],
})
export class BannersModule {}
