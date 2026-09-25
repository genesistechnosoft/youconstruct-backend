import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaContext,
  MediaEntityType,
  MediaProcessingStatus,
} from '../../../generated/prisma/client.js';
import { RedisCacheService } from '../../common/redis/redis-cache.service';
import {
  CATEGORY_TREE_CACHE_KEY,
  CATEGORY_TREE_CACHE_TTL_SECONDS,
  CATEGORY_TREE_METRIC_HIT,
  CATEGORY_TREE_METRIC_INVALIDATE,
  CATEGORY_TREE_METRIC_MISS,
  VISIBLE_CATEGORY_IDS_CACHE_KEY,
} from '../../common/redis/redis.constants';
import { paginate, paginationMeta } from '../../common/utils/pagination.util';
import { generateSlug } from '../../common/utils/slug.util';
import { MediaService } from '../media/media.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoriesRepository } from './categories.repository';

type CategoryImage = {
  mediaId: string;
  processingStatus: MediaProcessingStatus;
  originalUrl: string;
  optimizedUrl: string | null;
  thumbnailUrl: string | null;
} | null;

type CategoryNode = {
  id: string;
  children?: CategoryNode[];
};

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly categoriesRepository: CategoriesRepository,
    private readonly redisCacheService: RedisCacheService,
    private readonly mediaService: MediaService,
  ) {}

  async getTree() {
    const cached = await this.redisCacheService.getJson<
      Awaited<ReturnType<CategoriesService['loadPublicTree']>>
    >(CATEGORY_TREE_CACHE_KEY);

    if (cached) {
      this.logger.log(
        `category_tree_cache event=hit key=${CATEGORY_TREE_CACHE_KEY}`,
      );
      void this.redisCacheService.incr(CATEGORY_TREE_METRIC_HIT);
      return { message: 'Categories fetched successfully', data: cached };
    }

    this.logger.log(
      `category_tree_cache event=miss key=${CATEGORY_TREE_CACHE_KEY}`,
    );
    void this.redisCacheService.incr(CATEGORY_TREE_METRIC_MISS);

    const categories = await this.loadPublicTree();
    await this.redisCacheService.setJson(
      CATEGORY_TREE_CACHE_KEY,
      categories,
      CATEGORY_TREE_CACHE_TTL_SECONDS,
    );

    return { message: 'Categories fetched successfully', data: categories };
  }

  async findBySlug(slug: string) {
    const category = await this.categoriesRepository.findPublicBySlug(slug);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const visibleIds = await this.getVisibleCategoryIds();
    if (!visibleIds.includes(category.id)) {
      throw new NotFoundException('Category not found');
    }

    return {
      message: 'Category fetched successfully',
      data: await this.withImages(category),
    };
  }

  async listPublicParents() {
    const { data } = await this.getTree();
    return data.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      image: category.image,
    }));
  }

  async findById(id: string) {
    const category = await this.categoriesRepository.findActiveById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const visibleIds = await this.getVisibleCategoryIds();
    if (!visibleIds.includes(id)) {
      throw new NotFoundException('Category not found');
    }

    return {
      message: 'Category fetched successfully',
      data: await this.withImages(category),
    };
  }

  async findAllAdmin(page = 1, limit = 20) {
    const { skip, take } = paginate(page, limit);
    const [categories, total] = await Promise.all([
      this.categoriesRepository.findAllAdmin(skip, take),
      this.categoriesRepository.countAllAdmin(),
    ]);

    return {
      message: 'Categories fetched successfully',
      data: await this.withImagesList(categories),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getTreeAdmin() {
    const categories = await this.categoriesRepository.findRootsAdmin();
    return {
      message: 'Categories fetched successfully',
      data: await this.withImagesList(categories),
    };
  }

  async findByIdAdmin(id: string) {
    const category = await this.categoriesRepository.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return {
      message: 'Category fetched successfully',
      data: await this.withImages(category),
    };
  }

  async create(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.categoriesRepository.findActiveById(
        dto.parentId,
      );
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
    }

    const slug = dto.slug ?? generateSlug(dto.name);
    const existingSlug = await this.categoriesRepository.findBySlug(slug);
    if (existingSlug) {
      throw new ConflictException('Category slug already exists');
    }

    const sortOrder =
      dto.sortOrder ??
      (await this.categoriesRepository.findNextSortOrder(dto.parentId ?? null));

    const category = await this.categoriesRepository.create({
      name: dto.name,
      slug,
      ...(dto.parentId && { parent: { connect: { id: dto.parentId } } }),
      ...(dto.description !== undefined && { description: dto.description }),
      isActive: dto.isActive ?? true,
      sortOrder,
    });

    await this.invalidateTreeCache();
    return {
      message: 'Category created successfully',
      data: await this.withImages(category),
    };
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('Category cannot be its own parent');
      }

      if (dto.parentId) {
        const parent = await this.categoriesRepository.findActiveById(
          dto.parentId,
        );
        if (!parent) {
          throw new NotFoundException('Parent category not found');
        }
        await this.assertNoCategoryCycle(id, dto.parentId);
      }
    }

    if (dto.slug !== undefined) {
      const existingSlug = await this.categoriesRepository.findBySlug(
        dto.slug,
        id,
      );
      if (existingSlug) {
        throw new ConflictException('Category slug already exists');
      }
    }

    const parentChanging =
      dto.parentId !== undefined && dto.parentId !== existing.parentId;
    const sortOrder =
      dto.sortOrder !== undefined
        ? dto.sortOrder
        : parentChanging
          ? await this.categoriesRepository.findNextSortOrder(
              dto.parentId ?? null,
              id,
            )
          : undefined;

    const category = await this.categoriesRepository.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.slug !== undefined && { slug: dto.slug }),
      ...(dto.parentId !== undefined && {
        parent: dto.parentId
          ? { connect: { id: dto.parentId } }
          : { disconnect: true },
      }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(sortOrder !== undefined && { sortOrder }),
    });

    await this.invalidateTreeCache();
    return {
      message: 'Category updated successfully',
      data: await this.withImages(category),
    };
  }

  async reorder(dto: ReorderCategoriesDto) {
    const parentId = dto.parentId ?? null;

    if (parentId) {
      const parent = await this.categoriesRepository.findById(parentId);
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
    }

    const siblings = await this.categoriesRepository.findSiblingIds(parentId);
    const siblingIds = new Set(siblings.map((sibling) => sibling.id));
    const orderedIds = new Set(dto.orderedIds);

    if (
      siblingIds.size !== orderedIds.size ||
      [...siblingIds].some((id) => !orderedIds.has(id))
    ) {
      throw new BadRequestException(
        'orderedIds must include every sibling of this parent',
      );
    }

    const categories = await this.categoriesRepository.reorderSiblings(
      parentId,
      dto.orderedIds,
    );
    await this.invalidateTreeCache();

    return {
      message: 'Categories reordered successfully',
      data: await this.withImagesList(categories),
    };
  }

  async activate(id: string) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    const category = await this.categoriesRepository.update(id, {
      isActive: true,
    });

    await this.invalidateTreeCache();
    return {
      message: 'Category activated successfully',
      data: await this.withImages(category),
    };
  }

  async deactivate(id: string) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    const category = await this.categoriesRepository.update(id, {
      isActive: false,
    });

    await this.invalidateTreeCache();
    return {
      message: 'Category deactivated successfully',
      data: await this.withImages(category),
    };
  }

  async remove(id: string) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    await this.assertCategoryCanBeDeleted(id);

    await this.categoriesRepository.softDelete(id);
    await this.invalidateTreeCache();
    return { message: 'Category deleted successfully', data: null };
  }

  async uploadImage(
    id: string,
    actorUserId: string,
    file: Express.Multer.File | undefined,
  ) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    const result = await this.mediaService.uploadAdminEntityMedia(
      actorUserId,
      file,
      MediaEntityType.CATEGORY,
      id,
      MediaContext.CATEGORY_IMAGE,
      `admin/categories/${id}`,
    );
    await this.invalidateTreeCache();
    return result;
  }

  async removeImage(id: string) {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    const result = await this.mediaService.clearEntityMediaContextAndDelete(
      MediaEntityType.CATEGORY,
      id,
      MediaContext.CATEGORY_IMAGE,
    );
    await this.invalidateTreeCache();
    return result;
  }

  private async loadPublicTree() {
    const categories = await this.categoriesRepository.findRoots();
    return this.withImagesList(categories);
  }

  private async withImages<T extends CategoryNode>(category: T) {
    const [withImage] = await this.withImagesList([category]);
    return withImage;
  }

  private async withImagesList<T extends CategoryNode>(categories: T[]) {
    const ids: string[] = [];
    const collectIds = (node: CategoryNode) => {
      ids.push(node.id);
      node.children?.forEach(collectIds);
    };
    categories.forEach(collectIds);

    const images = await this.mediaService.getContextMediaForEntities(
      MediaEntityType.CATEGORY,
      ids,
      MediaContext.CATEGORY_IMAGE,
    );

    const attach = <N extends CategoryNode>(
      node: N,
    ): N & { image: CategoryImage } => ({
      ...node,
      image: images.get(node.id) ?? null,
      ...(node.children
        ? { children: node.children.map((child) => attach(child)) }
        : {}),
    });

    return categories.map((category) => attach(category));
  }

  async getVisibleCategoryIds(): Promise<string[]> {
    const cached = await this.redisCacheService.getJson<string[]>(
      VISIBLE_CATEGORY_IDS_CACHE_KEY,
    );
    if (cached) return cached;

    const nodes = await this.categoriesRepository.findAllForVisibility();
    const map = new Map(nodes.map((n) => [n.id, n]));
    const ids: string[] = [];

    for (const node of nodes) {
      if (!node.isActive) continue;
      let cur: (typeof nodes)[number] | undefined = node;
      let visible = true;
      while (cur) {
        if (!cur.isActive) {
          visible = false;
          break;
        }
        cur = cur.parentId ? map.get(cur.parentId) : undefined;
      }
      if (visible) ids.push(node.id);
    }

    await this.redisCacheService.setJson(
      VISIBLE_CATEGORY_IDS_CACHE_KEY,
      ids,
      CATEGORY_TREE_CACHE_TTL_SECONDS,
    );
    return ids;
  }

  private async invalidateTreeCache() {
    await Promise.all([
      this.redisCacheService.del(CATEGORY_TREE_CACHE_KEY),
      this.redisCacheService.del(VISIBLE_CATEGORY_IDS_CACHE_KEY),
    ]);
    this.logger.log(
      `category_tree_cache event=invalidate key=${CATEGORY_TREE_CACHE_KEY}`,
    );
    void this.redisCacheService.incr(CATEGORY_TREE_METRIC_INVALIDATE);

    const stillPresent = await this.redisCacheService.exists(
      CATEGORY_TREE_CACHE_KEY,
    );
    if (stillPresent) {
      this.logger.warn(
        `category_tree_cache event=invalidate_stale key=${CATEGORY_TREE_CACHE_KEY}`,
      );
    }
  }

  private async assertNoCategoryCycle(categoryId: string, parentId: string) {
    let currentParentId: string | null = parentId;

    while (currentParentId) {
      if (currentParentId === categoryId) {
        throw new BadRequestException(
          'Circular category hierarchy not allowed',
        );
      }

      const parent =
        await this.categoriesRepository.findParentLink(currentParentId);
      currentParentId = parent?.parentId ?? null;
    }
  }

  private async assertCategoryCanBeDeleted(id: string) {
    const [anyChildren, activeProducts] = await Promise.all([
      this.categoriesRepository.countAnyChildren(id),
      this.categoriesRepository.countActiveProducts(id),
    ]);

    if (anyChildren > 0) {
      throw new BadRequestException(
        'Category has subcategories and cannot be deleted',
      );
    }

    if (activeProducts > 0) {
      throw new BadRequestException(
        'Category has active products and cannot be deleted',
      );
    }
  }
}
