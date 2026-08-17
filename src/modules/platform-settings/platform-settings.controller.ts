import { Body, Controller, Get, HttpCode, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdatePlatformSettingDto } from './dto/update-platform-setting.dto';

@ApiTags('Super Admin - Platform Settings')
@ApiBearerAuth()
@Roles(PlatformRole.SUPER_ADMIN)
@Controller('admin/platform-settings')
export class PlatformSettingsController {
  constructor(
    private readonly platformSettingsService: PlatformSettingsService,
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List platform settings' })
  list() {
    return this.platformSettingsService.listSettings();
  }

  @Patch(':namespace/:key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a platform setting' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('namespace') namespace: string,
    @Param('key') key: string,
    @Body() dto: UpdatePlatformSettingDto,
  ) {
    return this.platformSettingsService.updateSetting(
      user,
      namespace,
      key,
      dto,
    );
  }
}
