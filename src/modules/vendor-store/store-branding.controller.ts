import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  Put,
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
import { memoryStorage } from 'multer';
import {
  MediaContext,
  PermissionScope,
} from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { requireVendorEntityId } from '../../common/utils/active-context.util';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { LinkSingleMediaDto } from './dto/link-single-media.dto';
import { VendorStoreService } from './vendor-store.service';

@ApiTags('Vendor - Store Branding')
@Controller('vendor/store')
@Roles(PlatformRole.VENDOR)
@RequireActiveContext(PermissionScope.VENDOR)
@ApiBearerAuth()
export class VendorStoreBrandingController {
  constructor(private readonly vendorStoreService: VendorStoreService) {}

  @Post('logo/upload')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.STORE_SETTINGS,
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
  @ApiOperation({ summary: 'Upload vendor store logo' })
  uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.vendorStoreService.uploadStoreBrandMedia(
      requireVendorEntityId(user),
      user.userId,
      MediaContext.LOGO,
      file,
    );
  }

  @Put('logo')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.STORE_SETTINGS,
    PERMISSIONS.VENDOR.MEDIA_UPLOAD,
  )
  @ApiOperation({ summary: 'Link existing media as store logo' })
  linkLogo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkSingleMediaDto,
  ) {
    return this.vendorStoreService.linkStoreBrandMedia(
      requireVendorEntityId(user),
      MediaContext.LOGO,
      dto.mediaId,
    );
  }

  @Delete('logo')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.STORE_SETTINGS)
  @ApiOperation({ summary: 'Remove store logo' })
  removeLogo(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorStoreService.clearStoreBrandMedia(
      requireVendorEntityId(user),
      MediaContext.LOGO,
    );
  }

  @Post('banner/upload')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.STORE_SETTINGS,
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
  @ApiOperation({ summary: 'Upload vendor store banner' })
  uploadBanner(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.vendorStoreService.uploadStoreBrandMedia(
      requireVendorEntityId(user),
      user.userId,
      MediaContext.BANNER,
      file,
    );
  }

  @Put('banner')
  @HttpCode(200)
  @Permissions(
    PERMISSIONS.VENDOR.STORE_SETTINGS,
    PERMISSIONS.VENDOR.MEDIA_UPLOAD,
  )
  @ApiOperation({ summary: 'Link existing media as store banner' })
  linkBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkSingleMediaDto,
  ) {
    return this.vendorStoreService.linkStoreBrandMedia(
      requireVendorEntityId(user),
      MediaContext.BANNER,
      dto.mediaId,
    );
  }

  @Delete('banner')
  @HttpCode(200)
  @Permissions(PERMISSIONS.VENDOR.STORE_SETTINGS)
  @ApiOperation({ summary: 'Remove store banner' })
  removeBanner(@CurrentUser() user: AuthenticatedUser) {
    return this.vendorStoreService.clearStoreBrandMedia(
      requireVendorEntityId(user),
      MediaContext.BANNER,
    );
  }
}
