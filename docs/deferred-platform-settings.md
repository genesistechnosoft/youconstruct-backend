# Launch commerce platform settings

These knobs live in `platform_settings` (`commerce.*` / `finance.*` / `notifications.*`) and are editable by Super Admin except where marked.

## Commerce (launch contract)

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `commerce.platformFreightEnabled` | boolean | `true` | When ON, skip vendor methods and product shipping overrides. Charge `platformFreightAmount` once per vendor. Snapshot `{ source: "PLATFORM_FLAT", amount }`. |
| `commerce.platformFreightAmount` | decimal string | `"500.00"` | Flat freight per vendor while the toggle is ON. |
| `commerce.codAdvanceRate` | decimal string | `"0.5000"` | COD Razorpay amount = this rate × merchandise after discount/tax + 100% freight. COD is never zero-advance. |
| `commerce.customerCancelWindowHours` | number | `24` | Customer may cancel a sub-order until `min(order.createdAt + window, first delivery SHIPPED)`. |
| `commerce.returnWindowHours` | number | `48` | From that delivery's `deliveredAt`. Ignores product `isReturnable` / `returnWindowDays`. |
| `commerce.deliveryOtpTtlMinutes` | number | `10` | Hashed commerce OTP TTL (delivery + return receipt/offline refund). |
| `commerce.deliveryOtpMaxAttempts` | number | `5` | Lockout after this many failed verifies. |
| `commerce.returnsEnabled` | boolean | `true` | Gates the returns module. |
| `commerce.codEnabled` | boolean | `true` | Checkout COD method. |
| `commerce.onlinePaymentTimeoutMinutes` | number | `30` | Unpaid COD-advance and ONLINE orders restock the same way. |

`customerCancelUntilStatus` / `vendorCancelUntilStatus` are **not** used for launch cancel rules.

## Wallet and payouts

- Wallet credits only after OTP-confirmed or admin-overridden **delivery** (append-only `vendor_transactions`). Not on Razorpay capture.
- Payouts: vendor `POST /vendor/payouts` (step-up `PAYOUT_REQUEST`) and admin `POST /admin/payouts`. Complete with `payoutMethod` + `referenceUtr` (`razorpayPayoutId` optional).
- `finance.payoutsEnabled` / `finance.minPayoutAmount` still apply (`PAYOUT_DISABLED` when off).

## Notifications

When `notifications.smsEnabled` is true, in-app events also send SMS via the Twilio `SmsSender`. Delivery/return OTPs always go through that sender regardless of the event toggle.

## Discoverability

- Admin API: `GET/PATCH /admin/settings`
- Bruno `COVERAGE.md` (cart/orders/returns/payouts)
