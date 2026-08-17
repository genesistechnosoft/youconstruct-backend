import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { domainBadRequest } from '../../common/errors/domain-exception';
import { OrdersService } from '../orders/orders.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RazorpayClient } from './razorpay.client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly razorpayClient: RazorpayClient,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    const valid = this.razorpayClient.verifyPaymentSignature({
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      razorpaySignature: dto.razorpaySignature,
    });
    if (!valid) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.PAYMENT_SIGNATURE_INVALID,
        'Invalid payment signature',
      );
    }

    const result = await this.ordersService.captureOnlinePayment({
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      expectedUserId: userId,
    });

    return {
      message: result.alreadyPaid
        ? 'Payment already captured'
        : 'Payment verified successfully',
      data: { order: result.order },
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!signature) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.PAYMENT_SIGNATURE_INVALID,
        'Missing webhook signature',
      );
    }

    const valid = this.razorpayClient.verifyWebhookSignature(
      rawBody,
      signature,
    );
    if (!valid) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.PAYMENT_SIGNATURE_INVALID,
        'Invalid webhook signature',
      );
    }

    let payload: {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            status?: string;
          };
        };
      };
    };

    try {
      payload = JSON.parse(rawBody.toString('utf8')) as typeof payload;
    } catch {
      throw new BadRequestException('Invalid webhook body');
    }

    const event = payload.event;
    const payment = payload.payload?.payment?.entity;

    if (
      event === 'payment.captured' &&
      payment?.order_id &&
      payment?.id &&
      payment.status === 'captured'
    ) {
      try {
        await this.ordersService.captureOnlinePayment({
          razorpayOrderId: payment.order_id,
          razorpayPaymentId: payment.id,
        });
      } catch (error) {
        this.logger.error(
          `Webhook capture failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        throw error;
      }
    }

    return {
      message: 'Webhook processed',
      data: { received: true },
    };
  }
}
