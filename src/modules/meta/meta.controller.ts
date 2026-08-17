import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { MetaEnumsResponseDto } from './dto/meta-enums-response.dto';
import { MetaService } from './meta.service';

@ApiTags('Meta')
@Public()
@Controller('meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Get('enums')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get frontend enum metadata' })
  @ApiOkResponse({ type: MetaEnumsResponseDto })
  getEnums() {
    return this.metaService.getEnums();
  }
}
