import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateSlug } from '../../common/utils/slug.util';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoriesRepository } from './categories.repository';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepository: CategoriesRepository) {}

  async getTree() {
    const categories = await this.categoriesRepository.findRoots();
    return { message: 'Categories fetched successfully', data: categories };
  }

  async findById(id: string) {
    const category = await this.categoriesRepository.findActiveById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return { message: 'Category fetched successfully', data: category };
  }

  async findAllAdmin() {
    const categories = await this.categoriesRepository.findAllAdmin();
    return { message: 'Categories fetched successfully', data: categories };
  }

  async getTreeAdmin() {
    const categories = await this.categoriesRepository.findRootsAdmin();
    return { message: 'Categories fetched successfully', data: categories };
  }

  async findByIdAdmin(id: string) {
    const category = await this.categoriesRepository.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return { message: 'Category fetched successfully', data: category };
  }

  async create(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.categoriesRepository.findById(dto.parentId);
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
    }

    const slug = dto.slug ?? generateSlug(dto.name);
    const existingSlug = await this.categoriesRepository.findBySlug(slug);
    if (existingSlug) {
      throw new ConflictException('Category slug already exists');
    }

    const category = await this.categoriesRepository.create({
      name: dto.name,
      slug,
      ...(dto.parentId && { parent: { connect: { id: dto.parentId } } }),
      ...(dto.description !== undefined && { description: dto.description }),
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });

    return { message: 'Category created successfully', data: category };
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    if (dto.slug !== undefined) {
      const existingSlug = await this.categoriesRepository.findBySlug(
        dto.slug,
        id,
      );
      if (existingSlug) {
        throw new ConflictException('Category slug already exists');
      }
    }

    const category = await this.categoriesRepository.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.slug !== undefined && { slug: dto.slug }),
      ...(dto.parentId !== undefined && {
        parent: dto.parentId
          ? { connect: { id: dto.parentId } }
          : { disconnect: true },
      }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
    });

    return { message: 'Category updated successfully', data: category };
  }

  async activate(id: string) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    const category = await this.categoriesRepository.update(id, {
      isActive: true,
    });

    return { message: 'Category activated successfully', data: category };
  }

  async deactivate(id: string) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    const category = await this.categoriesRepository.update(id, {
      isActive: false,
    });

    return { message: 'Category deactivated successfully', data: category };
  }

  async remove(id: string) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    await this.categoriesRepository.softDelete(id);
    return { message: 'Category deleted successfully', data: null };
  }
}
