import { Injectable } from '@nestjs/common';
import {
  BudgetRange,
  BulkProductUploadRowStatus,
  BulkProductUploadStatus,
  CouponDiscountType,
  CouponScope,
  CouponStatus,
  DeliveryStatus,
  KycDocumentType,
  KycStatus,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationEventType,
  FulfillmentStage,
  OrderRefundStatus,
  PaymentMethod,
  PaymentStatus,
  PayoutOrigin,
  PayoutStatus,
  PlatformRole,
  ProductStatus,
  ProfessionalContentStatus,
  ProfessionalOnboardingStatus,
  RestockStatus,
  ReturnReasonCode,
  ReturnStatus,
  ShippingMethodType,
  ShippingUnitType,
  SubOrderStatus,
  VendorOnboardingStatus,
} from '../../../generated/prisma/client.js';
import {
  ADMIN_DELIVERY_TRANSITIONS,
  ADMIN_SUB_ORDER_TRANSITIONS,
  VENDOR_DELIVERY_TRANSITIONS,
  VENDOR_SUB_ORDER_TRANSITIONS,
} from '../orders/order-status.util';
import {
  PROFESSIONAL_ONBOARDING_TRANSITIONS,
  PROFESSIONAL_CONTENT_TRANSITIONS,
} from '../professionals/professional-status.util';
import { PERMISSION_CATALOG } from '../rbac/permissions.constants';

@Injectable()
export class MetaService {
  getEnums() {
    return {
      message: 'Metadata fetched successfully',
      data: {
        enums: {
          bulkProductUploadRowStatus: this.options(BulkProductUploadRowStatus),
          bulkProductUploadStatus: this.options(BulkProductUploadStatus),
          couponDiscountType: this.options(CouponDiscountType),
          couponScope: this.options(CouponScope),
          couponStatus: this.options(CouponStatus),
          deliveryStatus: this.options(DeliveryStatus),
          kycDocumentType: this.options(KycDocumentType),
          kycStatus: this.options(KycStatus),
          notificationChannel: this.options(NotificationChannel),
          notificationDeliveryStatus: this.options(NotificationDeliveryStatus),
          notificationEventType: this.options(NotificationEventType),
          orderRefundStatus: this.options(OrderRefundStatus),
          fulfillmentStage: this.options(FulfillmentStage),
          paymentMethod: this.options(PaymentMethod),
          paymentStatus: this.options(PaymentStatus),
          payoutOrigin: this.options(PayoutOrigin),
          payoutStatus: this.options(PayoutStatus),
          platformRole: this.options(PlatformRole),
          productStatus: this.options(ProductStatus),
          restockStatus: this.options(RestockStatus),
          returnReasonCode: this.options(ReturnReasonCode),
          returnStatus: this.options(ReturnStatus),
          shippingMethodType: this.options(ShippingMethodType),
          shippingUnitType: this.options(ShippingUnitType),
          subOrderStatus: this.options(SubOrderStatus),
          vendorOnboardingStatus: this.options(VendorOnboardingStatus),
          professionalOnboardingStatus: this.options(
            ProfessionalOnboardingStatus,
          ),
          professionalContentStatus: this.options(ProfessionalContentStatus),
          budgetRange: this.options(BudgetRange),
        },
        transitions: {
          vendorSubOrder: VENDOR_SUB_ORDER_TRANSITIONS,
          adminSubOrder: ADMIN_SUB_ORDER_TRANSITIONS,
          vendorDelivery: VENDOR_DELIVERY_TRANSITIONS,
          adminDelivery: ADMIN_DELIVERY_TRANSITIONS,
          professionalOnboarding: PROFESSIONAL_ONBOARDING_TRANSITIONS,
          professionalContent: PROFESSIONAL_CONTENT_TRANSITIONS,
        },
        permissions: PERMISSION_CATALOG.map((entry) => ({
          value: entry.key,
          label: entry.name,
          scope: entry.scope,
          group: entry.group,
        })),
      },
    };
  }

  private options(source: Record<string, string>) {
    return Object.values(source).map((value) => ({
      value,
      label: this.toLabel(value),
    }));
  }

  private toLabel(value: string) {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
