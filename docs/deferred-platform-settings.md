# Deferred Super Admin Platform Settings

## Purpose

Future Super Admin–owned platform knobs for commercial and checkout behavior.
Module 5 (Cart & Orders) hard-codes launch defaults in code/constants — no settings API yet.
When a later **Platform Settings** module (or Module 8+) is planned, start from this file.

## Suggested model

- `PlatformSetting` key-value store (or typed config rows)
- Admin API: `GET/PATCH /admin/settings`
- Scope: Super Admin only for sensitive commercial rules

## Module 5 hard-coded defaults

- Commission default `0.10` (with per-vendor `VendorProfile.commissionRate` override)
- Payment methods: both COD + ONLINE enabled
- Tax / GST: always `0`
- Wallet credit: ONLINE on payment CAPTURED; COD on SubOrder `DELIVERED`
- Payment timeout: 30 minutes

## Checklist — settings to implement later

| Key / setting              | Module 5 hard-coded value | Notes                                                              |
| -------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `defaultCommissionRate`    | `0.10`                    | Snapshot onto SubOrder; vendor override already on `VendorProfile` |
| `paymentMethodsEnabled`    | `COD`, `ONLINE`           | Toggle which methods checkout accepts                              |
| `taxEnabled` / GST rules   | off / `0`                 | Ship with tax module                                               |
| `walletCreditTimingOnline` | on payment CAPTURED       | Treat as accounting rule; change carefully                         |
| `walletCreditTimingCod`    | on SubOrder DELIVERED     | Refine with COD settlement                                         |
| `paymentTimeoutMinutes`    | `30`                      | Today env/constant is fine; admin UI optional                      |

## Explicit non-goals (early settings)

Do **not** make wallet credit timing casually toggleable without a migration/audit plan.
Flipping “credit on capture vs delivery” mid-flight is dangerous for accounting consistency.

## Discoverability

- Linked from Bruno `COVERAGE.md` (Module 5 section)
- Backlog starter for future Platform Settings module / Module 8+
)
