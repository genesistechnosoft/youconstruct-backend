import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

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
        role: true,
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

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
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

  findAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  findAddressById(id: string, userId: string) {
    return this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
    });
  }

  createAddress(userId: string, data: Prisma.AddressCreateWithoutUserInput) {
    return this.prisma.address.create({
      data: {
        ...data,
        user: { connect: { id: userId } },
      },
    });
  }

  updateAddress(id: string, data: Prisma.AddressUpdateInput) {
    return this.prisma.address.update({
      where: { id },
      data,
    });
  }

  softDeleteAddress(id: string) {
    return this.prisma.address.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
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
    });
  }
}
