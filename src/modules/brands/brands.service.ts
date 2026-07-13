import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { generateSlug } from '../../common/utils/slug.util';
import { BrandsRepository } from './brands.repository';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly brandsRepository: BrandsRepository) {}

  async findAll() {
    const brands = await this.brandsRepository.findAll();
    return { message: 'Brands fetched successfully', data: brands };
  }

  async findById(id: string) {
    const brand = await this.brandsRepository.findActiveById(id);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return { message: 'Brand fetched successfully', data: brand };
  }

  async findAllAdmin(page = 1, limit = 20) {
    const { skip, take } = paginate(page, limit);
    const [brands, total] = await Promise.all([
      this.brandsRepository.findAll(true, skip, take),
      this.brandsRepository.countAll(true),
    ]);

    return {
      message: 'Brands fetched successfully',
      data: brands,
      meta: paginationMeta(page, limit, total),
    };
  }

  async findByIdAdmin(id: string) {
    const brand = await this.brandsRepository.findById(id);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return { message: 'Brand fetched successfully', data: brand };
  }

  async create(dto: CreateBrandDto) {
    const slug = dto.slug ?? generateSlug(dto.name);
    const existingSlug = await this.brandsRepository.findBySlug(slug);
    if (existingSlug) {
      throw new ConflictException('Brand slug already exists');
    }

    const brand = await this.brandsRepository.create({
      name: dto.name,
      slug,
      isActive: dto.isActive ?? true,
    });

    return { message: 'Brand created successfully', data: brand };
  }

  async update(id: string, dto: UpdateBrandDto) {
    const existing = await this.brandsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Brand not found');
    }

    if (dto.slug !== undefined) {
      const existingSlug = await this.brandsRepository.findBySlug(dto.slug, id);
      if (existingSlug) {
        throw new ConflictException('Brand slug already exists');
      }
    }

    const brand = await this.brandsRepository.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.slug !== undefined && { slug: dto.slug }),
    });

    return { message: 'Brand updated successfully', data: brand };
  }

  async activate(id: string) {
    const existing = await this.brandsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Brand not found');
    }

    const brand = await this.brandsRepository.update(id, { isActive: true });
    return { message: 'Brand activated successfully', data: brand };
  }

  async deactivate(id: string) {
    const existing = await this.brandsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Brand not found');
    }
    await this.assertBrandHasNoActiveProducts(id);

    const brand = await this.brandsRepository.update(id, { isActive: false });
    return { message: 'Brand deactivated successfully', data: brand };
  }

  async remove(id: string) {
    const existing = await this.brandsRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Brand not found');
    }
    await this.assertBrandHasNoActiveProducts(id);

    await this.brandsRepository.softDelete(id);
    return { message: 'Brand deleted successfully', data: null };
  }

  private async assertBrandHasNoActiveProducts(id: string) {
    const activeProducts = await this.brandsRepository.countActiveProducts(id);

    if (activeProducts > 0) {
      throw new BadRequestException(
        'Brand has active products and cannot be disabled',
      );
    }
  }
}
