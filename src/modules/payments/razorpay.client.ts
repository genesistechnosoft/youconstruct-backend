import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import Razorpay from 'razorpay';

@Injectable()
export class RazorpayClient implements OnModuleInit {
  private client!: Razorpay;
  private keyId!: string;
  private keySecret!: string;
  private webhookSecret!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.keyId = this.configService.getOrThrow<string>('RAZORPAY_KEY_ID');
    this.keySecret = this.configService.getOrThrow<string>(
      'RAZORPAY_KEY_SECRET',
    );
    this.webhookSecret = this.configService.getOrThrow<string>(
      'RAZORPAY_WEBHOOK_SECRET',
    );
    this.client = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret,
    });
  }

  getKeyId(): string {
    return this.keyId;
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }) {
    try {
      const order = await this.client.orders.create({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes,
      });
      return {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    } catch (error) {
      throw new Error(this.razorpayErrorMessage(error));
    }
  }

  async createRefund(input: {
    paymentId: string;
    amountPaise: number;
    notes?: Record<string, string>;
  }) {
    try {
      const refund = await this.client.payments.refund(input.paymentId, {
        amount: input.amountPaise,
        notes: input.notes,
      });
      return {
        id: String(refund.id),
        amount: Number(refund.amount),
        status: String(refund.status ?? ''),
        payload: refund as unknown as Record<string, unknown>,
      };
    } catch (error) {
      throw new Error(this.razorpayErrorMessage(error));
    }
  }

  private razorpayErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
      const body = error as {
        message?: string;
        description?: string;
        error?: { description?: string; reason?: string };
      };
      const description = body.error?.description ?? body.description;
      const reason = body.error?.reason;
      if (description && reason) {
        return `${description} (${reason})`;
      }
      if (description) {
        return description;
      }
      if (reason) {
        return reason;
      }
      if (body.message) {
        return body.message;
      }
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return 'Razorpay request failed';
  }

  verifyPaymentSignature(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): boolean {
    const body = `${input.razorpayOrderId}|${input.razorpayPaymentId}`;
    const expected = crypto
      .createHmac('sha256', this.keySecret)
      .update(body)
      .digest('hex');
    return expected === input.razorpaySignature;
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return expected === signature;
  }
}
