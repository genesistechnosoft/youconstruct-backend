import { Prisma } from '../../../generated/prisma/client.js';

export type CatalogDraftAttribute = {
  attributeId: string;
  value: string;
};

export type CatalogDraftSpec = {
  attributeId: string;
  value: string;
  position: number;
};

export type CatalogDraftOption = {
  attributeId: string;
  position: number;
  values: string[];
};

export type CatalogDraftInventory = {
  quantity: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
};

export type CatalogDraftVariant = {
  id: string;
  sku: string;
  name: string | null;
  price: string;
  sellingPrice: string;
  costPrice: string | null;
  primaryUnitId: string;
  coverageArea: number | null;
  baseUnitId: string | null;
  weightKg: number | null;
  isDefault: boolean;
  isActive: boolean;
  attributes: CatalogDraftAttribute[];
  galleryMediaIds: string[];
  inventory: CatalogDraftInventory | null;
};

export type CatalogDraft = {
  name: string;
  description: string;
  shortDescription: string;
  categoryId: string;
  brandId: string | null;
  tags: string[];
  metaTitle: string;
  metaDescription: string;
  isReturnable: boolean;
  returnWindowDays: number | null;
  thumbnailMediaId: string | null;
  galleryMediaIds: string[];
  specs: CatalogDraftSpec[];
  options: CatalogDraftOption[];
  variants: CatalogDraftVariant[];
};

export type PublishedCatalogInput = {
  name: string;
  description: string;
  shortDescription: string;
  categoryId: string;
  brandId: string | null;
  tags: string[];
  metaTitle: string;
  metaDescription: string;
  isReturnable: boolean;
  returnWindowDays: number | null;
  thumbnailMediaId: string | null;
  galleryMediaIds: string[];
  specs: CatalogDraftSpec[];
  options: CatalogDraftOption[];
  variants: Array<{
    id: string;
    sku: string;
    name: string | null;
    price: Prisma.Decimal | number | string;
    sellingPrice: Prisma.Decimal | number | string;
    costPrice: Prisma.Decimal | number | string | null;
    primaryUnitId: string;
    coverageArea: number | null;
    baseUnitId: string | null;
    weightKg: number | null;
    isDefault: boolean;
    isActive: boolean;
    attributes: CatalogDraftAttribute[];
    galleryMediaIds: string[];
    inventory: CatalogDraftInventory | null;
  }>;
};

export type LiveSku = {
  id: string;
  sku: string;
};

export function moneyToDraft(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export function seedCatalogDraft(source: PublishedCatalogInput): CatalogDraft {
  return {
    name: source.name,
    description: source.description,
    shortDescription: source.shortDescription,
    categoryId: source.categoryId,
    brandId: source.brandId,
    tags: [...source.tags],
    metaTitle: source.metaTitle,
    metaDescription: source.metaDescription,
    isReturnable: source.isReturnable,
    returnWindowDays: source.returnWindowDays,
    thumbnailMediaId: source.thumbnailMediaId,
    galleryMediaIds: [...source.galleryMediaIds],
    specs: source.specs.map((spec) => ({ ...spec })),
    options: source.options.map((option) => ({
      ...option,
      values: [...option.values],
    })),
    variants: source.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      price: moneyToDraft(variant.price),
      sellingPrice: moneyToDraft(variant.sellingPrice),
      costPrice:
        variant.costPrice === null ? null : moneyToDraft(variant.costPrice),
      primaryUnitId: variant.primaryUnitId,
      coverageArea: variant.coverageArea,
      baseUnitId: variant.baseUnitId,
      weightKg: variant.weightKg,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
      attributes: variant.attributes.map((attribute) => ({
        attributeId: attribute.attributeId,
        value: attribute.value,
      })),
      galleryMediaIds: [...variant.galleryMediaIds],
      inventory: variant.inventory
        ? {
            quantity: variant.inventory.quantity,
            lowStockThreshold: variant.inventory.lowStockThreshold,
            allowBackorder: variant.inventory.allowBackorder,
          }
        : null,
    })),
  };
}

export function parseCatalogDraft(value: unknown): CatalogDraft {
  if (!isCatalogDraft(value)) {
    throw new Error('Catalog draft is invalid');
  }

  return value;
}

export function catalogMatchesPublished(
  draft: CatalogDraft,
  published: CatalogDraft,
): boolean {
  if (!sameScalars(draft, published)) {
    return false;
  }

  if (draft.thumbnailMediaId !== published.thumbnailMediaId) {
    return false;
  }

  if (!sameIds(draft.galleryMediaIds, published.galleryMediaIds)) {
    return false;
  }

  if (
    !sameSpecs(draft.specs, published.specs) ||
    !sameOptions(draft.options, published.options)
  ) {
    return false;
  }

  if (draft.variants.length !== published.variants.length) {
    return false;
  }

  const publishedById = new Map(
    published.variants.map((variant) => [variant.id, variant]),
  );

  return draft.variants.every((variant) => {
    const live = publishedById.get(variant.id);
    if (!live) {
      return false;
    }

    return (
      variant.sku === live.sku &&
      variant.name === live.name &&
      variant.primaryUnitId === live.primaryUnitId &&
      variant.coverageArea === live.coverageArea &&
      variant.baseUnitId === live.baseUnitId &&
      variant.weightKg === live.weightKg &&
      variant.isDefault === live.isDefault &&
      variant.isActive === live.isActive &&
      sameAttributes(variant.attributes, live.attributes) &&
      sameIds(variant.galleryMediaIds, live.galleryMediaIds)
    );
  });
}

export function skusToReserve(
  draft: CatalogDraft,
  liveSkus: string[],
): string[] {
  const held = new Set(liveSkus);
  return [
    ...new Set(
      draft.variants
        .map((variant) => variant.sku)
        .filter((sku) => !held.has(sku)),
    ),
  ];
}

export function draftSkuConflicts(
  draft: CatalogDraft,
  liveVariants: LiveSku[],
  externalTaken: Set<string>,
): { id: string; sku: string }[] {
  const counts = new Map<string, number>();
  for (const variant of draft.variants) {
    counts.set(variant.sku, (counts.get(variant.sku) ?? 0) + 1);
  }

  const liveSkuById = new Map(
    liveVariants.map((variant) => [variant.id, variant.sku]),
  );
  const ownerBySku = new Map(
    liveVariants.map((variant) => [variant.sku, variant.id]),
  );
  const released = new Set<string>();
  const draftById = new Map(
    draft.variants.map((variant) => [variant.id, variant]),
  );
  for (const live of liveVariants) {
    const next = draftById.get(live.id);
    if (next && next.sku !== live.sku) {
      released.add(live.sku);
    }
  }

  const conflicts: { id: string; sku: string }[] = [];
  for (const variant of draft.variants) {
    const duplicate = (counts.get(variant.sku) ?? 0) > 1;
    const ownLiveSku = liveSkuById.get(variant.id);
    if (!duplicate && ownLiveSku === variant.sku) {
      continue;
    }

    const ownerId = ownerBySku.get(variant.sku);
    const heldBySibling =
      ownerId !== undefined &&
      ownerId !== variant.id &&
      !released.has(variant.sku);
    if (duplicate || externalTaken.has(variant.sku) || heldBySibling) {
      conflicts.push({ id: variant.id, sku: variant.sku });
    }
  }

  return conflicts;
}

function sameScalars(draft: CatalogDraft, published: CatalogDraft) {
  return (
    draft.name === published.name &&
    draft.description === published.description &&
    draft.shortDescription === published.shortDescription &&
    draft.categoryId === published.categoryId &&
    draft.brandId === published.brandId &&
    draft.metaTitle === published.metaTitle &&
    draft.metaDescription === published.metaDescription &&
    draft.isReturnable === published.isReturnable &&
    draft.returnWindowDays === published.returnWindowDays &&
    sameTags(draft.tags, published.tags)
  );
}

function sameTags(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((tag, index) => tag === sortedRight[index]);
}

function sameSpecs(left: CatalogDraftSpec[], right: CatalogDraftSpec[]) {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) => a.position - b.position);
  const sortedRight = [...right].sort((a, b) => a.position - b.position);
  return sortedLeft.every(
    (spec, index) =>
      spec.attributeId === sortedRight[index]?.attributeId &&
      spec.value === sortedRight[index]?.value &&
      spec.position === sortedRight[index]?.position,
  );
}

function sameOptions(left: CatalogDraftOption[], right: CatalogDraftOption[]) {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) => a.position - b.position);
  const sortedRight = [...right].sort((a, b) => a.position - b.position);
  return sortedLeft.every((option, index) => {
    const other = sortedRight[index];
    return (
      option.attributeId === other?.attributeId &&
      option.position === other?.position &&
      option.values.length === other.values.length &&
      option.values.every(
        (value, valueIndex) => value === other.values[valueIndex],
      )
    );
  });
}

function sameAttributes(
  left: CatalogDraftAttribute[],
  right: CatalogDraftAttribute[],
) {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) =>
    a.attributeId.localeCompare(b.attributeId),
  );
  const sortedRight = [...right].sort((a, b) =>
    a.attributeId.localeCompare(b.attributeId),
  );
  return sortedLeft.every(
    (attribute, index) =>
      attribute.attributeId === sortedRight[index]?.attributeId &&
      attribute.value === sortedRight[index]?.value,
  );
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function isCatalogDraft(value: unknown): value is CatalogDraft {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.shortDescription === 'string' &&
    typeof value.categoryId === 'string' &&
    (value.brandId === null || typeof value.brandId === 'string') &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    typeof value.metaTitle === 'string' &&
    typeof value.metaDescription === 'string' &&
    typeof value.isReturnable === 'boolean' &&
    (value.returnWindowDays === null ||
      typeof value.returnWindowDays === 'number') &&
    (value.thumbnailMediaId === null ||
      typeof value.thumbnailMediaId === 'string') &&
    Array.isArray(value.galleryMediaIds) &&
    value.galleryMediaIds.every((id) => typeof id === 'string') &&
    Array.isArray(value.specs) &&
    value.specs.every(isSpec) &&
    Array.isArray(value.options) &&
    value.options.every(isOption) &&
    Array.isArray(value.variants) &&
    value.variants.every(isCatalogDraftVariant)
  );
}

function isSpec(value: unknown): value is CatalogDraftSpec {
  return (
    isRecord(value) &&
    typeof value.attributeId === 'string' &&
    typeof value.value === 'string' &&
    typeof value.position === 'number'
  );
}

function isOption(value: unknown): value is CatalogDraftOption {
  return (
    isRecord(value) &&
    typeof value.attributeId === 'string' &&
    typeof value.position === 'number' &&
    Array.isArray(value.values) &&
    value.values.every((entry) => typeof entry === 'string')
  );
}

function isCatalogDraftVariant(value: unknown): value is CatalogDraftVariant {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.sku === 'string' &&
    (value.name === null || typeof value.name === 'string') &&
    typeof value.price === 'string' &&
    typeof value.sellingPrice === 'string' &&
    (value.costPrice === null || typeof value.costPrice === 'string') &&
    typeof value.primaryUnitId === 'string' &&
    (value.coverageArea === null || typeof value.coverageArea === 'number') &&
    (value.baseUnitId === null || typeof value.baseUnitId === 'string') &&
    (value.weightKg === null || typeof value.weightKg === 'number') &&
    typeof value.isDefault === 'boolean' &&
    typeof value.isActive === 'boolean' &&
    Array.isArray(value.attributes) &&
    value.attributes.every(isAttribute) &&
    Array.isArray(value.galleryMediaIds) &&
    value.galleryMediaIds.every((id) => typeof id === 'string') &&
    (value.inventory === null || isInventory(value.inventory))
  );
}

function isAttribute(value: unknown): value is CatalogDraftAttribute {
  return (
    isRecord(value) &&
    typeof value.attributeId === 'string' &&
    typeof value.value === 'string'
  );
}

function isInventory(value: unknown): value is CatalogDraftInventory {
  return (
    isRecord(value) &&
    typeof value.quantity === 'number' &&
    typeof value.lowStockThreshold === 'number' &&
    typeof value.allowBackorder === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
