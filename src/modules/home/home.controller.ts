import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { HomeService } from './home.service';

@ApiTags('Home')
@Public()
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Public homepage payload' })
  getHome() {
    return this.homeService.getHome();
  }
}
