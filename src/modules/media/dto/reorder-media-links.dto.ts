import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class ReorderMediaLinkItemDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  mediaLinkId!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderMediaLinksDto {
  @ApiProperty({ type: [ReorderMediaLinkItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderMediaLinkItemDto)
  items!: ReorderMediaLinkItemDto[];
}
