import { SetMetadata } from '@nestjs/common';

export const OWNER_ONLY_KEY = 'ownerOnly';
export const OwnerOnly = () => SetMetadata(OWNER_ONLY_KEY, true);
