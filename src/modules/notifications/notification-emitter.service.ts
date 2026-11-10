import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SMS_SENDER,
  type SmsSender,
} from '../../common/sms/sms-sender.interface';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

type EventToggles = {
  order?: boolean;
  product?: boolean;
  kyc?: boolean;
  payout?: boolean;
  coupon?: boolean;
  bulkUpload?: boolean;
  returns?: boolean;
  professional?: boolean;
};

const ORDER_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.ORDER_PLACED,
  NotificationEventType.ORDER_PAID,
  NotificationEventType.ORDER_CANCELLED,
  NotificationEventType.ORDER_REFUNDED,
  NotificationEventType.ORDER_SHIPPED,
  NotificationEventType.ORDER_DELIVERED,
]);

const PRODUCT_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.PRODUCT_APPROVED,
  NotificationEventType.PRODUCT_REJECTED,
]);

const KYC_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.KYC_APPROVED,
  NotificationEventType.KYC_REJECTED,
]);

const PAYOUT_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.PAYOUT_PROCESSING,
  NotificationEventType.PAYOUT_COMPLETED,
  NotificationEventType.PAYOUT_FAILED,
]);

const COUPON_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.COUPON_CREATED,
]);

const BULK_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.BULK_UPLOAD_COMPLETED,
  NotificationEventType.BULK_UPLOAD_FAILED,
]);

const RETURN_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.RETURN_REQUESTED,
  NotificationEventType.RETURN_APPROVED,
  NotificationEventType.RETURN_REJECTED,
  NotificationEventType.RETURN_RECEIVED,
  NotificationEventType.RETURN_REFUNDED,
]);

const PROFESSIONAL_EVENTS = new Set<NotificationEventType>([
  NotificationEventType.PROFESSIONAL_APPROVED,
  NotificationEventType.PROFESSIONAL_REJECTED,
  NotificationEventType.PROFESSIONAL_SUSPENDED,
  NotificationEventType.PROFESSIONAL_REINSTATED,
  NotificationEventType.PROJECT_APPROVED,
  NotificationEventType.PROJECT_REJECTED,
  NotificationEventType.PROJECT_REMOVED,
]);

function isEventToggled(
  eventType: NotificationEventType,
  toggles: EventToggles,
): boolean {
  if (ORDER_EVENTS.has(eventType)) return toggles.order !== false;
  if (PRODUCT_EVENTS.has(eventType)) return toggles.product !== false;
  if (KYC_EVENTS.has(eventType)) return toggles.kyc !== false;
  if (PAYOUT_EVENTS.has(eventType)) return toggles.payout !== false;
  if (COUPON_EVENTS.has(eventType)) return toggles.coupon !== false;
  if (BULK_EVENTS.has(eventType)) return toggles.bulkUpload !== false;
  if (RETURN_EVENTS.has(eventType)) return toggles.returns !== false;
  if (PROFESSIONAL_EVENTS.has(eventType)) return toggles.professional !== false;
  return true;
}

@Injectable()
export class NotificationEmitterService {
  private readonly logger = new Logger(NotificationEmitterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
    @Inject(SMS_SENDER) private readonly smsSender: SmsSender,
  ) {}

  /**
   * Fire-and-forget notification row + channel delivery stubs.
   * Never throws to callers.
   */
  emit(input: {
    userId: string;
    eventType: NotificationEventType;
    title: string;
    body: string;
    data?: Prisma.InputJsonValue;
  }): void {
    void this.emitAwaited(input).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Notification emit failed: ${message}`);
    });
  }

  async emitAwaited(input: {
    userId: string;
    eventType: NotificationEventType;
    title: string;
    body: string;
    data?: Prisma.InputJsonValue;
  }) {
    const [fcmEnabled, smsEnabled, emailEnabled, eventTogglesRaw] =
      await Promise.all([
        this.platformSettings.getBoolean('notifications', 'fcmEnabled'),
        this.platformSettings.getBoolean('notifications', 'smsEnabled'),
        this.platformSettings.getBoolean('notifications', 'emailEnabled'),
        this.platformSettings
          .getValue('notifications', 'eventToggles')
          .catch(() => null),
      ]);

    const eventToggles =
      eventTogglesRaw && typeof eventTogglesRaw === 'object'
        ? (eventTogglesRaw as EventToggles)
        : ({} as EventToggles);

    if (!isEventToggled(input.eventType, eventToggles)) {
      this.logger.log(
        `notification_emit event=skip reason=event_toggle eventType=${input.eventType} userId=${input.userId}`,
      );
      return null;
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
        deliveries: {
          create: [
            {
              channel: NotificationChannel.IN_APP,
              status: NotificationDeliveryStatus.SENT,
              sentAt: new Date(),
            },
            {
              channel: NotificationChannel.FCM,
              status: fcmEnabled
                ? NotificationDeliveryStatus.PENDING
                : NotificationDeliveryStatus.SKIPPED,
            },
            {
              channel: NotificationChannel.SMS,
              status: smsEnabled
                ? NotificationDeliveryStatus.PENDING
                : NotificationDeliveryStatus.SKIPPED,
            },
            {
              channel: NotificationChannel.EMAIL,
              status: emailEnabled
                ? NotificationDeliveryStatus.PENDING
                : NotificationDeliveryStatus.SKIPPED,
            },
          ],
        },
      },
      select: { id: true },
    });

    this.logger.log(
      `notification_emit event=created id=${notification.id} eventType=${input.eventType} userId=${input.userId} channels=in_app:SENT,fcm:${fcmEnabled ? 'PENDING' : 'SKIPPED'},sms:${smsEnabled ? 'PENDING' : 'SKIPPED'},email:${emailEnabled ? 'PENDING' : 'SKIPPED'}`,
    );

    if (smsEnabled) {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { phone: true },
      });
      if (user?.phone) {
        try {
          await this.smsSender.send({
            to: user.phone,
            body: `${input.title}: ${input.body}`,
          });
          await this.prisma.notificationDelivery.updateMany({
            where: {
              notificationId: notification.id,
              channel: NotificationChannel.SMS,
            },
            data: {
              status: NotificationDeliveryStatus.SENT,
              sentAt: new Date(),
            },
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'unknown';
          this.logger.error(`Notification SMS send failed: ${message}`);
          await this.prisma.notificationDelivery.updateMany({
            where: {
              notificationId: notification.id,
              channel: NotificationChannel.SMS,
            },
            data: { status: NotificationDeliveryStatus.FAILED },
          });
        }
      }
    }

    return notification;
  }
}
