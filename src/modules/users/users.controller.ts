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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole, Roles } from '../../common/decorators/roles.decorator';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Roles(PlatformRole.CUSTOMER)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: { userId: string }) {
    return this.usersService.getMe(user.userId);
  }

  @Patch('me')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update current user profile' })
  updateMe(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateMe(user.userId, dto);
  }

  @Get('me/addresses')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get current user addresses' })
  getAddresses(@CurrentUser() user: { userId: string }) {
    return this.usersService.getAddresses(user.userId);
  }

  @Post('me/addresses')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a new address' })
  addAddress(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAddressDto,
  ) {
    return this.usersService.addAddress(user.userId, dto);
  }

  @Patch('me/addresses/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an address' })
  updateAddress(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.usersService.updateAddress(user.userId, id, dto);
  }

  @Delete('me/addresses/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete an address' })
  deleteAddress(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.deleteAddress(user.userId, id);
  }
}
