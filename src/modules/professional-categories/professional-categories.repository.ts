import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProfessionalCategoryDto } from './dto/create-professional-category.dto';
import { UpdateProfessionalCategoryDto } from './dto/update-professional-category.dto';
import { generateSlug } from '../../common/utils/slug.util';

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  sortOrder: true,
} as const;

@Injectable()
export class ProfessionalCategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.professionalCategory.findMany({
      where: { isActive: true, deletedAt: null },
      select: PUBLIC_CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findAllForAdmin() {
    return this.prisma.professionalCategory.findMany({
      where: { deletedAt: null },
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    return this.prisma.professionalCategory.findFirst({
      where: { id, deletedAt: null },
      select: CATEGORY_SELECT,
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.professionalCategory.findFirst({
      where: { slug, deletedAt: null },
      select: PUBLIC_CATEGORY_SELECT,
    });
  }

  async create(dto: CreateProfessionalCategoryDto) {
    const slug = generateSlug(dto.name);
    return this.prisma.professionalCategory.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        isActive: true,
      },
      select: CATEGORY_SELECT,
    });
  }

  async update(id: string, dto: UpdateProfessionalCategoryDto) {
    return this.prisma.professionalCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: CATEGORY_SELECT,
    });
  }

  async softDelete(id: string) {
    return this.prisma.professionalCategory.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
      select: { id: true },
    });
  }

  async countProfilesUsingCategory(categoryId: string) {
    return this.prisma.professionalProfileCategory.count({
      where: { categoryId },
    });
  }
}
