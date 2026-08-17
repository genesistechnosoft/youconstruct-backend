import { ApiProperty } from '@nestjs/swagger';

export class MetaEnumOptionDto {
  @ApiProperty({ example: 'ACTIVE' })
  value!: string;

  @ApiProperty({ example: 'Active' })
  label!: string;
}

export class MetaPermissionOptionDto {
  @ApiProperty({ example: 'vendors:view' })
  value!: string;

  @ApiProperty({ example: 'View Vendors' })
  label!: string;

  @ApiProperty({ example: 'ADMIN' })
  scope!: string;

  @ApiProperty({ example: 'Vendors' })
  group!: string;
}

export class MetaEnumsResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  enums!: Record<string, MetaEnumOptionDto[]>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  transitions!: Record<string, Record<string, string[]>>;

  @ApiProperty({ type: [MetaPermissionOptionDto] })
  permissions!: MetaPermissionOptionDto[];
}
