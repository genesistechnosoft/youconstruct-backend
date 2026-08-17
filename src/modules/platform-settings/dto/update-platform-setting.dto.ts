import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

export class UpdatePlatformSettingDto {
  @ApiProperty({
    description: 'New setting value. Shape depends on the setting valueType.',
    examples: ['100.00', true, 30, ['AADHAAR', 'PAN', 'GST']],
  })
  @IsDefined()
  value!: unknown;
}
