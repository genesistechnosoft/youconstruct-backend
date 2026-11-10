import { Module } from '@nestjs/common';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import {
  AdminProfessionalCategoriesController,
  PublicProfessionalCategoriesController,
} from './professional-categories.controller';
import { ProfessionalCategoriesRepository } from './professional-categories.repository';
import { ProfessionalCategoriesService } from './professional-categories.service';

@Module({
  controllers: [
    PublicProfessionalCategoriesController,
    AdminProfessionalCategoriesController,
  ],
  providers: [
    ProfessionalCategoriesService,
    ProfessionalCategoriesRepository,
    RedisCacheService,
  ],
  exports: [ProfessionalCategoriesService],
})
export class ProfessionalCategoriesModule {}
