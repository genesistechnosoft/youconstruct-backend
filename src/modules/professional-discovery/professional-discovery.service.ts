import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MediaContext,
  MediaEntityType,
} from '../../../generated/prisma/client.js';
import { MediaRepository } from '../media/media.repository';
import { MediaService } from '../media/media.service';
import { paginationMeta } from '../../common/utils/pagination.util';
import {
  DiscoverProfessionalsDto,
  DiscoverProjectsDto,
} from './dto/discovery-query.dto';
import { ProfessionalDiscoveryRepository } from './professional-discovery.repository';

@Injectable()
export class ProfessionalDiscoveryService {
  constructor(
    private readonly repo: ProfessionalDiscoveryRepository,
    private readonly mediaRepo: MediaRepository,
    private readonly mediaService: MediaService,
  ) {}

  async listProfessionals(filters: DiscoverProfessionalsDto) {
    const { items, total } = await this.repo.findApprovedProfessionals(filters);

    // Batch-load profile card photos (1 query for all profiles on this page)
    const profileIds = items.map((p) => p.id);
    const photoLinks = await this.mediaRepo.findLinksByEntityIds(
      MediaEntityType.PROFESSIONAL_PROFILE,
      profileIds,
      MediaContext.PROFILE_PHOTO,
    );
    type PhotoLink = (typeof photoLinks)[number];
    const photoMap = new Map<string, PhotoLink>();
    for (const l of photoLinks) {
      photoMap.set(l.entityId, l);
    }

    const data = await Promise.all(
      items.map(async (profile) => {
        const link = photoMap.get(profile.id);
        return {
          ...profile,
          profilePhoto: link
            ? await this.mediaService.withUrls(link.media)
            : null,
        };
      }),
    );

    return {
      message: 'Professionals fetched successfully',
      data,
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }

  async getProfessionalBySlug(slug: string) {
    const profile = await this.repo.findApprovedProfileBySlug(slug);
    if (!profile) throw new NotFoundException('Professional not found');

    // Load profile card photo
    const photoLinks = await this.mediaRepo.findLinksByEntityIds(
      MediaEntityType.PROFESSIONAL_PROFILE,
      [profile.id],
      MediaContext.PROFILE_PHOTO,
    );
    const profilePhoto = photoLinks[0]
      ? await this.mediaService.withUrls(photoLinks[0].media)
      : null;

    return {
      message: 'Professional fetched successfully',
      data: { ...profile, profilePhoto },
    };
  }

  async listProjectsForProfessional(
    slug: string,
    filters: DiscoverProjectsDto,
  ) {
    const profile = await this.repo.findApprovedProfileBySlug(slug);
    if (!profile) throw new NotFoundException('Professional not found');

    const { items, total } = await this.repo.findApprovedProjectsForProfile(
      profile.id,
      filters,
    );

    // Batch-load project photos (1 query for all projects on this page)
    const projectIds = items.map((p) => p.id);
    const photoLinks = await this.mediaRepo.findLinksByEntityIds(
      MediaEntityType.PROFESSIONAL_PROJECT,
      projectIds,
    );

    // Group by entityId (projectId), preserving sort order
    type ProjectPhotoLink = (typeof photoLinks)[number];
    const photosByProject = new Map<string, ProjectPhotoLink[]>();
    for (const link of photoLinks) {
      if (!photosByProject.has(link.entityId)) {
        photosByProject.set(link.entityId, []);
      }
      photosByProject.get(link.entityId)!.push(link);
    }

    const data = await Promise.all(
      items.map(async (project) => {
        const links = photosByProject.get(project.id) ?? [];
        const photos = await Promise.all(
          links.map((l) => this.mediaService.withUrls(l.media)),
        );
        return { ...project, photos };
      }),
    );

    return {
      message: 'Projects fetched successfully',
      data,
      meta: paginationMeta(filters.page, filters.limit, total),
    };
  }
}
