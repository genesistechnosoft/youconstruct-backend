import { Injectable, NotFoundException } from '@nestjs/common';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import { domainConflict } from '../../common/errors/domain-exception';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { CreateProfessionalCategoryDto } from './dto/create-professional-category.dto';
import { UpdateProfessionalCategoryDto } from './dto/update-professional-category.dto';
import { ProfessionalCategoriesRepository } from './professional-categories.repository';

const PROFESSIONAL_CATEGORIES_CACHE_KEY = 'professional_categories:public';
const PROFESSIONAL_CATEGORIES_CACHE_TTL_SECONDS = 5 * 60; // 5 minutes

@Injectable()
export class ProfessionalCategoriesService {
  constructor(
    private readonly repo: ProfessionalCategoriesRepository,
    private readonly redis: RedisCacheService,
  ) {}

  async listPublic() {
    type PublicCategory = Awaited<
      ReturnType<ProfessionalCategoriesRepository['findAll']>
    >;
    const cached = await this.redis.getJson<PublicCategory>(
      PROFESSIONAL_CATEGORIES_CACHE_KEY,
    );
    if (cached) {
      return {
        message: 'Professional categories fetched successfully',
        data: cached,
      };
    }

    const categories = await this.repo.findAll();
    await this.redis.setJson(
      PROFESSIONAL_CATEGORIES_CACHE_KEY,
      categories,
      PROFESSIONAL_CATEGORIES_CACHE_TTL_SECONDS,
    );

    return {
      message: 'Professional categories fetched successfully',
      data: categories,
    };
  }

  async listForAdmin() {
    const categories = await this.repo.findAllForAdmin();
    return {
      message: 'Professional categories fetched successfully',
      data: categories,
    };
  }

  async create(dto: CreateProfessionalCategoryDto) {
    const category = await this.repo.create(dto);
    await this.invalidateCache();
    return {
      message: 'Professional category created successfully',
      data: category,
    };
  }

  async update(id: string, dto: UpdateProfessionalCategoryDto) {
    const existing = await this.repo.findById(id);
    if (!existing)
      throw new NotFoundException('Professional category not found');

    const updated = await this.repo.update(id, dto);
    await this.invalidateCache();
    return {
      message: 'Professional category updated successfully',
      data: updated,
    };
  }

  async remove(id: string) {
    const existing = await this.repo.findById(id);
    if (!existing)
      throw new NotFoundException('Professional category not found');

    const inUseCount = await this.repo.countProfilesUsingCategory(id);
    if (inUseCount > 0) {
      throw domainConflict(
        DOMAIN_ERROR_CODES.PROFESSIONAL_CATEGORY_IN_USE,
        `Category is linked to ${inUseCount} professional profile(s) and cannot be deleted`,
      );
    }

    await this.repo.softDelete(id);
    await this.invalidateCache();
    return { message: 'Professional category deleted successfully' };
  }

  private async invalidateCache() {
    await this.redis.del(PROFESSIONAL_CATEGORIES_CACHE_KEY);
  }
}
