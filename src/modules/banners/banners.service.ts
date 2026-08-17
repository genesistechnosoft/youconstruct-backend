import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { MediaService } from '../media/media.service';
import { BannersRepository } from './banners.repository';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService {
  constructor(
    private readonly bannersRepository: BannersRepository,
    private readonly mediaService: MediaService,
  ) {}

  async findPublic() {
    const banners = await this.bannersRepository.findPublicActive(new Date());
    const data = await Promise.all(
      banners.map((banner) => this.withMediaUrls(banner)),
    );
    return { message: 'Banners fetched successfully', data };
  }

  async findAllAdmin(page = 1, limit = 20) {
    const { skip, take } = paginate(page, limit);
    const [banners, total] = await Promise.all([
      this.bannersRepository.findAllAdmin(skip, take),
      this.bannersRepository.countAllAdmin(),
    ]);

    const data = await Promise.all(
      banners.map((banner) => this.withMediaUrls(banner)),
    );

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

    return {
      message: 'Banner fetched successfully',
      data: await this.withMediaUrls(banner),
    };
  }

  async create(dto: CreateBannerDto, userId: string) {
    this.assertValidSchedule(dto.startsAt, dto.endsAt);
    await this.assertReadyMedia(dto.mediaId);

    const banner = await this.bannersRepository.create({
      title: dto.title,
      ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
      ...(dto.mediaId && { media: { connect: { id: dto.mediaId } } }),
      ...(dto.targetUrl !== undefined && { targetUrl: dto.targetUrl }),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
      ...(dto.startsAt !== undefined && { startsAt: new Date(dto.startsAt) }),
      ...(dto.endsAt !== undefined && { endsAt: new Date(dto.endsAt) }),
      createdBy: { connect: { id: userId } },
      updatedBy: { connect: { id: userId } },
    });

    return {
      message: 'Banner created successfully',
      data: await this.withMediaUrls(banner),
    };
  }

  async update(id: string, dto: UpdateBannerDto, userId: string) {
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
    await this.assertReadyMedia(dto.mediaId);

    const banner = await this.bannersRepository.update(id, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
      ...(dto.mediaId !== undefined && {
        media: dto.mediaId
          ? { connect: { id: dto.mediaId } }
          : { disconnect: true },
      }),
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

    return {
      message: 'Banner updated successfully',
      data: await this.withMediaUrls(banner),
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

    return {
      message: 'Banner activated successfully',
      data: await this.withMediaUrls(banner),
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

    return {
      message: 'Banner deactivated successfully',
      data: await this.withMediaUrls(banner),
    };
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

  private async assertReadyMedia(mediaId?: string) {
    if (!mediaId) {
      return;
    }

    const media = await this.bannersRepository.findReadyMediaById(mediaId);
    if (!media) {
      throw new BadRequestException(
        'Media not found, deleted, or not ready for use',
      );
    }
  }

  private async withMediaUrls<
    T extends {
      media: Parameters<MediaService['withUrls']>[0] | null;
    },
  >(banner: T) {
    if (!banner.media) {
      return banner;
    }

    return {
      ...banner,
      media: await this.mediaService.withUrls(banner.media),
    };
  }
}
