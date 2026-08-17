import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DashboardLoginDto } from './dto/dashboard-login.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { SendStepUpOtpDto, VerifyStepUpOtpDto } from './dto/step-up-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Register with email + password. Phone signup: OTP purpose REGISTER (send → verify).',
  })
  @ApiResponse({ status: 200, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Customer app login (CUSTOMER only). Exactly one of email or phone + password.',
  })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('dashboard/login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Dashboard login with email + password (VENDOR, PROFESSIONAL, ADMIN, SUPPORT, SUPER_ADMIN)',
  })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  dashboardLogin(@Body() dto: DashboardLoginDto) {
    return this.authService.dashboardLogin(dto);
  }

  @Public()
  @Post('otp/send')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Send phone OTP. Purposes: REGISTER (new phone), LOGIN / RESET_PASSWORD (existing user).',
  })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Public()
  @Post('otp/verify')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Verify OTP. REGISTER/LOGIN return session tokens; RESET_PASSWORD returns passwordResetToken only.',
  })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Public()
  @Post('password/reset')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Set a new password using passwordResetToken from OTP verify (RESET_PASSWORD)',
  })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('password/change')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password for the current user' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Post('step-up/send')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send OTP for a sensitive authenticated action' })
  sendStepUpOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendStepUpOtpDto,
  ) {
    return this.authService.sendStepUpOtp(user.userId, dto.purpose);
  }

  @Post('step-up/verify')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify sensitive-action OTP and receive a short-lived token',
  })
  verifyStepUpOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyStepUpOtpDto,
  ) {
    return this.authService.verifyStepUpOtp(user.userId, dto);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Tokens refreshed successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @Get('contexts')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List the single server-derived context for the current user',
  })
  listContexts(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listContexts(user.userId);
  }

  @Get('session')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Current auth session: user, activeContext, permissions, and flags',
  })
  getSession(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getSession(user);
  }
}
