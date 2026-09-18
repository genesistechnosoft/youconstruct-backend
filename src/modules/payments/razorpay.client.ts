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
      const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
      if (nodeEnv === 'production') {
        throw error;
      }
      return {
        id: `order_test_${input.receipt}`,
        amount: input.amountPaise,
        currency: 'INR',
      };
    }
  }

  async createRefund(input: {
    paymentId: string;
    amountPaise: number;
    notes?: Record<string, string>;
  }) {
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
