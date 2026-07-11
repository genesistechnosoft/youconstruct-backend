import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { UnitsService } from './units.service';

@ApiTags('Units')
@Public()
@Controller('units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List all active units' })
  findAll() {
    return this.unitsService.findAll();
  }

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a unit by ID' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitsService.findById(id);
  }
}
