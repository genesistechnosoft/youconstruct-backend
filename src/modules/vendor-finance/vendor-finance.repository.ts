import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PayoutOrigin,
  PayoutStatus,
  PayoutTriggerType,
  Prisma,
  TransactionReason,
  TransactionType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';

export const WALLET_SELECT = {
  id: true,
  vendorId: true,
  balance: true,
  lockedBalance: true,
  totalEarned: true,
  totalWithdrawn: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const TRANSACTION_SELECT = {
  id: true,
  vendorId: true,
  walletId: true,
  type: true,
  reason: true,
  amount: true,
  balanceBefore: true,
  balanceAfter: true,
  referenceId: true,
  referenceType: true,
  note: true,
  createdAt: true,
} as const;

export const BANK_ACCOUNT_SELECT = {
  id: true,
  vendorId: true,
  accountHolderName: true,
  // TODO: encrypt accountNumber at rest before production
  accountNumber: true,
  ifscCode: true,
  bankName: true,
  branchName: true,
  isVerified: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const PAYOUT_SELECT = {
  id: true,
  vendorId: true,
  walletId: true,
  bankAccountId: true,
  amount: true,
  status: true,
  triggerType: true,
  origin: true,
  initiatedByUserId: true,
  payoutMethod: true,
  referenceUtr: true,
  scheduledFor: true,
  processedAt: true,
  failureReason: true,
  razorpayPayoutId: true,
  createdAt: true,
  updatedAt: true,
  bankAccount: {
    select: {
      id: true,
      accountHolderName: true,
      bankName: true,
      ifscCode: true,
      isVerified: true,
    },
  },
} as const;

@Injectable()
export class VendorFinanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findApprovedVendorById(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id: vendorId, isApproved: true, deletedAt: null },
      select: { id: true },
    });
  }

  findVendorById(vendorId: string) {
    return this.prisma.vendorProfile.findFirst({
      where: { id: vendorId, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  findWallet(vendorId: string) {
    return this.prisma.vendorWallet.findUnique({
      where: { vendorId },
      select: WALLET_SELECT,
    });
  }

  async ensureWallet(vendorId: string) {
    try {
      return await this.prisma.vendorWallet.upsert({
        where: { vendorId },
        update: {},
        create: { vendorId },
        select: WALLET_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findTransactions(
    vendorId: string,
    filters: {
      skip: number;
      take: number;
      type?: TransactionType;
      reason?: TransactionReason;
    },
  ) {
    const where: Prisma.VendorTransactionWhereInput = {
      vendorId,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.reason ? { reason: filters.reason } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.vendorTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
        select: TRANSACTION_SELECT,
      }),
      this.prisma.vendorTransaction.count({ where }),
    ]);

    return { items, total };
  }

  findBankAccount(vendorId: string) {
    return this.prisma.vendorBankAccount.findFirst({
      where: { vendorId, deletedAt: null },
      select: BANK_ACCOUNT_SELECT,
    });
  }

  async findBankAccounts(filters: {
    isVerified: boolean;
    skip: number;
    take: number;
  }) {
    const where = {
      deletedAt: null,
      isVerified: filters.isVerified,
      vendor: { deletedAt: null },
    };

    const [items, total] = await Promise.all([
      this.prisma.vendorBankAccount.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
        select: {
          ...BANK_ACCOUNT_SELECT,
          vendor: {
            select: {
              id: true,
              businessName: true,
              slug: true,
            },
          },
        },
      }),
      this.prisma.vendorBankAccount.count({ where }),
    ]);

    return { items, total };
  }

  async createBankAccount(
    vendorId: string,
    data: {
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName: string;
      branchName?: string;
    },
  ) {
    try {
      return await this.prisma.vendorBankAccount.upsert({
        where: { vendorId },
        update: {
          accountHolderName: data.accountHolderName,
          accountNumber: data.accountNumber,
          ifscCode: data.ifscCode,
          bankName: data.bankName,
          branchName: data.branchName,
          isVerified: false,
          verifiedAt: null,
          deletedAt: null,
        },
        create: {
          vendorId,
          accountHolderName: data.accountHolderName,
          accountNumber: data.accountNumber,
          ifscCode: data.ifscCode,
          bankName: data.bankName,
          branchName: data.branchName,
        },
        select: BANK_ACCOUNT_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error, 'Bank account already exists for vendor');
    }
  }

  async updateBankAccount(
    vendorId: string,
    data: {
      accountHolderName?: string;
      accountNumber?: string;
      ifscCode?: string;
      bankName?: string;
      branchName?: string | null;
      isVerified?: boolean;
      verifiedAt?: Date | null;
    },
  ) {
    try {
      return await this.prisma.vendorBankAccount.update({
        where: { vendorId },
        data,
        select: BANK_ACCOUNT_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async deleteBankAccount(vendorId: string) {
    try {
      await this.prisma.vendorBankAccount.update({
        where: { vendorId },
        data: {
          deletedAt: new Date(),
          isVerified: false,
          verifiedAt: null,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  countActivePayouts(vendorId: string) {
    return this.prisma.vendorPayout.count({
      where: {
        vendorId,
        status: {
          in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING],
        },
      },
    });
  }

  async verifyBankAccount(vendorId: string) {
    try {
      return await this.prisma.vendorBankAccount.update({
        where: { vendorId },
        data: {
          isVerified: true,
          verifiedAt: new Date(),
        },
        select: BANK_ACCOUNT_SELECT,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findPayouts(filters: {
    vendorId?: string;
    status?: PayoutStatus;
    skip: number;
    take: number;
  }) {
    const where: Prisma.VendorPayoutWhereInput = {
      ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.vendorPayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
        select: PAYOUT_SELECT,
      }),
      this.prisma.vendorPayout.count({ where }),
    ]);

    return { items, total };
  }

  findPayoutById(id: string) {
    return this.prisma.vendorPayout.findUnique({
      where: { id },
      select: PAYOUT_SELECT,
    });
  }

  findPayoutForVendor(id: string, vendorId: string) {
    return this.prisma.vendorPayout.findFirst({
      where: { id, vendorId },
      select: PAYOUT_SELECT,
    });
  }

  /**
   * Request payout: lock funds + create PENDING row in one transaction.
   * Concurrent-safe via balance >= amount update count check.
   */
  async requestPayout(input: {
    vendorId: string;
    walletId: string;
    bankAccountId: string;
    amount: Prisma.Decimal;
    origin?: PayoutOrigin;
    initiatedByUserId?: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const activeCount = await tx.vendorPayout.count({
          where: {
            vendorId: input.vendorId,
            status: {
              in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING],
            },
          },
        });
        if (activeCount > 0) {
          throw new ConflictException(
            'A payout is already pending or processing',
          );
        }

        const updated = await tx.vendorWallet.updateMany({
          where: {
            id: input.walletId,
            vendorId: input.vendorId,
            balance: { gte: input.amount },
          },
          data: {
            balance: { decrement: input.amount },
            lockedBalance: { increment: input.amount },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException('Insufficient wallet balance');
        }

        return tx.vendorPayout.create({
          data: {
            vendorId: input.vendorId,
            walletId: input.walletId,
            bankAccountId: input.bankAccountId,
            amount: input.amount,
            status: PayoutStatus.PENDING,
            triggerType: PayoutTriggerType.MANUAL,
            origin: input.origin ?? PayoutOrigin.VENDOR_REQUEST,
            initiatedByUserId: input.initiatedByUserId ?? null,
          },
          select: PAYOUT_SELECT,
        });
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.handlePrismaError(error);
    }
  }

  async markPayoutProcessing(id: string) {
    try {
      const updated = await this.prisma.vendorPayout.updateMany({
        where: { id, status: PayoutStatus.PENDING },
        data: { status: PayoutStatus.PROCESSING },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Payout must be PENDING to mark as PROCESSING',
        );
      }
      return this.findPayoutById(id);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.handlePrismaError(error);
    }
  }

  async completePayout(input: {
    payoutId: string;
    vendorId: string;
    walletId: string;
    amount: Prisma.Decimal;
    payoutMethod: string;
    referenceUtr: string;
    razorpayPayoutId?: string;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const statusUpdate = await tx.vendorPayout.updateMany({
          where: {
            id: input.payoutId,
            status: PayoutStatus.PROCESSING,
          },
          data: {
            status: PayoutStatus.COMPLETED,
            payoutMethod: input.payoutMethod,
            referenceUtr: input.referenceUtr,
            razorpayPayoutId: input.razorpayPayoutId ?? null,
            processedAt: new Date(),
            failureReason: null,
          },
        });
        if (statusUpdate.count !== 1) {
          throw new ConflictException(
            'Payout must be PROCESSING to mark as COMPLETED',
          );
        }

        const wallet = await tx.vendorWallet.findUniqueOrThrow({
          where: { id: input.walletId },
          select: {
            id: true,
            balance: true,
            lockedBalance: true,
          },
        });

        if (wallet.lockedBalance.lessThan(input.amount)) {
          throw new ConflictException('Locked balance is insufficient');
        }

        await tx.vendorWallet.update({
          where: { id: input.walletId },
          data: {
            lockedBalance: { decrement: input.amount },
            totalWithdrawn: { increment: input.amount },
          },
        });

        // Ledger tracks spendable balance; complete does not change balance
        await tx.vendorTransaction.create({
          data: {
            vendorId: input.vendorId,
            walletId: input.walletId,
            type: TransactionType.DEBIT,
            reason: TransactionReason.PAYOUT,
            amount: input.amount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance,
            referenceId: input.payoutId,
            referenceType: 'PAYOUT',
            note: null,
          },
        });

        return tx.vendorPayout.findUniqueOrThrow({
          where: { id: input.payoutId },
          select: PAYOUT_SELECT,
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.handlePrismaError(error);
    }
  }

  async failPayout(input: {
    payoutId: string;
    vendorId: string;
    walletId: string;
    amount: Prisma.Decimal;
    failureReason: string;
    allowedFrom: PayoutStatus[];
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const statusUpdate = await tx.vendorPayout.updateMany({
          where: {
            id: input.payoutId,
            status: { in: input.allowedFrom },
          },
          data: {
            status: PayoutStatus.FAILED,
            failureReason: input.failureReason,
            processedAt: new Date(),
          },
        });
        if (statusUpdate.count !== 1) {
          throw new ConflictException(
            'Payout must be PENDING or PROCESSING to mark as FAILED',
          );
        }

        const wallet = await tx.vendorWallet.findUniqueOrThrow({
          where: { id: input.walletId },
          select: {
            id: true,
            balance: true,
            lockedBalance: true,
          },
        });

        if (wallet.lockedBalance.lessThan(input.amount)) {
          throw new ConflictException('Locked balance is insufficient');
        }

        const balanceAfter = wallet.balance.add(input.amount);

        await tx.vendorWallet.update({
          where: { id: input.walletId },
          data: {
            balance: { increment: input.amount },
            lockedBalance: { decrement: input.amount },
          },
        });

        await tx.vendorTransaction.create({
          data: {
            vendorId: input.vendorId,
            walletId: input.walletId,
            type: TransactionType.CREDIT,
            reason: TransactionReason.ADJUSTMENT,
            amount: input.amount,
            balanceBefore: wallet.balance,
            balanceAfter,
            referenceId: input.payoutId,
            referenceType: 'PAYOUT',
            note: 'Payout failed - restored',
          },
        });

        return tx.vendorPayout.findUniqueOrThrow({
          where: { id: input.payoutId },
          select: PAYOUT_SELECT,
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(
    error: unknown,
    conflictMessage = 'Vendor finance resource already exists',
  ): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(conflictMessage);
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Vendor finance resource not found');
    }

    throw error;
  }
}
