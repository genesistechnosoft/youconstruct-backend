import { Prisma, ProductStatus } from '../../../generated/prisma/client.js';
import type { DomainErrorDetail } from '../../common/errors/domain-exception';

export const MAX_VARIANTS_PER_PRODUCT = 50;

export type BulkFieldError = DomainErrorDetail & {
  path: string;
  code: string;
  message: string;
};

export type VariantAttributeInput = {
  attributeId: string;
  value: string;
};

export type VariantInventoryInput = {
  quantity: number;
  lowStockThreshold?: number;
  allowBackorder?: boolean;
};

export type IncomingVariant = {
  id?: string;
  clientKey?: string;
  sku: string;
  name?: string | null;
  price: number;
  sellingPrice: number;
  costPrice?: number | null;
  primaryUnitId: string;
  coverageArea?: number | null;
  baseUnitId?: string | null;
  weightKg?: number | null;
  isDefault?: boolean;
  isActive?: boolean;
  attributes: VariantAttributeInput[];
  inventory?: VariantInventoryInput;
};

export type ExistingVariantSnapshot = {
  id: string;
  sku: string;
  name: string | null;
  price: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  costPrice: Prisma.Decimal | null;
  primaryUnitId: string;
  coverageArea: number | null;
  baseUnitId: string | null;
  weightKg: number | null;
  isDefault: boolean;
  isActive: boolean;
  attributes: VariantAttributeInput[];
  inventory: {
    quantity: number;
    lowStockThreshold: number;
    allowBackorder: boolean;
  } | null;
};

export type PlannedVariantWrite = {
  existingId?: string;
  clientKey?: string;
  sku: string;
  name: string | null;
  price: number;
  sellingPrice: number;
  costPrice: number | null;
  primaryUnitId: string;
  coverageArea: number | null;
  baseUnitId: string | null;
  weightKg: number | null;
  isDefault: boolean;
  isActive: boolean;
  attributes: VariantAttributeInput[];
  inventory: VariantInventoryInput | null;
};

export type PlannedRemoval = {
  id: string;
  sku: string;
  mode: 'delete' | 'deactivate';
};

export type VariantReplacePlan = {
  errors: BulkFieldError[];
  removed: { deleted: string[]; deactivated: string[] };
  review: { live: string[]; pendingReview: string[] };
  requiresInventoryPermission: boolean;
  writes: PlannedVariantWrite[];
  removals: PlannedRemoval[];
  markPendingContentReview: boolean;
};

type NormalizedIncoming = IncomingVariant & {
  index: number;
  isActive: boolean;
  isDefault: boolean;
  name: string | null;
  costPrice: number | null;
  coverageArea: number | null;
  baseUnitId: string | null;
  weightKg: number | null;
};

function refKey(variant: { id?: string; clientKey?: string }) {
  return variant.id ?? variant.clientKey ?? 'variant';
}

function sameMoney(current: Prisma.Decimal | null, next: number | null) {
  if (current === null || next === null) {
    return current === null && next === null;
  }

  return current.equals(new Prisma.Decimal(next));
}

function sameAttributes(
  current: VariantAttributeInput[],
  next: VariantAttributeInput[],
) {
  if (current.length !== next.length) {
    return false;
  }

  const sorted = (rows: VariantAttributeInput[]) =>
    [...rows].sort((left, right) =>
      left.attributeId.localeCompare(right.attributeId),
    );

  const left = sorted(current);
  const right = sorted(next);
  return left.every(
    (row, index) =>
      row.attributeId === right[index]?.attributeId &&
      row.value === right[index]?.value,
  );
}

function inventoryChanged(
  existing: ExistingVariantSnapshot | undefined,
  incoming: IncomingVariant,
) {
  if (!incoming.inventory) {
    return false;
  }

  if (!existing) {
    return true;
  }

  const current = existing.inventory ?? {
    quantity: 0,
    lowStockThreshold: 5,
    allowBackorder: false,
  };
  const nextThreshold =
    incoming.inventory.lowStockThreshold ?? current.lowStockThreshold;
  const nextBackorder =
    incoming.inventory.allowBackorder ?? current.allowBackorder;

  return (
    incoming.inventory.quantity !== current.quantity ||
    nextThreshold !== current.lowStockThreshold ||
    nextBackorder !== current.allowBackorder
  );
}

export function planVariantReplace(input: {
  status: ProductStatus;
  incoming: IncomingVariant[];
  existing: ExistingVariantSnapshot[];
  variantIdsWithOrders: string[];
  conflictingSkus: string[];
}): VariantReplacePlan {
  const errors: BulkFieldError[] = [];
  const existingById = new Map(
    input.existing.map((variant) => [variant.id, variant]),
  );
  const seenIds = new Set<string>();
  const seenClientKeys = new Set<string>();

  const normalized: NormalizedIncoming[] = input.incoming.map(
    (variant, index) => {
      const hasId = variant.id !== undefined;
      const hasClientKey =
        variant.clientKey !== undefined && variant.clientKey !== '';
      if (hasId === hasClientKey) {
        errors.push({
          path: `variants[${index}]`,
          ...(variant.id ? { id: variant.id } : {}),
          ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
          code: 'VARIANT_IDENTITY',
          message: 'Send either id or clientKey',
        });
      }

      if (variant.id) {
        if (seenIds.has(variant.id)) {
          errors.push({
            path: `variants[${index}].id`,
            id: variant.id,
            code: 'DUPLICATE_VARIANT',
            message: 'Variant id is repeated',
          });
        }
        seenIds.add(variant.id);
        if (!existingById.has(variant.id)) {
          errors.push({
            path: `variants[${index}]`,
            id: variant.id,
            code: 'VARIANT_NOT_FOUND',
            message: 'Variant not found',
          });
        }
      }

      if (variant.clientKey) {
        if (seenClientKeys.has(variant.clientKey)) {
          errors.push({
            path: `variants[${index}].clientKey`,
            clientKey: variant.clientKey,
            code: 'DUPLICATE_CLIENT_KEY',
            message: 'clientKey is repeated',
          });
        }
        seenClientKeys.add(variant.clientKey);
      }

      const attributeIds = new Set<string>();
      variant.attributes.forEach((attribute, attributeIndex) => {
        if (attributeIds.has(attribute.attributeId)) {
          errors.push({
            path: `variants[${index}].attributes[${attributeIndex}].attributeId`,
            ...(variant.id ? { id: variant.id } : {}),
            ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
            code: 'DUPLICATE_ATTRIBUTE',
            message: 'Duplicate attribute IDs are not allowed',
          });
        }
        attributeIds.add(attribute.attributeId);
      });

      if (variant.sellingPrice > variant.price) {
        errors.push({
          path: `variants[${index}].sellingPrice`,
          ...(variant.id ? { id: variant.id } : {}),
          ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
          code: 'SELLING_PRICE_EXCEEDS',
          message: 'Selling price cannot exceed price',
        });
      }

      if (
        variant.costPrice !== undefined &&
        variant.costPrice !== null &&
        variant.costPrice > variant.price
      ) {
        errors.push({
          path: `variants[${index}].costPrice`,
          ...(variant.id ? { id: variant.id } : {}),
          ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
          code: 'COST_PRICE_EXCEEDS',
          message: 'Cost price cannot exceed price',
        });
      }

      const coverageArea = variant.coverageArea ?? null;
      const baseUnitId = variant.baseUnitId ?? null;
      if (coverageArea !== null && coverageArea <= 0) {
        errors.push({
          path: `variants[${index}].coverageArea`,
          ...(variant.id ? { id: variant.id } : {}),
          ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
          code: 'COVERAGE_INVALID',
          message: 'Coverage area must be greater than 0',
        });
      }
      if (coverageArea !== null && coverageArea > 0 && !baseUnitId) {
        errors.push({
          path: `variants[${index}].baseUnitId`,
          ...(variant.id ? { id: variant.id } : {}),
          ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
          code: 'BASE_UNIT_REQUIRED',
          message: 'Base unit is required with coverage area',
        });
      }

      return {
        ...variant,
        index,
        isActive: variant.isActive ?? true,
        isDefault: variant.isDefault ?? false,
        name: variant.name ?? null,
        costPrice: variant.costPrice ?? null,
        coverageArea,
        baseUnitId,
        weightKg: variant.weightKg ?? null,
      };
    },
  );

  const orderIds = new Set(input.variantIdsWithOrders);
  const removals: PlannedRemoval[] = [];
  for (const variant of input.existing) {
    if (seenIds.has(variant.id)) {
      continue;
    }

    const mustDeactivate =
      input.status === ProductStatus.ACTIVE || orderIds.has(variant.id);
    removals.push({
      id: variant.id,
      sku: variant.sku,
      mode: mustDeactivate ? 'deactivate' : 'delete',
    });
  }

  const removed = {
    deleted: removals
      .filter((removal) => removal.mode === 'delete')
      .map((removal) => removal.id),
    deactivated: removals
      .filter((removal) => removal.mode === 'deactivate')
      .map((removal) => removal.id),
  };

  const finalCount = normalized.length + removed.deactivated.length;
  if (finalCount > MAX_VARIANTS_PER_PRODUCT) {
    errors.push({
      path: 'variants',
      code: 'VARIANT_LIMIT',
      message: `A product can have at most ${MAX_VARIANTS_PER_PRODUCT} variants`,
    });
  }

  const active = normalized.filter((variant) => variant.isActive);
  if (active.length === 0) {
    errors.push({
      path: 'variants',
      code: 'ACTIVE_VARIANT_REQUIRED',
      message: 'Product must have at least one active variant',
    });
  } else if (active.length === 1) {
    const onlyActive = active[0];
    for (const variant of normalized) {
      variant.isDefault = variant.index === onlyActive?.index;
    }
  } else {
    const defaults = active.filter((variant) => variant.isDefault);
    if (defaults.length !== 1) {
      errors.push({
        path: 'variants',
        code: 'DEFAULT_REQUIRED',
        message: 'Exactly one default pack is required',
      });
    }
    for (const variant of normalized) {
      if (!variant.isActive) {
        variant.isDefault = false;
      }
    }
  }

  const skuCounts = new Map<string, number>();
  for (const variant of normalized) {
    skuCounts.set(variant.sku, (skuCounts.get(variant.sku) ?? 0) + 1);
  }
  for (const removal of removals) {
    if (removal.mode === 'deactivate') {
      skuCounts.set(removal.sku, (skuCounts.get(removal.sku) ?? 0) + 1);
    }
  }

  const conflicting = new Set(input.conflictingSkus);
  normalized.forEach((variant) => {
    if ((skuCounts.get(variant.sku) ?? 0) > 1 || conflicting.has(variant.sku)) {
      errors.push({
        path: `variants[${variant.index}].sku`,
        ...(variant.id ? { id: variant.id } : {}),
        ...(variant.clientKey ? { clientKey: variant.clientKey } : {}),
        code: 'SKU_TAKEN',
        message: 'SKU already exists',
      });
    }
  });

  const review = { live: [] as string[], pendingReview: [] as string[] };
  const writes: PlannedVariantWrite[] = normalized.map((variant) => {
    const existing = variant.id ? existingById.get(variant.id) : undefined;
    const key = refKey(variant);
    const inventoryTouched = inventoryChanged(existing, variant);

    if (!existing) {
      review.pendingReview.push(`${key}.created`);
    } else {
      if (!sameMoney(existing.price, variant.price)) {
        review.live.push(`${key}.price`);
      }
      if (!sameMoney(existing.sellingPrice, variant.sellingPrice)) {
        review.live.push(`${key}.sellingPrice`);
      }
      if (!sameMoney(existing.costPrice, variant.costPrice)) {
        review.live.push(`${key}.costPrice`);
      }
      if (existing.sku !== variant.sku) {
        review.pendingReview.push(`${key}.sku`);
      }
      if ((existing.name ?? null) !== variant.name) {
        review.pendingReview.push(`${key}.name`);
      }
      if (existing.primaryUnitId !== variant.primaryUnitId) {
        review.pendingReview.push(`${key}.primaryUnitId`);
      }
      if (existing.coverageArea !== variant.coverageArea) {
        review.pendingReview.push(`${key}.coverageArea`);
      }
      if ((existing.baseUnitId ?? null) !== variant.baseUnitId) {
        review.pendingReview.push(`${key}.baseUnitId`);
      }
      if (existing.weightKg !== variant.weightKg) {
        review.pendingReview.push(`${key}.weightKg`);
      }
      if (existing.isDefault !== variant.isDefault) {
        review.pendingReview.push(`${key}.isDefault`);
      }
      if (existing.isActive !== variant.isActive) {
        review.pendingReview.push(`${key}.isActive`);
      }
      if (!sameAttributes(existing.attributes, variant.attributes)) {
        review.pendingReview.push(`${key}.attributes`);
      }
    }

    return {
      existingId: variant.id,
      clientKey: variant.clientKey,
      sku: variant.sku,
      name: variant.name,
      price: variant.price,
      sellingPrice: variant.sellingPrice,
      costPrice: variant.costPrice,
      primaryUnitId: variant.primaryUnitId,
      coverageArea: variant.coverageArea,
      baseUnitId: variant.baseUnitId,
      weightKg: variant.weightKg,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
      attributes: variant.attributes,
      inventory: inventoryTouched ? (variant.inventory ?? null) : null,
    };
  });

  for (const removal of removals) {
    const existing = existingById.get(removal.id);
    if (!existing) {
      continue;
    }
    if (removal.mode === 'delete') {
      review.pendingReview.push(`${removal.id}.deleted`);
      continue;
    }
    if (existing.isActive || existing.isDefault) {
      review.pendingReview.push(`${removal.id}.deactivated`);
    }
  }

  return {
    errors,
    removed,
    review,
    requiresInventoryPermission: normalized.some((variant) =>
      inventoryChanged(
        variant.id ? existingById.get(variant.id) : undefined,
        variant,
      ),
    ),
    writes,
    removals,
    markPendingContentReview:
      input.status === ProductStatus.ACTIVE && review.pendingReview.length > 0,
  };
}
