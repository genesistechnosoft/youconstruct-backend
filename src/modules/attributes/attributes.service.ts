import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { AttributesRepository } from './attributes.repository';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';

@Injectable()
export class AttributesService {
  constructor(private readonly attributesRepository: AttributesRepository) {}

  async findAll() {
    const attributes = await this.attributesRepository.findAll();
    return { message: 'Attributes fetched successfully', data: attributes };
  }

  async findAllAdmin(page = 1, limit = 20) {
    const { skip, take } = paginate(page, limit);
    const [attributes, total] = await Promise.all([
      this.attributesRepository.findAllPaginated(skip, take),
      this.attributesRepository.countAll(),
    ]);

    return {
      message: 'Attributes fetched successfully',
      data: attributes,
      meta: paginationMeta(page, limit, total),
    };
  }

  async findById(id: string) {
    const attribute = await this.attributesRepository.findById(id);
    if (!attribute) {
      throw new NotFoundException('Attribute not found');
    }
    return { message: 'Attribute fetched successfully', data: attribute };
  }

  async create(dto: CreateAttributeDto) {
    const existing = await this.attributesRepository.findByName(dto.name);
    if (existing) {
      throw new ConflictException('Attribute name already exists');
    }

    const attribute = await this.attributesRepository.create({
      name: dto.name,
      ...(dto.unit !== undefined && { unit: dto.unit }),
    });

    return { message: 'Attribute created successfully', data: attribute };
  }

  async update(id: string, dto: UpdateAttributeDto) {
    const existing = await this.attributesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Attribute not found');
    }

    if (dto.name !== undefined) {
      const duplicate = await this.attributesRepository.findByName(
        dto.name,
        id,
      );
      if (duplicate) {
        throw new ConflictException('Attribute name already exists');
      }
    }

    const attribute = await this.attributesRepository.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.unit !== undefined && { unit: dto.unit }),
    });

    return { message: 'Attribute updated successfully', data: attribute };
  }

  async remove(id: string) {
    const existing = await this.attributesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Attribute not found');
    }

    const usageCount =
      await this.attributesRepository.countVariantAttributes(id);
    if (usageCount > 0) {
      throw new BadRequestException(
        'Attribute is in use by product variants and cannot be deleted',
      );
    }

    await this.attributesRepository.hardDelete(id);
    return { message: 'Attribute deleted successfully', data: null };
  }
}
