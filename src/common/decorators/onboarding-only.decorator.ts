import { SetMetadata } from '@nestjs/common';

export const ONBOARDING_ONLY_KEY = 'onboardingOnly';
export const OnboardingOnly = () => SetMetadata(ONBOARDING_ONLY_KEY, true);
