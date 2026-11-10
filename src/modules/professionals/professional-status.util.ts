import {
  ProfessionalContentStatus,
  ProfessionalOnboardingStatus,
} from '../../../generated/prisma/client.js';

/**
 * Allowed onboarding status transitions.
 * Key = current status; value = statuses reachable from it.
 */
export const PROFESSIONAL_ONBOARDING_TRANSITIONS: Record<
  ProfessionalOnboardingStatus,
  ProfessionalOnboardingStatus[]
> = {
  [ProfessionalOnboardingStatus.DRAFT]: [
    ProfessionalOnboardingStatus.SUBMITTED,
  ],
  [ProfessionalOnboardingStatus.SUBMITTED]: [
    ProfessionalOnboardingStatus.APPROVED,
    ProfessionalOnboardingStatus.REJECTED,
  ],
  [ProfessionalOnboardingStatus.APPROVED]: [
    ProfessionalOnboardingStatus.SUSPENDED,
  ],
  [ProfessionalOnboardingStatus.REJECTED]: [
    ProfessionalOnboardingStatus.SUBMITTED,
  ],
  [ProfessionalOnboardingStatus.SUSPENDED]: [
    ProfessionalOnboardingStatus.APPROVED,
  ],
};

/**
 * Allowed content (project) status transitions.
 * Key = current status; value = statuses reachable from it.
 */
export const PROFESSIONAL_CONTENT_TRANSITIONS: Record<
  ProfessionalContentStatus,
  ProfessionalContentStatus[]
> = {
  [ProfessionalContentStatus.DRAFT]: [
    ProfessionalContentStatus.PENDING_APPROVAL,
  ],
  [ProfessionalContentStatus.PENDING_APPROVAL]: [
    ProfessionalContentStatus.DRAFT, // professional withdraw
    ProfessionalContentStatus.APPROVED,
    ProfessionalContentStatus.REJECTED,
    ProfessionalContentStatus.REMOVED,
  ],
  [ProfessionalContentStatus.APPROVED]: [
    ProfessionalContentStatus.PENDING_APPROVAL, // edit triggers re-review
    ProfessionalContentStatus.REMOVED,
  ],
  [ProfessionalContentStatus.REJECTED]: [
    ProfessionalContentStatus.PENDING_APPROVAL,
  ],
  [ProfessionalContentStatus.REMOVED]: [], // terminal
};
