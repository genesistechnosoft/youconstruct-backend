import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationEventType,
  PayoutStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { formatMoney } from '../../common/utils/money.util';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { AuthService } from '../auth/auth.service';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SecurityAuditService } from '../rbac/security-audit.service';
import { AdminListPayoutsQueryDto } from './dto/admin-list-payouts-query.dto';
import { CompletePayoutDto } from './dto/complete-payout.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { FailPayoutDto } from './dto/fail-payout.dto';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { VendorFinanceRepository } from './vendor-finance.repository';

type DecimalInput = Prisma.Decimal | string | number;

@Injectable()
export class VendorFinanceService {
  constructor(
    private readonly vendorFinanceRepository: VendorFinanceRepository,
    private readonly authService: AuthService,
    private readonly securityAudit: SecurityAuditService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly notifications: NotificationEmitterService,
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
      data: account ? this.toBankAccountResponse(account) : null,
    };
  }

  async createBankAccount(
    userId: string,
    vendorProfileId: string,
    dto: CreateBankAccountDto,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    this.authService.verifyStepUpToken(
      userId,
      'BANK_ACCOUNT_CHANGE',
      dto.stepUpToken,
    );
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
    if (!account) {
      throw new ConflictException('Bank account could not be saved');
    }

    return {
      message: 'Bank account created successfully',
      data: this.toBankAccountResponse(account),
    };
  }

  async updateBankAccount(
    userId: string,
    vendorProfileId: string,
    dto: UpdateBankAccountDto,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    this.authService.verifyStepUpToken(
      userId,
      'BANK_ACCOUNT_CHANGE',
      dto.stepUpToken,
    );
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
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    return {
      message: 'Bank account updated successfully',
      data: this.toBankAccountResponse(account),
    };
  }

  async deleteBankAccount(
    userId: string,
    vendorProfileId: string,
    stepUpToken: string,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    this.authService.verifyStepUpToken(
      userId,
      'BANK_ACCOUNT_CHANGE',
      stepUpToken,
    );
    const existing =
      await this.vendorFinanceRepository.findBankAccount(vendorProfileId);
    if (!existing) {
      throw new NotFoundException('Bank account not found');
    }

    const activePayouts =
      await this.vendorFinanceRepository.countActivePayouts(vendorProfileId);
    if (activePayouts > 0) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.BANK_ACCOUNT_UNVERIFIED,
        'Cannot delete bank account while payouts are pending or processing',
      );
    }

    await this.vendorFinanceRepository.deleteBankAccount(vendorProfileId);

    return {
      message: 'Bank account deleted successfully',
      data: null,
    };
  }

  async verifyBankAccount(vendorId: string, actorUserId: string) {
    await this.requireVendorExists(vendorId);
    const existing =
      await this.vendorFinanceRepository.findBankAccount(vendorId);
    if (!existing) {
      throw new NotFoundException('Bank account not found');
    }

    const account =
      await this.vendorFinanceRepository.verifyBankAccount(vendorId);
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }
    this.securityAudit.log({
      actorUserId,
      action: 'BANK_ACCOUNT_VERIFY',
      result: 'SUCCESS',
      targetType: 'vendorProfile',
      targetId: vendorId,
      metadata: {
        bankAccountId: account.id,
        accountNumber: this.maskAccountNumber(account.accountNumber),
      },
    });

    return {
      message: 'Bank account verified successfully',
      data: this.toBankAccountResponse(account),
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
      data: this.serializePayout(payout),
    };
  }

  async requestPayout(
    userId: string,
    vendorProfileId: string,
    dto: RequestPayoutDto,
  ) {
    await this.requireApprovedVendor(vendorProfileId);
    this.authService.verifyStepUpToken(
      userId,
      'PAYOUT_REQUEST',
      dto.stepUpToken,
    );

    const payoutsEnabled = await this.platformSettings.getBoolean(
      'finance',
      'payoutsEnabled',
    );
    if (!payoutsEnabled) {
      throw new BadRequestException('Payouts are currently disabled');
    }

    const minPayoutAmount = await this.platformSettings.getNumber(
      'finance',
      'minPayoutAmount',
    );
    if (dto.amount < minPayoutAmount) {
      throw new BadRequestException(
        `Minimum payout amount is ₹${minPayoutAmount}`,
      );
    }

    const bank =
      await this.vendorFinanceRepository.findBankAccount(vendorProfileId);
    if (!bank) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.BANK_ACCOUNT_UNVERIFIED,
        'Bank account is required before payout',
      );
    }
    if (!bank.isVerified) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.BANK_ACCOUNT_UNVERIFIED,
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
      data: this.serializePayout(payout),
    };
  }

  async processPayout(payoutId: string, actorUserId: string) {
    const payout = await this.vendorFinanceRepository.findPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException('Payout not found');
    }
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Only PENDING payouts can be processed');
    }

    const updated =
      await this.vendorFinanceRepository.markPayoutProcessing(payoutId);
    this.securityAudit.log({
      actorUserId,
      action: 'PAYOUT_PROCESS',
      result: 'SUCCESS',
      targetType: 'vendorPayout',
      targetId: payoutId,
      metadata: { vendorId: payout.vendorId },
    });
    await this.emitPayoutNotification(
      payout.vendorId,
      NotificationEventType.PAYOUT_PROCESSING,
      'Payout processing',
      'Your payout request is being processed',
      payoutId,
    );

    return {
      message: 'Payout marked as processing',
      data: this.serializePayout(updated),
    };
  }

  async completePayout(
    payoutId: string,
    actorUserId: string,
    dto: CompletePayoutDto,
  ) {
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
    this.securityAudit.log({
      actorUserId,
      action: 'PAYOUT_COMPLETE',
      result: 'SUCCESS',
      targetType: 'vendorPayout',
      targetId: payoutId,
      metadata: { vendorId: payout.vendorId },
    });
    await this.emitPayoutNotification(
      payout.vendorId,
      NotificationEventType.PAYOUT_COMPLETED,
      'Payout completed',
      'Your payout has been completed',
      payoutId,
    );

    return {
      message: 'Payout completed successfully',
      data: this.serializePayout(updated),
    };
  }

  async failPayout(payoutId: string, actorUserId: string, dto: FailPayoutDto) {
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
    this.securityAudit.log({
      actorUserId,
      action: 'PAYOUT_FAIL',
      result: 'SUCCESS',
      targetType: 'vendorPayout',
      targetId: payoutId,
      metadata: {
        vendorId: payout.vendorId,
        reason: dto.failureReason,
      },
    });
    await this.emitPayoutNotification(
      payout.vendorId,
      NotificationEventType.PAYOUT_FAILED,
      'Payout failed',
      dto.failureReason,
      payoutId,
    );

    return {
      message: 'Payout marked as failed',
      data: this.serializePayout(updated),
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
      data: items.map((item) => this.serializePayout(item)),
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
      data: items.map((item) => this.serializeTransaction(item)),
      meta: paginationMeta(page, limit, total),
    };
  }

  private toWalletResponse(wallet: {
    id: string;
    vendorId: string;
    balance: DecimalInput;
    lockedBalance: DecimalInput;
    totalEarned: DecimalInput;
    totalWithdrawn: DecimalInput;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: wallet.id,
      vendorId: wallet.vendorId,
      balance: formatMoney(wallet.balance),
      lockedBalance: formatMoney(wallet.lockedBalance),
      totalEarned: formatMoney(wallet.totalEarned),
      totalWithdrawn: formatMoney(wallet.totalWithdrawn),
      availableBalance: formatMoney(wallet.balance),
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  private serializePayout(
    payout: {
      amount: DecimalInput;
      [key: string]: unknown;
    } | null,
  ) {
    if (!payout) {
      return null;
    }
    return {
      ...payout,
      amount: formatMoney(payout.amount),
    };
  }

  private serializeTransaction(tx: {
    amount: DecimalInput;
    balanceBefore: DecimalInput;
    balanceAfter: DecimalInput;
    [key: string]: unknown;
  }) {
    return {
      ...tx,
      amount: formatMoney(tx.amount),
      balanceBefore: formatMoney(tx.balanceBefore),
      balanceAfter: formatMoney(tx.balanceAfter),
    };
  }

  private async emitPayoutNotification(
    vendorId: string,
    eventType: NotificationEventType,
    title: string,
    body: string,
    payoutId: string,
  ) {
    const vendor = await this.vendorFinanceRepository.findVendorById(vendorId);
    if (!vendor?.userId) {
      return;
    }
    this.notifications.emit({
      userId: vendor.userId,
      eventType,
      title,
      body,
      data: { payoutId, vendorId },
    });
  }

  private toBankAccountResponse(account: {
    accountNumber: string;
    [key: string]: unknown;
  }) {
    return {
      ...account,
      accountNumber: this.maskAccountNumber(account.accountNumber),
    };
  }

  private maskAccountNumber(accountNumber: string) {
    const last4 = accountNumber.slice(-4);
    return `XXXX${last4}`;
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
