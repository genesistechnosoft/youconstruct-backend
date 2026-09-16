import { Module } from '@nestjs/common';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import { MediaModule } from '../media/media.module';
import {
  AdminCategoriesController,
  CategoriesController,
} from './categories.controller';
import { CategoriesRepository } from './categories.repository';
import { CategoriesService } from './categories.service';

@Module({
  imports: [MediaModule],
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoriesService, CategoriesRepository, RedisCacheService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
