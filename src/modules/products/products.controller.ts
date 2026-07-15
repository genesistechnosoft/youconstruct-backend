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
  UseGuards,
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
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles, UserRole } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
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

interface AuthUser {
  userId: string;
}

@ApiTags('Products')
@Public()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Browse active products' })
  browseProducts(@Query() filters: BrowseProductsDto) {
    return this.productsService.browseProducts(filters);
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR)
@ApiBearerAuth()
export class VendorProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List my products' })
  getMyProducts(
    @CurrentUser() user: AuthUser,
    @Query() filters: ProductFiltersDto,
  ) {
    return this.productsService.getMyProducts(user.userId, filters);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a product' })
  createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.productsService.createProduct(user.userId, dto);
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get my product detail' })
  getMyProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.getMyProduct(user.userId, id);
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a product' })
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a product' })
  deleteProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.deleteProduct(user.userId, id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit product for approval' })
  submitForApproval(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.submitForApproval(user.userId, id);
  }

  @Post(':id/gallery/upload')
  @HttpCode(200)
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
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.productsService.uploadProductGalleryMedia(
      user.userId,
      id,
      file,
    );
  }

  @Post(':id/gallery')
  @HttpCode(200)
  @ApiOperation({ summary: 'Link existing media to product gallery' })
  linkProductGalleryMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkMediaDto,
  ) {
    return this.productsService.linkProductGalleryMedia(user.userId, id, dto);
  }

  @Patch(':id/gallery/reorder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reorder product gallery media' })
  reorderProductGalleryMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderMediaLinksDto,
  ) {
    return this.productsService.reorderProductGalleryMedia(
      user.userId,
      id,
      dto,
    );
  }

  @Delete(':id/gallery/:mediaId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unlink media from product gallery' })
  unlinkProductGalleryMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.productsService.unlinkProductGalleryMedia(
      user.userId,
      id,
      mediaId,
    );
  }

  @Post(':id/variants')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add product variant' })
  addVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.productsService.addVariant(user.userId, id, dto);
  }

  @Patch(':id/variants/:variantId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update product variant' })
  updateVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productsService.updateVariant(user.userId, id, variantId, dto);
  }

  @Delete(':id/variants/:variantId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete product variant' })
  deleteVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.productsService.deleteVariant(user.userId, id, variantId);
  }

  @Patch(':id/variants/:variantId/inventory')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update product variant inventory' })
  updateInventory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.productsService.updateInventory(
      user.userId,
      id,
      variantId,
      dto,
    );
  }

  @Post(':id/variants/:variantId/attributes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set product variant attributes' })
  setVariantAttributes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: SetAttributesDto,
  ) {
    return this.productsService.setVariantAttributes(
      user.userId,
      id,
      variantId,
      dto,
    );
  }

  @Post(':id/variants/:variantId/gallery/upload')
  @HttpCode(200)
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
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.productsService.uploadVariantGalleryMedia(
      user.userId,
      id,
      variantId,
      file,
    );
  }

  @Post(':id/variants/:variantId/gallery')
  @HttpCode(200)
  @ApiOperation({ summary: 'Link existing media to variant gallery' })
  linkVariantGalleryMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: LinkMediaDto,
  ) {
    return this.productsService.linkVariantGalleryMedia(
      user.userId,
      id,
      variantId,
      dto,
    );
  }

  @Patch(':id/variants/:variantId/gallery/reorder')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reorder variant gallery media' })
  reorderVariantGalleryMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: ReorderMediaLinksDto,
  ) {
    return this.productsService.reorderVariantGalleryMedia(
      user.userId,
      id,
      variantId,
      dto,
    );
  }

  @Delete(':id/variants/:variantId/gallery/:mediaId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Unlink media from variant gallery' })
  unlinkVariantGalleryMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.productsService.unlinkVariantGalleryMedia(
      user.userId,
      id,
      variantId,
      mediaId,
    );
  }
}

@ApiTags('Admin - Products')
@Controller('admin/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
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
  approveProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.approveProduct(id);
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a product' })
  rejectProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProductDto,
  ) {
    return this.productsService.rejectProduct(id, dto);
  }
}
