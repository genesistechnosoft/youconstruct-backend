import { Global, Module } from '@nestjs/common';
import { CommerceOtpRepository } from './commerce-otp.repository';
import { CommerceOtpService } from './commerce-otp.service';

@Global()
@Module({
  providers: [CommerceOtpRepository, CommerceOtpService],
  exports: [CommerceOtpService],
})
export class CommerceOtpModule {}
