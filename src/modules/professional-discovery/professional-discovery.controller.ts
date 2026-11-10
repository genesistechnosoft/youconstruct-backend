import { Controller, Get, HttpCode, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  DiscoverProfessionalsDto,
  DiscoverProjectsDto,
} from './dto/discovery-query.dto';
import { ProfessionalDiscoveryService } from './professional-discovery.service';

@ApiTags('Public - Professional Discovery')
@Controller('professionals')
@Public()
export class ProfessionalDiscoveryController {
  constructor(private readonly service: ProfessionalDiscoveryService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Discover approved professionals',
    description:
      'Public list of approved professionals. Filter by category slug or search by display name. ' +
      'No PII — phone, email, and userId are never returned.',
  })
  list(@Query() filters: DiscoverProfessionalsDto) {
    return this.service.listProfessionals(filters);
  }

  @Get(':slug')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a professional profile by slug',
    description:
      'Returns the public professional profile. Only APPROVED profiles are returned. ' +
      'No PII — only displayName, bio, city, state, categories, etc.',
  })
  getBySlug(@Param('slug') slug: string) {
    return this.service.getProfessionalBySlug(slug);
  }

  @Get(':slug/projects')
  @HttpCode(200)
  @ApiOperation({
    summary: 'List approved portfolio projects for a professional',
    description:
      'Returns only APPROVED projects for the given professional slug. Paginated.',
  })
  listProjects(
    @Param('slug') slug: string,
    @Query() filters: DiscoverProjectsDto,
  ) {
    return this.service.listProjectsForProfessional(slug, filters);
  }
}
