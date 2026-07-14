export const MEDIA_VARIANTS = {
  ORIGINAL: 'original',
  COMPRESSED: 'compressed',
  THUMBNAIL: 'thumbnail',
} as const;

export type MediaVariant = (typeof MEDIA_VARIANTS)[keyof typeof MEDIA_VARIANTS];

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

export const DOCUMENT_MIME_TYPES = ['application/pdf'] as const;
