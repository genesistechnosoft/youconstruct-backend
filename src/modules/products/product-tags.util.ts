export const PRODUCT_TAG_MAX_LENGTH = 40;
export const PRODUCT_TAG_MAX_COUNT = 20;

export function normalizeProductTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag) {
      continue;
    }

    const clipped = tag.slice(0, PRODUCT_TAG_MAX_LENGTH);
    if (seen.has(clipped)) {
      continue;
    }

    seen.add(clipped);
    result.push(clipped);
    if (result.length >= PRODUCT_TAG_MAX_COUNT) {
      break;
    }
  }

  return result;
}
