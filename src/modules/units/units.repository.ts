import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const unitSelect = {
  id: true,
  name: true,
  symbol: true,
  code: true,
  type: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UnitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.unit.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: unitSelect,
    });
  }

  findById(id: string) {
    return this.prisma.unit.findFirst({
      where: { id },
      select: unitSelect,
    });
  }
}
