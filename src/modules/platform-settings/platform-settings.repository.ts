import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import type { PlatformSettingDefinition } from './platform-settings.constants';

@Injectable()
export class PlatformSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.platformSetting.findMany({
      orderBy: [{ namespace: 'asc' }, { key: 'asc' }],
    });
  }

  findByKey(namespace: string, key: string) {
    return this.prisma.platformSetting.findUnique({
      where: { namespace_key: { namespace, key } },
    });
  }

  updateValue(input: {
    namespace: string;
    key: string;
    value: Prisma.InputJsonValue;
    updatedByUserId: string;
  }) {
    return this.prisma.platformSetting.update({
      where: {
        namespace_key: { namespace: input.namespace, key: input.key },
      },
      data: {
        value: input.value,
        updatedByUserId: input.updatedByUserId,
      },
    });
  }

  upsertDefault(definition: PlatformSettingDefinition) {
    return this.prisma.platformSetting.upsert({
      where: {
        namespace_key: {
          namespace: definition.namespace,
          key: definition.key,
        },
      },
      create: {
        namespace: definition.namespace,
        key: definition.key,
        value: definition.defaultValue,
        valueType: definition.valueType,
        label: definition.label,
        description: definition.description,
        isEditable: definition.isEditable,
        isPublic: definition.isPublic,
      },
      update: {
        valueType: definition.valueType,
        label: definition.label,
        description: definition.description,
        isEditable: definition.isEditable,
        isPublic: definition.isPublic,
      },
    });
  }
}
