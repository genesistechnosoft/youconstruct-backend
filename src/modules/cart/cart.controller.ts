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
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { ShippingQuoteDto } from './dto/shipping-quote.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('Customer - Cart')
@ApiBearerAuth()
@Roles(PlatformRole.CUSTOMER)
@Controller('customer/cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Get current cart' })
  getCart(@CurrentUser() user: { userId: string }) {
    return this.cartService.getCart(user.userId);
  }

  @Post('items')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add item to cart' })
  addItem(
    @CurrentUser() user: { userId: string },
    @Body() dto: AddCartItemDto,
  ) {
    return this.cartService.addItem(user.userId, dto);
  }

  @Patch('items/:variantId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update cart item quantity' })
  updateItem(
    @CurrentUser() user: { userId: string },
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.userId, variantId, dto);
  }

  @Delete('items/:variantId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove cart item' })
  removeItem(
    @CurrentUser() user: { userId: string },
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.cartService.removeItem(user.userId, variantId);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear cart' })
  clearCart(@CurrentUser() user: { userId: string }) {
    return this.cartService.clearCart(user.userId);
  }

  @Post('shipping-quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get shipping quote for cart' })
  shippingQuote(
    @CurrentUser() user: { userId: string },
    @Body() dto: ShippingQuoteDto,
  ) {
    return this.cartService.shippingQuote(user.userId, dto.addressId);
  }
}
