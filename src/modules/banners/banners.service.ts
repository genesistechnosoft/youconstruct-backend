import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaContext,
  MediaEntityType,
} from '../../../generated/prisma/client.js';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { MediaService } from '../media/media.service';
import { BannersRepository } from './banners.repository';
import { CreateBannerDto } from './dto/create-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

type BannerBase = {
  id: string;
  title: string;
  subtitle: string | null;
  targetUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class BannersService {
  constructor(
    private readonly bannersRepository: BannersRepository,
    private readonly mediaService: MediaService,
  ) {}

  async findPublic() {
    const banners = await this.bannersRepository.findPublicActive(new Date());
    const data = await this.withBannerMedia(banners);
    return { message: 'Banners fetched successfully', data };
  }

  async findAllAdmin(page = 1, limit = 20) {
    const { skip, take } = paginate(page, limit);
    const [banners, total] = await Promise.all([
      this.bannersRepository.findAllAdmin(skip, take),
      this.bannersRepository.countAllAdmin(),
    ]);

    const data = await this.withBannerMedia(banners);

    return {
      message: 'Banners fetched successfully',
      data,
      meta: paginationMeta(page, limit, total),
    };
  }

  async findById(id: string) {
    const banner = await this.bannersRepository.findById(id);
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }

    const [enriched] = await this.withBannerMedia([banner]);
    return {
      message: 'Banner fetched successfully',
      data: enriched,
    };
  }

  async create(
    dto: CreateBannerDto,
    userId: string,
    webImage?: Express.Multer.File,
    appImage?: Express.Multer.File,
  ) {
    if (!webImage && !appImage) {
      throw new BadRequestException(
        'At least one of webImage or appImage must be provided',
      );
    }

    this.assertValidSchedule(dto.startsAt, dto.endsAt);

    const banner = await this.bannersRepository.create({
      title: dto.title,
      ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
      ...(dto.targetUrl !== undefined && { targetUrl: dto.targetUrl }),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
      ...(dto.startsAt !== undefined && { startsAt: new Date(dto.startsAt) }),
      ...(dto.endsAt !== undefined && { endsAt: new Date(dto.endsAt) }),
      createdBy: { connect: { id: userId } },
      updatedBy: { connect: { id: userId } },
    });

    await Promise.all([
      webImage
        ? this.mediaService.uploadAdminEntityMedia(
            userId,
            webImage,
            MediaEntityType.HOMEPAGE_BANNER,
            banner.id,
            MediaContext.BANNER_WEB,
            `admin/banners/${banner.id}/web`,
          )
        : Promise.resolve(),
      appImage
        ? this.mediaService.uploadAdminEntityMedia(
            userId,
            appImage,
            MediaEntityType.HOMEPAGE_BANNER,
            banner.id,
            MediaContext.BANNER_APP,
            `admin/banners/${banner.id}/app`,
          )
        : Promise.resolve(),
    ]);

    const [enriched] = await this.withBannerMedia([banner]);
    return {
      message: 'Banner created successfully',
      data: enriched,
    };
  }

  async update(
    id: string,
    dto: UpdateBannerDto,
    userId: string,
    webImage?: Express.Multer.File,
    appImage?: Express.Multer.File,
  ) {
    const existing = await this.bannersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Banner not found');
    }

    const startsAt =
      dto.startsAt !== undefined
        ? dto.startsAt
        : existing.startsAt?.toISOString();
    const endsAt =
      dto.endsAt !== undefined ? dto.endsAt : existing.endsAt?.toISOString();
    this.assertValidSchedule(startsAt, endsAt);

    const banner = await this.bannersRepository.update(id, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
      ...(dto.targetUrl !== undefined && { targetUrl: dto.targetUrl }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.startsAt !== undefined && {
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      }),
      ...(dto.endsAt !== undefined && {
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      }),
      updatedBy: { connect: { id: userId } },
    });

    await Promise.all([
      webImage
        ? this.mediaService.uploadAdminEntityMedia(
            userId,
            webImage,
            MediaEntityType.HOMEPAGE_BANNER,
            id,
            MediaContext.BANNER_WEB,
            `admin/banners/${id}/web`,
          )
        : Promise.resolve(),
      appImage
        ? this.mediaService.uploadAdminEntityMedia(
            userId,
            appImage,
            MediaEntityType.HOMEPAGE_BANNER,
            id,
            MediaContext.BANNER_APP,
            `admin/banners/${id}/app`,
          )
        : Promise.resolve(),
    ]);

    const [enriched] = await this.withBannerMedia([banner]);
    return {
      message: 'Banner updated successfully',
      data: enriched,
    };
  }

  async activate(id: string, userId: string) {
    const existing = await this.bannersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Banner not found');
    }

    const banner = await this.bannersRepository.update(id, {
      isActive: true,
      updatedBy: { connect: { id: userId } },
    });

    const [enriched] = await this.withBannerMedia([banner]);
    return {
      message: 'Banner activated successfully',
      data: enriched,
    };
  }

  async deactivate(id: string, userId: string) {
    const existing = await this.bannersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Banner not found');
    }

    const banner = await this.bannersRepository.update(id, {
      isActive: false,
      updatedBy: { connect: { id: userId } },
    });

    const [enriched] = await this.withBannerMedia([banner]);
    return {
      message: 'Banner deactivated successfully',
      data: enriched,
    };
  }

  async reorder(dto: ReorderBannersDto) {
    const existing = await this.bannersRepository.findAllIds();
    const existingIds = new Set(existing.map((b) => b.id));
    const orderedIds = new Set(dto.orderedIds);

    if (
      existingIds.size !== orderedIds.size ||
      [...existingIds].some((id) => !orderedIds.has(id))
    ) {
      throw new BadRequestException(
        'orderedIds must include every non-deleted banner exactly once',
      );
    }

    const banners = await this.bannersRepository.reorder(dto.orderedIds);
    const data = await this.withBannerMedia(banners);
    return { message: 'Banners reordered successfully', data };
  }

  async remove(id: string) {
    const existing = await this.bannersRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Banner not found');
    }

    await this.bannersRepository.softDelete(id);
    return { message: 'Banner deleted successfully', data: null };
  }

  private assertValidSchedule(
    startsAt?: string | null,
    endsAt?: string | null,
  ) {
    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      throw new BadRequestException(
        'endsAt must be greater than or equal to startsAt',
      );
    }
  }

  private async withBannerMedia<T extends BannerBase>(banners: T[]) {
    if (banners.length === 0) return [];

    const ids = banners.map((b) => b.id);
    const [webMap, appMap] = await Promise.all([
      this.mediaService.getContextMediaForEntities(
        MediaEntityType.HOMEPAGE_BANNER,
        ids,
        MediaContext.BANNER_WEB,
      ),
      this.mediaService.getContextMediaForEntities(
        MediaEntityType.HOMEPAGE_BANNER,
        ids,
        MediaContext.BANNER_APP,
      ),
    ]);

    return banners.map((banner) => ({
      ...banner,
      webMedia: webMap.get(banner.id) ?? null,
      appMedia: appMap.get(banner.id) ?? null,
    }));
  }
}
