import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { LinkMediaDto } from '../media/dto/link-media.dto';
import { ReorderMediaLinksDto } from '../media/dto/reorder-media-links.dto';
import { BrowseProductsDto } from './dto/browse-products.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ProductFiltersDto } from './dto/product-filters.dto';
import { RejectProductDto } from './dto/reject-product.dto';
import { SetAttributesDto } from './dto/set-attributes.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@Public()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Browse active products' })
  browseProducts(@Query() filters: BrowseProductsDto) {
    return this.productsService.browseProducts(filters);
  }

  @Get('by-slug/:slug')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get active product detail by slug' })
  getProductBySlug(@Param('slug') slug: string) {
    return this.productsService.getProductBySlug(slug);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get active product detail' })
  getProductDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getProductDetail(id);
  }
}

@ApiTags('Vendor - Products')
@Controller('vendor/products')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_VIEW)
  @ApiOperation({ summary: 'List my products' })
  getMyProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: ProductFiltersDto,
  ) {
    return this.productsService.getMyProducts(
      requireVendorEntityId(user),
      filters,
    );
  }

  @Post()
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_CREATE)
  @ApiOperation({ summary: 'Create a product' })
  createProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.createProduct(requireVendorEntityId(user), dto);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_VIEW)
  @ApiOperation({ summary: 'Get my product detail' })
  getMyProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.getMyProduct(requireVendorEntityId(user), id);
  }

  @Patch(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Update a product' })
  updateProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_DELETE)
  @ApiOperation({ summary: 'Delete a product' })
  deleteProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.deleteProduct(requireVendorEntityId(user), id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Submit product for approval' })
  submitForApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.submitForApproval(
      requireVendorEntityId(user),
      id,
    );
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Unpublish an active product' })
  unpublishProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.unpublishProduct(
      requireVendorEntityId(user),
      id,
    );
  }

  @Post(':id/gallery/upload')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.PRODUCTS_EDIT,
    PERMISSIONS.VENDOR.MEDIA_UPLOAD,
  )
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload and link product gallery media' })
  uploadProductGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.productsService.uploadProductGalleryMedia(
      requireVendorEntityId(user),
      user.userId,
      id,
      file,
    );
  }

  @Post(':id/gallery')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.PRODUCTS_EDIT,
    PERMISSIONS.VENDOR.MEDIA_UPLOAD,
  )
  @ApiOperation({ summary: 'Link existing media to product gallery' })
  linkProductGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkMediaDto,
  ) {
    return this.productsService.linkProductGalleryMedia(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Patch(':id/gallery/reorder')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Reorder product gallery media' })
  reorderProductGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderMediaLinksDto,
  ) {
    return this.productsService.reorderProductGalleryMedia(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Delete(':id/gallery/:mediaId')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Unlink media from product gallery' })
  unlinkProductGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.productsService.unlinkProductGalleryMedia(
      requireVendorEntityId(user),
      id,
      mediaId,
    );
  }

  @Post(':id/variants')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Add product variant' })
  addVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.productsService.addVariant(
      requireVendorEntityId(user),
      id,
      dto,
    );
  }

  @Patch(':id/variants/:variantId')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Update product variant' })
  updateVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productsService.updateVariant(
      requireVendorEntityId(user),
      id,
      variantId,
      dto,
    );
  }

  @Delete(':id/variants/:variantId')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_DELETE)
  @ApiOperation({ summary: 'Delete product variant' })
  deleteVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.productsService.deleteVariant(
      requireVendorEntityId(user),
      id,
      variantId,
    );
  }

  @Patch(':id/variants/:variantId/inventory')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Update product variant inventory' })
  updateInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.productsService.updateInventory(
      requireVendorEntityId(user),
      id,
      variantId,
      dto,
    );
  }

  @Post(':id/variants/:variantId/attributes')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Set product variant attributes' })
  setVariantAttributes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: SetAttributesDto,
  ) {
    return this.productsService.setVariantAttributes(
      requireVendorEntityId(user),
      id,
      variantId,
      dto,
    );
  }

  @Post(':id/variants/:variantId/gallery/upload')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.PRODUCTS_EDIT,
    PERMISSIONS.VENDOR.MEDIA_UPLOAD,
  )
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload and link variant gallery media' })
  uploadVariantGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.productsService.uploadVariantGalleryMedia(
      requireVendorEntityId(user),
      user.userId,
      id,
      variantId,
      file,
    );
  }

  @Post(':id/variants/:variantId/gallery')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.PRODUCTS_EDIT,
    PERMISSIONS.VENDOR.MEDIA_UPLOAD,
  )
  @ApiOperation({ summary: 'Link existing media to variant gallery' })
  linkVariantGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: LinkMediaDto,
  ) {
    return this.productsService.linkVariantGalleryMedia(
      requireVendorEntityId(user),
      id,
      variantId,
      dto,
    );
  }

  @Patch(':id/variants/:variantId/gallery/reorder')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Reorder variant gallery media' })
  reorderVariantGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: ReorderMediaLinksDto,
  ) {
    return this.productsService.reorderVariantGalleryMedia(
      requireVendorEntityId(user),
      id,
      variantId,
      dto,
    );
  }

  @Delete(':id/variants/:variantId/gallery/:mediaId')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Unlink media from variant gallery' })
  unlinkVariantGalleryMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.productsService.unlinkVariantGalleryMedia(
      requireVendorEntityId(user),
      id,
      variantId,
      mediaId,
    );
  }
}

@ApiTags('Admin - Products')
@Controller('admin/products')
@Roles(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@RequireActiveContext(PermissionScope.ADMIN)
@Permissions(PERMISSIONS.ADMIN.CATALOG_MANAGE)
@ApiBearerAuth()
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List all products' })
  getAllProducts(@Query() filters: ProductFiltersDto) {
    return this.productsService.getAllProducts(filters);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a product by ID for review' })
  getAdminProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getAdminProduct(id);
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a product' })
  approveProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.approveProduct(id, user.userId);
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a product' })
  rejectProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProductDto,
  ) {
    return this.productsService.rejectProduct(id, user.userId, dto);
  }

  @Post(':id/approve-content')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve staged content changes on an active product',
  })
  approveContentReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.approveContentReview(id, user.userId);
  }

  @Post(':id/reject-content')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject staged content changes on an active product',
  })
  rejectContentReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProductDto,
  ) {
    return this.productsService.rejectContentReview(id, user.userId, dto);
  }
}
