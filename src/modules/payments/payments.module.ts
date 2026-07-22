import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PAYMENT_TIMEOUT_QUEUE } from '../../queue/queue.constants';
import { PaymentTimeoutProcessor } from '../../queue/processors/payment-timeout.processor';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayClient } from './razorpay.client';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
    BullModule.registerQueue({ name: PAYMENT_TIMEOUT_QUEUE }),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayClient, PaymentTimeoutProcessor],
  exports: [RazorpayClient, PaymentsService],
})
export class PaymentsModule {}
