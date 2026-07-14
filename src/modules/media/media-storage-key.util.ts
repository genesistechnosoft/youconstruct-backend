import { MediaVisibility } from '../../../generated/prisma/client.js';

export function buildMediaStorageKey(input: {
  visibility: MediaVisibility;
  createdAt: Date;
  mediaId: string;
  variantType: string;
  extension: string;
}) {
  const visibility = input.visibility.toLowerCase();
  const year = String(input.createdAt.getUTCFullYear());
  const month = String(input.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const extension = input.extension.replace(/^\./, '').toLowerCase();

  return `media/${visibility}/${year}/${month}/${input.mediaId}/${input.variantType}.${extension}`;
}
