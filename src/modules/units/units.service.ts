import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitsRepository } from './units.repository';

@Injectable()
export class UnitsService {
  constructor(private readonly unitsRepository: UnitsRepository) {}

  async findAll() {
    const units = await this.unitsRepository.findAll();
    return { message: 'Units fetched successfully', data: units };
  }

  async findById(id: string) {
    const unit = await this.unitsRepository.findById(id);
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    return { message: 'Unit fetched successfully', data: unit };
  }
}
