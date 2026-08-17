import {
  PlatformSettingValueType,
  Prisma,
} from '../../../generated/prisma/client.js';

export type PlatformSettingDefinition = {
  namespace: string;
  key: string;
  valueType: PlatformSettingValueType;
  label: string;
  description: string;
  defaultValue: Prisma.InputJsonValue;
  isEditable: boolean;
  isPublic: boolean;
};

export const PLATFORM_SETTING_DEFINITIONS = [
  {
    namespace: 'finance',
    key: 'minPayoutAmount',
    valueType: PlatformSettingValueType.DECIMAL_STRING,
    label: 'Minimum payout amount',
    description: 'Minimum vendor payout request amount in INR.',
    defaultValue: '100.00',
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'finance',
    key: 'payoutsEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'Payouts enabled',
    description: 'Controls whether vendors can request payouts.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'finance',
    key: 'defaultCommissionRate',
    valueType: PlatformSettingValueType.DECIMAL_STRING,
    label: 'Default commission rate',
    description:
      'Default platform commission rate for vendors without an override.',
    defaultValue: '0.1000',
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'commerce',
    key: 'onlinePaymentTimeoutMinutes',
    valueType: PlatformSettingValueType.NUMBER,
    label: 'Online payment timeout minutes',
    description:
      'Minutes before unpaid online orders are cancelled and restocked.',
    defaultValue: 30,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'commerce',
    key: 'customerCancelUntilStatus',
    valueType: PlatformSettingValueType.STRING,
    label: 'Customer cancel cutoff status',
    description:
      'Latest sub-order status before customer cancellation is blocked.',
    defaultValue: 'SHIPPED',
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'commerce',
    key: 'vendorCancelUntilStatus',
    valueType: PlatformSettingValueType.STRING,
    label: 'Vendor cancel cutoff status',
    description:
      'Latest sub-order status before vendor cancellation is blocked.',
    defaultValue: 'SHIPPED',
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'commerce',
    key: 'codEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'COD enabled',
    description:
      'Controls whether customers can place cash-on-delivery orders.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'commerce',
    key: 'returnsEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'Returns enabled',
    description: 'Controls customer return/RMA features. Disabled for launch.',
    defaultValue: false,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'notifications',
    key: 'fcmEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'FCM notifications enabled',
    description: 'Controls push notification delivery.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'notifications',
    key: 'smsEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'SMS notifications enabled',
    description: 'Controls SMS notification delivery.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'notifications',
    key: 'emailEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'Email notifications enabled',
    description: 'Controls email notification delivery.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'notifications',
    key: 'eventToggles',
    valueType: PlatformSettingValueType.JSON,
    label: 'Notification event toggles',
    description: 'Per-event notification enable flags.',
    defaultValue: {
      order: true,
      product: true,
      kyc: true,
      payout: true,
      coupon: true,
      bulkUpload: true,
    },
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'security',
    key: 'cartMutationLimitPerMinute',
    valueType: PlatformSettingValueType.NUMBER,
    label: 'Cart mutation limit per minute',
    description: 'Per-IP rate limit for cart mutation endpoints.',
    defaultValue: 30,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'security',
    key: 'checkoutLimitPerMinute',
    valueType: PlatformSettingValueType.NUMBER,
    label: 'Checkout limit per minute',
    description: 'Per-IP rate limit for checkout endpoint.',
    defaultValue: 10,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'security',
    key: 'paymentVerifyLimitPerMinute',
    valueType: PlatformSettingValueType.NUMBER,
    label: 'Payment verify limit per minute',
    description: 'Per-IP rate limit for payment verification endpoint.',
    defaultValue: 10,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'security',
    key: 'productBrowseLimitPerMinute',
    valueType: PlatformSettingValueType.NUMBER,
    label: 'Product browse limit per minute',
    description: 'Per-IP rate limit for public product browsing.',
    defaultValue: 60,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'vendor',
    key: 'requiredKycDocuments',
    valueType: PlatformSettingValueType.STRING_ARRAY,
    label: 'Required KYC documents',
    description: 'KYC documents that must be verified before vendor approval.',
    defaultValue: ['AADHAAR', 'PAN', 'GST'],
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'vendor',
    key: 'autoApproveAfterRequiredDocsVerified',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'Auto-approve vendor after KYC verification',
    description:
      'Automatically approves vendor once all required KYC docs are verified.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'coupons',
    key: 'platformCouponsEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'Platform coupons enabled',
    description: 'Controls admin-created full-cart coupons.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'coupons',
    key: 'vendorCouponsEnabled',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'Vendor coupons enabled',
    description: 'Controls vendor-created coupons scoped to vendor products.',
    defaultValue: true,
    isEditable: true,
    isPublic: false,
  },
  {
    namespace: 'coupons',
    key: 'allowStacking',
    valueType: PlatformSettingValueType.BOOLEAN,
    label: 'Coupon stacking enabled',
    description: 'Controls whether multiple coupons can be applied together.',
    defaultValue: false,
    isEditable: true,
    isPublic: false,
  },
] satisfies PlatformSettingDefinition[];

export function findPlatformSettingDefinition(namespace: string, key: string) {
  return PLATFORM_SETTING_DEFINITIONS.find(
    (definition) =>
      definition.namespace === namespace && definition.key === key,
  );
}
