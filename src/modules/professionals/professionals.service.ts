import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationEventType,
  ProfessionalOnboardingStatus,
} from '../../../generated/prisma/client.js';
import {
  domainBadRequest,
  domainForbidden,
  domainNotFound,
} from '../../common/errors/domain-exception';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { generateSlug } from '../../common/utils/slug.util';
import { paginationMeta } from '../../common/utils/pagination.util';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { SecurityAuditService } from '../rbac/security-audit.service';
import { ProfessionalFiltersDto } from './dto/professional-filters.dto';
import { RejectProfessionalDto } from './dto/reject-professional.dto';
import { SuspendProfessionalDto } from './dto/suspend-professional.dto';
import { UpdateProfessionalProfileDto } from './dto/update-professional-profile.dto';
import { ProfessionalsRepository } from './professionals.repository';

@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly repo: ProfessionalsRepository,
    private readonly platformSettings: PlatformSettingsService,
    private readonly notifications: NotificationEmitterService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  // ── Professional (self) ────────────────────────────────────────────────────

  async getMyProfile(userId: string) {
    const profile = await this.ensureProfile(userId);
    return {
      message: 'Professional profile fetched successfully',
      data: profile,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfessionalProfileDto) {
    const profile = await this.ensureProfile(userId);
    this.ensureCanEdit(profile.onboardingStatus);

    const { categoryIds, ...fields } = dto;

    if (categoryIds !== undefined) {
      const maxCategories = await this.getMaxCategories();
      if (categoryIds.length > maxCategories) {
        throw domainBadRequest(
          DOMAIN_ERROR_CODES.PROFESSIONAL_CATEGORY_LIMIT,
          `Profiles may be linked to a maximum of ${maxCategories} categories`,
        );
      }
      await this.repo.syncCategories(profile.id, categoryIds);
    }

    const willUpdateSlug =
      !!fields.displayName &&
      profile.onboardingStatus !== ProfessionalOnboardingStatus.APPROVED;

    const updateData = {
      ...(fields.displayName !== undefined && {
        displayName: fields.displayName,
      }),
      ...(fields.tagline !== undefined && { tagline: fields.tagline }),
      ...(fields.bio !== undefined && { bio: fields.bio }),
      ...(fields.city !== undefined && { city: fields.city }),
      ...(fields.state !== undefined && { state: fields.state }),
      ...(fields.pincode !== undefined && { pincode: fields.pincode }),
      ...(fields.latitude !== undefined && { latitude: fields.latitude }),
      ...(fields.longitude !== undefined && { longitude: fields.longitude }),
      ...(fields.experienceYears !== undefined && {
        experienceYears: fields.experienceYears,
      }),
      ...(fields.websiteUrl !== undefined && { websiteUrl: fields.websiteUrl }),
      ...(fields.instagramUrl !== undefined && {
        instagramUrl: fields.instagramUrl,
      }),
      // Re-derive slug from displayName while still in a pre-approval state.
      // Slug stops changing once the profile is APPROVED.
      ...(willUpdateSlug
        ? { slug: await this.allocateUniqueSlug(fields.displayName!) }
        : {}),
    };

    // Use retry-on-slug-conflict only when we're writing a slug
    const updated = willUpdateSlug
      ? await this.updateProfileWithSlugRetry(
          profile.id,
          updateData,
          fields.displayName!,
          profile.onboardingStatus,
        )
      : await this.repo.updateProfile(profile.id, updateData);

    return {
      message: 'Professional profile updated successfully',
      data: updated,
    };
  }

  async submitForReview(userId: string) {
    const profile = await this.ensureProfile(userId);

    if (profile.onboardingStatus === ProfessionalOnboardingStatus.SUBMITTED) {
      throw new BadRequestException('Profile is already submitted for review');
    }
    if (profile.onboardingStatus === ProfessionalOnboardingStatus.APPROVED) {
      throw new BadRequestException('Profile is already approved');
    }
    if (
      profile.onboardingStatus !== ProfessionalOnboardingStatus.DRAFT &&
      profile.onboardingStatus !== ProfessionalOnboardingStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Profile cannot be submitted in its current state',
      );
    }

    this.validateProfileComplete(profile);

    const autoApprove = await this.platformSettings.getValue(
      'professional',
      'autoApproveProfiles',
    );

    if (autoApprove) {
      const approved = await this.repo.approveProfile(profile.id, userId);
      this.notifications.emit({
        userId,
        eventType: NotificationEventType.PROFESSIONAL_APPROVED,
        title: 'Profile approved',
        body: 'Your professional profile has been automatically approved.',
        data: { professionalId: profile.id },
      });
      return {
        message: 'Professional profile submitted and auto-approved',
        data: approved,
      };
    }

    const submitted = await this.repo.submitProfile(profile.id);
    return { message: 'Profile submitted for review', data: submitted };
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listForAdmin(filters: ProfessionalFiltersDto) {
    const { items, total } = await this.repo.findProfessionals(filters);
    return {
      message: 'Professionals fetched successfully',
      data: items,
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }

  async getForAdmin(id: string) {
    const profile = await this.repo.findByIdForAdmin(id);
    if (!profile) throw new NotFoundException('Professional profile not found');
    return {
      message: 'Professional profile fetched successfully',
      data: profile,
    };
  }

  async approveProfile(id: string, actorUserId: string) {
    const profile = await this.repo.findById(id);
    if (!profile) throw new NotFoundException('Professional profile not found');

    if (profile.onboardingStatus === ProfessionalOnboardingStatus.APPROVED) {
      return { message: 'Profile is already approved', data: profile };
    }

    const approved = await this.repo.approveProfile(id, profile.userId);

    this.securityAudit.log({
      actorUserId,
      action: 'PROFESSIONAL_APPROVE',
      result: 'SUCCESS',
      targetType: 'professionalProfile',
      targetId: id,
    });
    this.notifications.emit({
      userId: profile.userId,
      eventType: NotificationEventType.PROFESSIONAL_APPROVED,
      title: 'Profile approved',
      body: 'Your professional profile has been approved. You can now add projects.',
      data: { professionalId: id },
    });

    return {
      message: 'Professional profile approved successfully',
      data: approved,
    };
  }

  async rejectProfile(
    id: string,
    actorUserId: string,
    dto: RejectProfessionalDto,
  ) {
    const profile = await this.repo.findById(id);
    if (!profile) throw new NotFoundException('Professional profile not found');

    if (profile.onboardingStatus !== ProfessionalOnboardingStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted profiles can be rejected');
    }

    const rejected = await this.repo.rejectProfile(id, dto.rejectionReason);

    this.securityAudit.log({
      actorUserId,
      action: 'PROFESSIONAL_REJECT',
      result: 'SUCCESS',
      targetType: 'professionalProfile',
      targetId: id,
      metadata: { reason: dto.rejectionReason },
    });
    this.notifications.emit({
      userId: profile.userId,
      eventType: NotificationEventType.PROFESSIONAL_REJECTED,
      title: 'Profile application rejected',
      body: dto.rejectionReason,
      data: { professionalId: id },
    });

    return { message: 'Professional profile rejected', data: rejected };
  }

  async suspendProfile(
    id: string,
    actorUserId: string,
    dto: SuspendProfessionalDto,
  ) {
    const profile = await this.repo.findById(id);
    if (!profile) throw new NotFoundException('Professional profile not found');

    if (profile.onboardingStatus !== ProfessionalOnboardingStatus.APPROVED) {
      throw new BadRequestException('Only approved profiles can be suspended');
    }

    const suspended = await this.repo.suspendProfile(id, dto.suspensionReason);

    this.securityAudit.log({
      actorUserId,
      action: 'PROFESSIONAL_SUSPEND',
      result: 'SUCCESS',
      targetType: 'professionalProfile',
      targetId: id,
      metadata: { reason: dto.suspensionReason },
    });
    this.notifications.emit({
      userId: profile.userId,
      eventType: NotificationEventType.PROFESSIONAL_SUSPENDED,
      title: 'Profile suspended',
      body: dto.suspensionReason,
      data: { professionalId: id },
    });

    return { message: 'Professional profile suspended', data: suspended };
  }

  async reinstateProfile(id: string, actorUserId: string) {
    const profile = await this.repo.findById(id);
    if (!profile) throw new NotFoundException('Professional profile not found');

    if (profile.onboardingStatus !== ProfessionalOnboardingStatus.SUSPENDED) {
      throw new BadRequestException(
        'Only suspended profiles can be reinstated',
      );
    }

    const reinstated = await this.repo.reinstateProfile(id);

    this.securityAudit.log({
      actorUserId,
      action: 'PROFESSIONAL_REINSTATE',
      result: 'SUCCESS',
      targetType: 'professionalProfile',
      targetId: id,
    });
    this.notifications.emit({
      userId: profile.userId,
      eventType: NotificationEventType.PROFESSIONAL_REINSTATED,
      title: 'Profile reinstated',
      body: 'Your professional profile has been reinstated.',
      data: { professionalId: id },
    });

    return {
      message: 'Professional profile reinstated successfully',
      data: reinstated,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * ONBOARDING ONLY — Fetch or lazily create a DRAFT professional profile for
   * this user. Must only be called from owner-only onboarding routes
   * (GET/PATCH /professional/onboarding, POST /professional/onboarding/submit).
   * Never call this from post-approval routes — use requireApprovedProfile.
   */
  async ensureProfile(userId: string) {
    const existing = await this.repo.findByUserId(userId);
    if (existing) {
      if (!existing.slug) {
        // Backfill missing slug (shouldn't happen post-migration)
        const slug = await this.allocateUniqueSlug(
          existing.displayName || 'professional',
        );
        return this.repo.updateProfile(existing.id, { slug });
      }
      return existing;
    }

    // Profile doesn't exist — create a DRAFT shell.
    // The user must already have PlatformRole.PROFESSIONAL (enforced by @Roles guard).
    const slug = await this.allocateUniqueSlug('professional');
    return this.repo.createProfile(userId, slug);
  }

  /**
   * POST-APPROVAL routes — load a professional profile by its id (from
   * activeContext.entityId). Rejects if the profile is not APPROVED.
   * SUSPENDED profiles return PROFESSIONAL_SUSPENDED (writes blocked,
   * reads allowed via a separate read-only path in the controller).
   */
  async requireApprovedProfile(profileId: string) {
    const profile = await this.repo.findById(profileId);
    if (!profile) {
      throw domainNotFound(
        DOMAIN_ERROR_CODES.PROFESSIONAL_NOT_APPROVED,
        'Professional profile not found',
      );
    }
    if (profile.onboardingStatus === ProfessionalOnboardingStatus.SUSPENDED) {
      throw domainForbidden(
        DOMAIN_ERROR_CODES.PROFESSIONAL_SUSPENDED,
        'Your professional profile is suspended',
      );
    }
    if (profile.onboardingStatus !== ProfessionalOnboardingStatus.APPROVED) {
      throw domainForbidden(
        DOMAIN_ERROR_CODES.PROFESSIONAL_NOT_APPROVED,
        'Your professional profile must be approved before performing this action',
      );
    }
    return profile;
  }

  private ensureCanEdit(status: ProfessionalOnboardingStatus) {
    if (status === ProfessionalOnboardingStatus.SUBMITTED) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.PROFESSIONAL_PROFILE_LOCKED,
        'Profile is under review and cannot be edited',
      );
    }
    if (status === ProfessionalOnboardingStatus.SUSPENDED) {
      throw domainForbidden(
        DOMAIN_ERROR_CODES.PROFESSIONAL_SUSPENDED,
        'Profile is suspended and cannot be edited',
      );
    }
  }

  private validateProfileComplete(profile: { displayName: string }) {
    if (!profile.displayName?.trim()) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.PROFESSIONAL_PROFILE_INCOMPLETE,
        'Display name is required before submitting',
      );
    }
  }

  private async getMaxCategories(): Promise<number> {
    const value = await this.platformSettings.getValue(
      'professional',
      'maxCategoriesPerProfile',
    );
    return typeof value === 'number' ? value : 5;
  }

  private async allocateUniqueSlug(displayName: string, startSuffix = 2) {
    const base = generateSlug(displayName) || 'professional';
    let candidate = base;
    let suffix = startSuffix;

    while (await this.repo.slugExists(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  /**
   * Write a profile update that includes a slug, retrying up to 5 times on
   * a unique-constraint violation (P2002 on slug). Stops retrying once APPROVED.
   */
  private async updateProfileWithSlugRetry(
    id: string,
    data: Parameters<typeof this.repo.updateProfile>[1],
    displayName: string,
    onboardingStatus: import('../../../generated/prisma/client.js').ProfessionalOnboardingStatus,
    attempt = 1,
  ): ReturnType<typeof this.repo.updateProfile> {
    try {
      return await this.repo.updateProfile(id, data);
    } catch (err) {
      const isSlugConflict =
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'P2002' &&
        attempt < 5 &&
        onboardingStatus !== ProfessionalOnboardingStatus.APPROVED;

      if (!isSlugConflict) throw err;

      const newSlug = await this.allocateUniqueSlug(displayName, attempt + 2);
      return this.updateProfileWithSlugRetry(
        id,
        { ...data, slug: newSlug },
        displayName,
        onboardingStatus,
        attempt + 1,
      );
    }
  }
}
