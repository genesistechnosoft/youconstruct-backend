import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { OrdersService } from '../../modules/orders/orders.service';
import { PAYMENT_TIMEOUT_QUEUE } from '../queue.constants';

interface PaymentTimeoutJobData {
  orderId: string;
}

@Processor(PAYMENT_TIMEOUT_QUEUE)
export class PaymentTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentTimeoutProcessor.name);

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {
    super();
  }

  async process(job: Job<PaymentTimeoutJobData>) {
    const { orderId } = job.data;
    try {
      await this.ordersService.handlePaymentTimeout(orderId);
      this.logger.log(`Payment timeout handled for order ${orderId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Payment timeout failed for order ${orderId}: ${message}`,
      );
      throw error;
    }
  }
}
