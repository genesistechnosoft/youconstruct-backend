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
  Put,
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
import { memoryStorage } from 'multer';
import { PermissionScope } from '../../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequireActiveContext } from '../../common/decorators/require-active-context.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { requireProfessionalEntityId } from '../../common/utils/active-context.util';
import { ReorderMediaLinksDto } from '../media/dto/reorder-media-links.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectFiltersDto } from './dto/project-filters.dto';
import { RejectProjectDto, RemoveProjectDto } from './dto/moderate-project.dto';
import { ProfessionalProjectsService } from './professional-projects.service';

// ── Professional — Projects ───────────────────────────────────────────────────

@ApiTags('Professional - Projects')
@Controller('professional/projects')
@Roles(PlatformRole.PROFESSIONAL)
@RequireActiveContext(PermissionScope.PROFESSIONAL)
@ApiBearerAuth()
export class ProfessionalProjectsController {
  constructor(private readonly service: ProfessionalProjectsService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_VIEW)
  @ApiOperation({ summary: 'List my portfolio projects' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: ProjectFiltersDto,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.listMyProjects(profileId, filters);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_VIEW)
  @ApiOperation({ summary: 'Get a specific project' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.getMyProject(profileId, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_CREATE)
  @ApiOperation({ summary: 'Create a new portfolio project' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.createProject(profileId, dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_EDIT)
  @ApiOperation({
    summary: 'Update a project',
    description:
      'Editing an APPROVED project moves it back to PENDING_APPROVAL.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.updateProject(profileId, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_EDIT)
  @ApiOperation({ summary: 'Submit a project for admin review' })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.submitProject(profileId, id);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_EDIT)
  @ApiOperation({
    summary: 'Withdraw a submitted project back to DRAFT',
    description:
      'Only PENDING_APPROVAL projects can be withdrawn. REMOVED projects cannot be withdrawn.',
  })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.withdrawProject(profileId, id);
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_DELETE)
  @ApiOperation({
    summary: 'Soft-delete a project (not allowed for REMOVED projects)',
  })
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.deleteMyProject(profileId, id);
  }

  @Post(':id/photos')
  @HttpCode(201)
  @Permissions(PERMISSIONS.PROFESSIONAL.MEDIA_UPLOAD)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload a photo to a project' })
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.uploadProjectPhoto(user.userId, profileId, id, file);
  }

  @Delete(':id/photos/:mediaId')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.MEDIA_DELETE)
  @ApiOperation({ summary: 'Remove a photo from a project' })
  deletePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.deleteProjectPhoto(profileId, id, mediaId);
  }

  @Put(':id/photos')
  @HttpCode(200)
  @Permissions(PERMISSIONS.PROFESSIONAL.PORTFOLIO_EDIT)
  @ApiOperation({ summary: 'Reorder photos for a project' })
  reorderPhotos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderMediaLinksDto,
  ) {
    const profileId = requireProfessionalEntityId(user);
    return this.service.reorderProjectPhotos(profileId, id, dto);
  }
}

// ── Admin — Project moderation ────────────────────────────────────────────────

@ApiTags('Admin - Professional Projects')
@Controller('admin/professional-projects')
@Roles(PlatformRole.ADMIN)
@RequireActiveContext(PermissionScope.ADMIN)
@ApiBearerAuth()
export class AdminProjectsController {
  constructor(private readonly service: ProfessionalProjectsService) {}

  @Get()
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CONTENT_VIEW)
  @ApiOperation({ summary: 'List all projects across professionals (admin)' })
  list(@Query() filters: ProjectFiltersDto) {
    return this.service.listForAdmin(filters);
  }

  @Get(':id')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CONTENT_VIEW)
  @ApiOperation({ summary: 'Get project details (admin)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getForAdmin(id);
  }

  @Patch(':id/approve')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CONTENT_MODERATE)
  @ApiOperation({ summary: 'Approve a pending project' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approveProject(id, user.userId);
  }

  @Patch(':id/reject')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CONTENT_MODERATE)
  @ApiOperation({ summary: 'Reject a pending project' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProjectDto,
  ) {
    return this.service.rejectProject(id, user.userId, dto);
  }

  @Patch(':id/remove')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_PROFESSIONAL.PROFESSIONAL_CONTENT_MODERATE)
  @ApiOperation({
    summary: 'Permanently remove a project (terminal state + media purge)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveProjectDto,
  ) {
    return this.service.removeProject(id, user.userId, dto);
  }
}
