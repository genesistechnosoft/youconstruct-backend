import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MediaEntityType,
  NotificationEventType,
  ProfessionalContentStatus,
  ProfessionalOnboardingStatus,
} from '../../../generated/prisma/client.js';
import { MediaRepository } from '../media/media.repository';
import {
  domainBadRequest,
  domainForbidden,
} from '../../common/errors/domain-exception';
import { DOMAIN_ERROR_CODES } from '../../common/errors/domain-error-code';
import { paginationMeta } from '../../common/utils/pagination.util';
import { MediaService } from '../media/media.service';
import { NotificationEmitterService } from '../notifications/notification-emitter.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ProfessionalsService } from '../professionals/professionals.service';
import { ProfessionalsRepository } from '../professionals/professionals.repository';
import { SecurityAuditService } from '../rbac/security-audit.service';
import {
  DEFAULT_QUEUE_JOB_OPTIONS,
  PURGE_PROJECT_MEDIA_QUEUE,
} from '../../queue/queue.constants';
import type { PurgeProjectMediaJobData } from '../../queue/processors/purge-project-media.processor';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectFiltersDto } from './dto/project-filters.dto';
import { RejectProjectDto, RemoveProjectDto } from './dto/moderate-project.dto';
import { ReorderMediaLinksDto } from '../media/dto/reorder-media-links.dto';
import { ProfessionalProjectsRepository } from './professional-projects.repository';

/** 30-day fallback — matches the platform setting default. Never 0 to avoid accidental instant purge. */
const PURGE_DELAY_FALLBACK_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class ProfessionalProjectsService {
  constructor(
    private readonly repo: ProfessionalProjectsRepository,
    private readonly professionalsService: ProfessionalsService,
    private readonly professionalsRepo: ProfessionalsRepository,
    private readonly mediaService: MediaService,
    private readonly mediaRepository: MediaRepository,
    private readonly platformSettings: PlatformSettingsService,
    private readonly notifications: NotificationEmitterService,
    private readonly securityAudit: SecurityAuditService,
    @InjectQueue(PURGE_PROJECT_MEDIA_QUEUE)
    private readonly purgeQueue: Queue<PurgeProjectMediaJobData>,
  ) {}

  // ── Professional (self) ────────────────────────────────────────────────────

  /** Read-only — allowed while SUSPENDED so the professional can see their work. */
  async listMyProjects(profileId: string, filters: ProjectFiltersDto) {
    const { items, total } = await this.repo.findForProfessional(
      profileId,
      filters,
    );
    return {
      message: 'Projects fetched successfully',
      data: items,
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }

  /** Read-only — allowed while SUSPENDED. */
  async getMyProject(profileId: string, projectId: string) {
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');
    const photos = await this.loadProjectPhotos([project.id]);
    return {
      message: 'Project fetched successfully',
      data: { ...project, photos: photos.get(project.id) ?? [] },
    };
  }

  async createProject(profileId: string, dto: CreateProjectDto) {
    await this.professionalsService.requireApprovedProfile(profileId);

    const maxProjects = await this.getMaxProjects();
    const currentCount = await this.repo.countNonDeleted(profileId);
    if (currentCount >= maxProjects) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.PROJECT_LIMIT_REACHED,
        `You may have a maximum of ${maxProjects} projects`,
      );
    }

    const project = await this.repo.create(profileId, {
      title: dto.title,
      description: dto.description,
      location: dto.location,
      areaSqft: dto.areaSqft,
      budgetRange: dto.budgetRange,
      completionYear: dto.completionYear,
      status: ProfessionalContentStatus.DRAFT,
      professional: { connect: { id: profileId } },
    });

    return { message: 'Project created successfully', data: project };
  }

  async updateProject(
    profileId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ) {
    await this.professionalsService.requireApprovedProfile(profileId);
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');

    this.ensureProjectEditable(project.status);

    const fields = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.location !== undefined && { location: dto.location }),
      ...(dto.areaSqft !== undefined && { areaSqft: dto.areaSqft }),
      ...(dto.budgetRange !== undefined && { budgetRange: dto.budgetRange }),
      ...(dto.completionYear !== undefined && {
        completionYear: dto.completionYear,
      }),
    };

    let updated: Awaited<ReturnType<typeof this.repo.update>>;
    if (project.status === ProfessionalContentStatus.APPROVED) {
      // Edit of APPROVED project → goes back to PENDING_APPROVAL via transition
      const transitioned = await this.repo.updateWithTransition(
        projectId,
        ProfessionalContentStatus.PENDING_APPROVAL,
        { ...fields, submittedAt: new Date(), approvedAt: null },
      );
      // updateWithTransition returns the project (or null if race; treat null as the old project)
      updated = transitioned ?? project;
    } else {
      // DRAFT or REJECTED — plain update, no status change
      updated = await this.repo.update(projectId, fields);
    }

    return { message: 'Project updated successfully', data: updated };
  }

  async submitProject(profileId: string, projectId: string) {
    await this.professionalsService.requireApprovedProfile(profileId);
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');

    if (!project.title?.trim()) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.CONTENT_INCOMPLETE,
        'Project title is required before submitting',
      );
    }

    const autoApprove = await this.platformSettings.getValue(
      'professional',
      'autoApproveProjects',
    );

    if (autoApprove) {
      // approve() already goes through updateWithTransition
      const approved = await this.repo.approve(projectId);
      this.notifications.emit({
        userId: await this.getProjectOwnerId(profileId),
        eventType: NotificationEventType.PROJECT_APPROVED,
        title: 'Project approved',
        body: `Your project "${project.title}" was automatically approved.`,
        data: { projectId },
      });
      return {
        message: 'Project submitted and auto-approved',
        data: approved,
      };
    }

    const submitted = await this.repo.updateWithTransition(
      projectId,
      ProfessionalContentStatus.PENDING_APPROVAL,
      { submittedAt: new Date() },
    );
    return { message: 'Project submitted for review', data: submitted };
  }

  async withdrawProject(profileId: string, projectId: string) {
    await this.professionalsService.requireApprovedProfile(profileId);
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');

    const withdrawn = await this.repo.updateWithTransition(
      projectId,
      ProfessionalContentStatus.DRAFT,
      {},
    );
    return { message: 'Project withdrawn to DRAFT', data: withdrawn };
  }

  async deleteMyProject(profileId: string, projectId: string) {
    await this.professionalsService.requireApprovedProfile(profileId);
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');

    if (project.status === ProfessionalContentStatus.REMOVED) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.CONTENT_REMOVED,
        'REMOVED projects cannot be deleted by the professional',
      );
    }

    await this.repo.softDelete(projectId);
    return { message: 'Project deleted successfully' };
  }

  async uploadProjectPhoto(
    userId: string,
    profileId: string,
    projectId: string,
    file: Express.Multer.File | undefined,
  ) {
    await this.professionalsService.requireApprovedProfile(profileId);
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.status === ProfessionalContentStatus.REMOVED) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.CONTENT_REMOVED,
        'Cannot upload to a removed project',
      );
    }

    const maxPhotos = await this.getMaxPhotos();
    return this.mediaService.uploadProfessionalProjectPhoto(
      userId,
      profileId,
      projectId,
      file,
      maxPhotos,
    );
  }

  async deleteProjectPhoto(
    profileId: string,
    projectId: string,
    mediaId: string,
  ) {
    await this.professionalsService.requireApprovedProfile(profileId);
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');

    return this.mediaService.deleteProfessionalProjectPhoto(
      profileId,
      projectId,
      mediaId,
    );
  }

  async reorderProjectPhotos(
    profileId: string,
    projectId: string,
    dto: ReorderMediaLinksDto,
  ) {
    await this.professionalsService.requireApprovedProfile(profileId);
    const project = await this.repo.findByIdAndOwner(projectId, profileId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.status === ProfessionalContentStatus.REMOVED) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.CONTENT_REMOVED,
        'Cannot reorder photos of a removed project',
      );
    }

    return this.mediaService.reorderEntityMedia(
      MediaEntityType.PROFESSIONAL_PROJECT,
      projectId,
      dto,
    );
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listForAdmin(filters: ProjectFiltersDto) {
    const { items, total } = await this.repo.findForAdmin(filters);
    return {
      message: 'Projects fetched successfully',
      data: items,
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }

  async getForAdmin(projectId: string) {
    const project = await this.repo.findByIdForAdmin(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const photos = await this.loadProjectPhotos([project.id]);
    return {
      message: 'Project fetched successfully',
      data: { ...project, photos: photos.get(project.id) ?? [] },
    };
  }

  async approveProject(projectId: string, actorUserId: string) {
    const project = await this.repo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');

    if (project.status !== ProfessionalContentStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL projects can be approved',
      );
    }

    const approved = await this.repo.approve(projectId);

    this.securityAudit.log({
      actorUserId,
      action: 'PROJECT_APPROVE',
      result: 'SUCCESS',
      targetType: 'professionalProject',
      targetId: projectId,
    });
    this.notifications.emit({
      userId: await this.getProjectOwnerId(project.professionalId),
      eventType: NotificationEventType.PROJECT_APPROVED,
      title: 'Project approved',
      body: `Your project "${project.title}" has been approved.`,
      data: { projectId },
    });

    return { message: 'Project approved', data: approved };
  }

  async rejectProject(
    projectId: string,
    actorUserId: string,
    dto: RejectProjectDto,
  ) {
    const project = await this.repo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');

    if (project.status !== ProfessionalContentStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only PENDING_APPROVAL projects can be rejected',
      );
    }

    const rejected = await this.repo.reject(projectId, dto.rejectionReason);

    this.securityAudit.log({
      actorUserId,
      action: 'PROJECT_REJECT',
      result: 'SUCCESS',
      targetType: 'professionalProject',
      targetId: projectId,
      metadata: { reason: dto.rejectionReason },
    });
    this.notifications.emit({
      userId: await this.getProjectOwnerId(project.professionalId),
      eventType: NotificationEventType.PROJECT_REJECTED,
      title: 'Project rejected',
      body: dto.rejectionReason,
      data: { projectId },
    });

    return { message: 'Project rejected', data: rejected };
  }

  async removeProject(
    projectId: string,
    actorUserId: string,
    dto: RemoveProjectDto,
  ) {
    const project = await this.repo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');

    if (project.status === ProfessionalContentStatus.REMOVED) {
      return { message: 'Project is already removed', data: project };
    }

    const removed = await this.repo.remove(projectId, dto.removalReason);

    this.securityAudit.log({
      actorUserId,
      action: 'PROJECT_REMOVE',
      result: 'SUCCESS',
      targetType: 'professionalProject',
      targetId: projectId,
      metadata: { reason: dto.removalReason },
    });
    this.notifications.emit({
      userId: await this.getProjectOwnerId(project.professionalId),
      eventType: NotificationEventType.PROJECT_REMOVED,
      title: 'Project removed',
      body: dto.removalReason,
      data: { projectId },
    });

    // Schedule delayed media purge.
    // Project is hidden from public immediately (status = REMOVED).
    // Media is purged after the configured delay.
    // If the delayed job is lost (Redis restart, crash), media won't auto-purge
    // until an admin re-triggers removal or runs the manual recovery query below:
    //
    //   SELECT id, "professionalId", "removedAt"
    //   FROM professional_projects
    //   WHERE status = 'REMOVED'
    //     AND "removedAt" < NOW() - INTERVAL '30 days'
    //     AND EXISTS (
    //       SELECT 1 FROM media_links
    //       WHERE entity_type = 'PROFESSIONAL_PROJECT'
    //         AND entity_id = professional_projects.id
    //         AND deleted_at IS NULL
    //     );
    //
    // Re-removing those projects (same admin endpoint) re-queues the purge job.
    const purgeDelayDaysRaw = await this.platformSettings.getValue(
      'professional',
      'removalPurgeDelayDays',
    );
    if (typeof purgeDelayDaysRaw !== 'number') {
      throw new Error(
        `professional.removalPurgeDelayDays is not a number (got ${JSON.stringify(purgeDelayDaysRaw)}). ` +
          `Run pnpm run sync:permissions or seed to create the setting row.`,
      );
    }
    const delayMs =
      purgeDelayDaysRaw * 24 * 60 * 60 * 1000 || PURGE_DELAY_FALLBACK_MS;

    await this.purgeQueue.add(
      'purge-project-media',
      { projectId },
      {
        ...DEFAULT_QUEUE_JOB_OPTIONS,
        delay: delayMs,
      },
    );

    return { message: 'Project removed', data: removed };
  }

  /**
   * Called by the BullMQ processor after the purge delay.
   * Deletes all storage objects linked to the project.
   */
  async purgeProjectMedia(projectId: string) {
    await this.mediaService.purgeEntityMedia(
      MediaEntityType.PROFESSIONAL_PROJECT,
      projectId,
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Batch-loads all gallery photos for the given project IDs (1 DB query).
   * Returns a Map keyed by projectId → resolved photo objects with URLs.
   */
  private async loadProjectPhotos(projectIds: string[]) {
    const links = await this.mediaRepository.findLinksByEntityIds(
      MediaEntityType.PROFESSIONAL_PROJECT,
      projectIds,
    );
    type PhotoLink = (typeof links)[number];
    const map = new Map<string, Awaited<ReturnType<typeof this.mediaService.withUrls>>[]>();
    const resolved = await Promise.all(
      links.map((l: PhotoLink) => this.mediaService.withUrls(l.media)),
    );
    links.forEach((l: PhotoLink, i: number) => {
      if (!map.has(l.entityId)) map.set(l.entityId, []);
      map.get(l.entityId)!.push(resolved[i]);
    });
    return map;
  }

  private ensureApproved(status: ProfessionalOnboardingStatus) {
    if (status !== ProfessionalOnboardingStatus.APPROVED) {
      throw domainForbidden(
        DOMAIN_ERROR_CODES.PROFESSIONAL_NOT_APPROVED,
        'Your professional profile must be approved before adding projects',
      );
    }
  }

  private ensureProjectEditable(status: ProfessionalContentStatus) {
    if (status === ProfessionalContentStatus.REMOVED) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.CONTENT_REMOVED,
        'REMOVED projects cannot be edited',
      );
    }
    if (status === ProfessionalContentStatus.PENDING_APPROVAL) {
      throw domainBadRequest(
        DOMAIN_ERROR_CODES.CONTENT_LOCKED,
        'Project is under review and cannot be edited',
      );
    }
  }

  private async getMaxProjects(): Promise<number> {
    const value = await this.platformSettings.getValue(
      'professional',
      'maxProjectsPerProfessional',
    );
    return typeof value === 'number' ? value : 100;
  }

  private async getMaxPhotos(): Promise<number> {
    const value = await this.platformSettings.getValue(
      'professional',
      'maxPhotosPerProject',
    );
    return typeof value === 'number' ? value : 20;
  }

  private async getProjectOwnerId(professionalId: string): Promise<string> {
    const profile =
      await this.professionalsRepo.findByIdForUserId(professionalId);
    return profile?.userId ?? '';
  }
}
