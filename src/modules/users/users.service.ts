import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getMe(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { message: 'Profile fetched successfully', data: user };
  }

  async updateMe(userId: string, dto: { name?: string; fcmToken?: string }) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.usersRepository.update(userId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.fcmToken !== undefined && { fcmToken: dto.fcmToken }),
    });

    return { message: 'Profile updated successfully', data: updatedUser };
  }

  async getAddresses(userId: string) {
    const addresses = await this.usersRepository.findAddresses(userId);
    return { message: 'Addresses fetched successfully', data: addresses };
  }

  async addAddress(
    userId: string,
    dto: {
      label?: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
      latitude?: number;
      longitude?: number;
      isDefault?: boolean;
    },
  ) {
    const address = await this.usersRepository.createAddress(userId, dto);
    return { message: 'Address added successfully', data: address };
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: {
      label?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
      latitude?: number;
      longitude?: number;
      isDefault?: boolean;
    },
  ) {
    const address = await this.usersRepository.findAddressById(
      addressId,
      userId,
    );
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    const updatedAddress = await this.usersRepository.updateAddress(
      addressId,
      userId,
      dto,
    );
    return { message: 'Address updated successfully', data: updatedAddress };
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.usersRepository.findAddressById(
      addressId,
      userId,
    );
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    await this.usersRepository.softDeleteAddress(addressId);
    return { message: 'Address deleted successfully', data: null };
  }
}
