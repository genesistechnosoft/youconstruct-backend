import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

export const ATTRIBUTE_SELECT = {
  id: true,
  name: true,
  unit: true,
  createdAt: true,
} as const;

@Injectable()
export class AttributesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.attributeDefinition.findMany({
      orderBy: { name: 'asc' },
      select: ATTRIBUTE_SELECT,
    });
  }

  findAllPaginated(skip?: number, take?: number) {
    return this.prisma.attributeDefinition.findMany({
      orderBy: { name: 'asc' },
      skip,
      take,
      select: ATTRIBUTE_SELECT,
    });
  }

  countAll() {
    return this.prisma.attributeDefinition.count();
  }

  findById(id: string) {
    return this.prisma.attributeDefinition.findFirst({
      where: { id },
      select: ATTRIBUTE_SELECT,
    });
  }

  findByName(name: string, excludeId?: string) {
    return this.prisma.attributeDefinition.findFirst({
      where: {
        name,
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
  }

  countVariantAttributes(attributeId: string) {
    return this.prisma.variantAttribute.count({
      where: { attributeId },
    });
  }

  async create(data: Prisma.AttributeDefinitionCreateInput) {
    try {
      return await this.prisma.attributeDefinition.create({
        data,
        select: ATTRIBUTE_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: string, data: Prisma.AttributeDefinitionUpdateInput) {
    try {
      return await this.prisma.attributeDefinition.update({
        where: { id },
        data,
        select: ATTRIBUTE_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async hardDelete(id: string) {
    try {
      return await this.prisma.attributeDefinition.delete({
        where: { id },
        select: ATTRIBUTE_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Attribute name already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Attribute not found');
    }

    throw error;
  }
}
