import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayoutStatus, Prisma } from '../../../generated/prisma/client.js';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { AdminListPayoutsQueryDto } from './dto/admin-list-payouts-query.dto';
import { CompletePayoutDto } from './dto/complete-payout.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { FailPayoutDto } from './dto/fail-payout.dto';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { VendorFinanceRepository } from './vendor-finance.repository';

const MIN_PAYOUT_AMOUNT = 100;

@Injectable()
export class VendorFinanceService {
  constructor(
    private readonly vendorFinanceRepository: VendorFinanceRepository,
  ) {}

  async getWallet(vendorProfileId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const wallet =
      await this.vendorFinanceRepository.ensureWallet(vendorProfileId);

    return {
      message: 'Wallet fetched successfully',
      data: this.toWalletResponse(wallet),
    };
  }

  async getAdminWallet(vendorId: string) {
    await this.requireVendorExists(vendorId);
    const wallet = await this.vendorFinanceRepository.ensureWallet(vendorId);

    return {
      message: 'Vendor wallet fetched successfully',
      data: this.toWalletResponse(wallet),
    };
  }

  async listTransactions(
    vendorProfileId: string,
    query: WalletTransactionsQueryDto,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    return this.listTransactionsForVendor(vendorProfileId, query);
  }

  async listAdminTransactions(
    vendorId: string,
    query: WalletTransactionsQueryDto,
  ) {
    await this.requireVendorExists(vendorId);
    return this.listTransactionsForVendor(vendorId, query);
  }

  async getBankAccount(vendorProfileId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const account =
      await this.vendorFinanceRepository.findBankAccount(vendorProfileId);

    return {
      message: 'Bank account fetched successfully',
      data: account,
    };
  }

  async createBankAccount(vendorProfileId: string, dto: CreateBankAccountDto) {
    await this.requireApprovedVendor(vendorProfileId);
    const existing =
      await this.vendorFinanceRepository.findBankAccount(vendorProfileId);
    if (existing) {
      throw new ConflictException(
        'Bank account already exists for this vendor',
      );
    }

    const account = await this.vendorFinanceRepository.createBankAccount(
      vendorProfileId,
      {
        accountHolderName: dto.accountHolderName,
        accountNumber: dto.accountNumber,
        ifscCode: dto.ifscCode.toUpperCase(),
        bankName: dto.bankName,
        branchName: dto.branchName,
      },
    );

    return {
      message: 'Bank account created successfully',
      data: account,
    };
  }

  async updateBankAccount(vendorProfileId: string, dto: UpdateBankAccountDto) {
    await this.requireApprovedVendor(vendorProfileId);
    const existing =
      await this.vendorFinanceRepository.findBankAccount(vendorProfileId);
    if (!existing) {
      throw new NotFoundException('Bank account not found');
    }

    const data: {
      accountHolderName?: string;
      accountNumber?: string;
      ifscCode?: string;
      bankName?: string;
      branchName?: string | null;
      isVerified?: boolean;
      verifiedAt?: Date | null;
    } = {};

    if (dto.accountHolderName !== undefined) {
      data.accountHolderName = dto.accountHolderName;
    }
    if (dto.accountNumber !== undefined) {
      data.accountNumber = dto.accountNumber;
    }
    if (dto.ifscCode !== undefined) {
      data.ifscCode = dto.ifscCode.toUpperCase();
    }
    if (dto.bankName !== undefined) {
      data.bankName = dto.bankName;
    }
    if (dto.branchName !== undefined) {
      data.branchName = dto.branchName;
    }

    const materialChange =
      (dto.accountHolderName !== undefined &&
        dto.accountHolderName !== existing.accountHolderName) ||
      (dto.accountNumber !== undefined &&
        dto.accountNumber !== existing.accountNumber) ||
      (dto.ifscCode !== undefined &&
        dto.ifscCode.toUpperCase() !== existing.ifscCode);

    if (existing.isVerified && materialChange) {
      data.isVerified = false;
      data.verifiedAt = null;
    }

    const account = await this.vendorFinanceRepository.updateBankAccount(
      vendorProfileId,
      data,
    );

    return {
      message: 'Bank account updated successfully',
      data: account,
    };
  }

  async deleteBankAccount(vendorProfileId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const existing =
      await this.vendorFinanceRepository.findBankAccount(vendorProfileId);
    if (!existing) {
      throw new NotFoundException('Bank account not found');
    }

    const activePayouts =
      await this.vendorFinanceRepository.countActivePayouts(vendorProfileId);
    if (activePayouts > 0) {
      throw new BadRequestException(
        'Cannot delete bank account while payouts are pending or processing',
      );
    }

    await this.vendorFinanceRepository.deleteBankAccount(vendorProfileId);

    return {
      message: 'Bank account deleted successfully',
      data: null,
    };
  }

  async verifyBankAccount(vendorId: string) {
    await this.requireVendorExists(vendorId);
    const existing =
      await this.vendorFinanceRepository.findBankAccount(vendorId);
    if (!existing) {
      throw new NotFoundException('Bank account not found');
    }

    const account =
      await this.vendorFinanceRepository.verifyBankAccount(vendorId);

    return {
      message: 'Bank account verified successfully',
      data: account,
    };
  }

  async listVendorPayouts(vendorProfileId: string, query: ListPayoutsQueryDto) {
    await this.requireApprovedVendor(vendorProfileId);
    return this.listPayouts({
      vendorId: vendorProfileId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  async listAdminPayouts(query: AdminListPayoutsQueryDto) {
    return this.listPayouts({
      vendorId: query.vendorId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  async getVendorPayout(vendorProfileId: string, payoutId: string) {
    await this.requireApprovedVendor(vendorProfileId);
    const payout = await this.vendorFinanceRepository.findPayoutForVendor(
      payoutId,
      vendorProfileId,
    );
    if (!payout) {
      throw new NotFoundException('Payout not found');
    }

    return {
      message: 'Payout fetched successfully',
      data: payout,
    };
  }

  async requestPayout(vendorProfileId: string, dto: RequestPayoutDto) {
    await this.requireApprovedVendor(vendorProfileId);

    if (dto.amount < MIN_PAYOUT_AMOUNT) {
      throw new BadRequestException(
        `Minimum payout amount is ₹${MIN_PAYOUT_AMOUNT}`,
      );
    }

    const bank =
      await this.vendorFinanceRepository.findBankAccount(vendorProfileId);
    if (!bank) {
      throw new BadRequestException('Bank account is required before payout');
    }
    if (!bank.isVerified) {
      throw new BadRequestException(
        'Bank account must be verified before requesting a payout',
      );
    }

    const wallet =
      await this.vendorFinanceRepository.ensureWallet(vendorProfileId);
    const amount = new Prisma.Decimal(dto.amount);

    if (wallet.balance.lessThan(amount)) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const active =
      await this.vendorFinanceRepository.countActivePayouts(vendorProfileId);
    if (active > 0) {
      throw new ConflictException('A payout is already pending or processing');
    }

    const payout = await this.vendorFinanceRepository.requestPayout({
      vendorId: vendorProfileId,
      walletId: wallet.id,
      bankAccountId: bank.id,
      amount,
    });

    return {
      message: 'Payout requested successfully',
      data: payout,
    };
  }

  async processPayout(payoutId: string) {
    const payout = await this.vendorFinanceRepository.findPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException('Payout not found');
    }
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Only PENDING payouts can be processed');
    }

    const updated =
      await this.vendorFinanceRepository.markPayoutProcessing(payoutId);

    return {
      message: 'Payout marked as processing',
      data: updated,
    };
  }

  async completePayout(payoutId: string, dto: CompletePayoutDto) {
    const payout = await this.vendorFinanceRepository.findPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException('Payout not found');
    }
    if (payout.status !== PayoutStatus.PROCESSING) {
      throw new BadRequestException('Only PROCESSING payouts can be completed');
    }

    const updated = await this.vendorFinanceRepository.completePayout({
      payoutId,
      vendorId: payout.vendorId,
      walletId: payout.walletId,
      amount: payout.amount,
      razorpayPayoutId: dto.razorpayPayoutId,
    });

    return {
      message: 'Payout completed successfully',
      data: updated,
    };
  }

  async failPayout(payoutId: string, dto: FailPayoutDto) {
    const payout = await this.vendorFinanceRepository.findPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException('Payout not found');
    }
    if (
      payout.status !== PayoutStatus.PENDING &&
      payout.status !== PayoutStatus.PROCESSING
    ) {
      throw new BadRequestException(
        'Only PENDING or PROCESSING payouts can be failed',
      );
    }

    const updated = await this.vendorFinanceRepository.failPayout({
      payoutId,
      vendorId: payout.vendorId,
      walletId: payout.walletId,
      amount: payout.amount,
      failureReason: dto.failureReason,
      allowedFrom: [PayoutStatus.PENDING, PayoutStatus.PROCESSING],
    });

    return {
      message: 'Payout marked as failed',
      data: updated,
    };
  }

  private async listPayouts(filters: {
    vendorId?: string;
    status?: PayoutStatus;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const { skip, take } = paginate(page, limit);
    const { items, total } = await this.vendorFinanceRepository.findPayouts({
      vendorId: filters.vendorId,
      status: filters.status,
      skip,
      take,
    });

    return {
      message: 'Payouts fetched successfully',
      data: items,
      meta: paginationMeta(page, limit, total),
    };
  }

  private async listTransactionsForVendor(
    vendorId: string,
    query: WalletTransactionsQueryDto,
  ) {
    await this.vendorFinanceRepository.ensureWallet(vendorId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = paginate(page, limit);
    const { items, total } =
      await this.vendorFinanceRepository.findTransactions(vendorId, {
        skip,
        take,
        type: query.type,
        reason: query.reason,
      });

    return {
      message: 'Wallet transactions fetched successfully',
      data: items,
      meta: paginationMeta(page, limit, total),
    };
  }

  private toWalletResponse(wallet: {
    id: string;
    vendorId: string;
    balance: unknown;
    lockedBalance: unknown;
    totalEarned: unknown;
    totalWithdrawn: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...wallet,
      // Available for payouts = balance (locked is held separately)
      availableBalance: wallet.balance,
    };
  }

  private async requireApprovedVendor(vendorProfileId: string) {
    const vendor =
      await this.vendorFinanceRepository.findApprovedVendorById(
        vendorProfileId,
      );
    if (!vendor) {
      throw new ForbiddenException('Approved vendor profile required');
    }
    return vendor.id;
  }

  private async requireVendorExists(vendorId: string) {
    const vendor = await this.vendorFinanceRepository.findVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }
    return vendor.id;
  }
}
