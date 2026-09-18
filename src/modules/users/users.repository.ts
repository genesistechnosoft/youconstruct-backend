import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

const ADDRESS_SELECT = {
  id: true,
  userId: true,
  label: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  pincode: true,
  phone: true,
  latitude: true,
  longitude: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        platformRole: true,
        provider: true,
        avatarUrl: true,
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
        fcmToken: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput) {
    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          platformRole: true,
          provider: true,
          avatarUrl: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          isActive: true,
          fcmToken: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ADDRESS_SELECT,
    });
  }

  findAddressById(id: string, userId: string) {
    return this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
      select: ADDRESS_SELECT,
    });
  }

  async createAddress(
    userId: string,
    data: Prisma.AddressCreateWithoutUserInput,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.address.updateMany({
            where: { userId, deletedAt: null },
            data: { isDefault: false },
          });
        }

        return tx.address.create({
          data: {
            ...data,
            user: { connect: { id: userId } },
          },
          select: ADDRESS_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateAddress(
    id: string,
    userId: string,
    data: Prisma.AddressUpdateInput,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.address.updateMany({
            where: { userId, deletedAt: null },
            data: { isDefault: false },
          });
        }

        return tx.address.update({
          where: { id },
          data,
          select: ADDRESS_SELECT,
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async softDeleteAddress(id: string) {
    try {
      return await this.prisma.address.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: ADDRESS_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  unsetDefaultAddresses(userId: string) {
    return this.prisma.address.updateMany({
      where: { userId, deletedAt: null },
      data: { isDefault: false },
    });
  }

  setDefaultAddress(id: string) {
    return this.prisma.address.update({
      where: { id },
      data: { isDefault: true },
      select: ADDRESS_SELECT,
    });
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('User data already exists');
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Resource not found');
    }

    throw error;
  }
}
