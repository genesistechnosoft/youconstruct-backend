import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformSettingValueType,
  Prisma,
} from '../../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type';
import { SecurityAuditService } from '../rbac/security-audit.service';
import { UpdatePlatformSettingDto } from './dto/update-platform-setting.dto';
import {
  findPlatformSettingDefinition,
  PLATFORM_SETTING_DEFINITIONS,
  type PlatformSettingDefinition,
} from './platform-settings.constants';
import { PlatformSettingsRepository } from './platform-settings.repository';

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly platformSettingsRepository: PlatformSettingsRepository,
    private readonly securityAuditService: SecurityAuditService,
  ) {}

  async listSettings() {
    const settings = await this.platformSettingsRepository.findAll();
    return {
      message: 'Platform settings fetched successfully',
      data: settings,
    };
  }

  async updateSetting(
    user: AuthenticatedUser,
    namespace: string,
    key: string,
    dto: UpdatePlatformSettingDto,
  ) {
    const definition = this.requireDefinition(namespace, key);
    if (!definition.isEditable) {
      throw new BadRequestException('This setting cannot be edited');
    }

    const value = this.validateValue(definition, dto.value);
    const existing =
      (await this.platformSettingsRepository.findByKey(namespace, key)) ??
      (await this.platformSettingsRepository.upsertDefault(definition));

    const setting = await this.platformSettingsRepository.updateValue({
      namespace,
      key,
      value,
      updatedByUserId: user.userId,
    });

    this.securityAuditService.log({
      actorUserId: user.userId,
      actorRole: user.platformRole,
      targetType: 'PlatformSetting',
      targetId: setting.id,
      action: 'PLATFORM_SETTING_UPDATED',
      result: 'SUCCESS',
      metadata: {
        namespace,
        key,
        oldValue: existing.value,
        newValue: value,
      },
      impersonatedBy: user.impersonatedBy,
    });

    return {
      message: 'Platform setting updated successfully',
      data: setting,
    };
  }

  async getValue(namespace: string, key: string): Promise<Prisma.JsonValue> {
    const definition = this.requireDefinition(namespace, key);
    const setting = await this.platformSettingsRepository.findByKey(
      namespace,
      key,
    );
    return setting?.value ?? definition.defaultValue;
  }

  async getBoolean(namespace: string, key: string): Promise<boolean> {
    const value = await this.getValue(namespace, key);
    return typeof value === 'boolean' ? value : Boolean(value);
  }

  async getNumber(namespace: string, key: string): Promise<number> {
    const value = await this.getValue(namespace, key);
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  async getString(namespace: string, key: string): Promise<string> {
    const value = await this.getValue(namespace, key);
    return typeof value === 'string' ? value : String(value ?? '');
  }

  async getDecimal(namespace: string, key: string): Promise<Prisma.Decimal> {
    const value = await this.getString(namespace, key);
    return new Prisma.Decimal(value || '0');
  }

  async syncDefaults() {
    await Promise.all(
      PLATFORM_SETTING_DEFINITIONS.map((definition) =>
        this.platformSettingsRepository.upsertDefault(definition),
      ),
    );
  }

  private requireDefinition(namespace: string, key: string) {
    const definition = findPlatformSettingDefinition(namespace, key);
    if (!definition) {
      throw new NotFoundException('Platform setting not found');
    }
    return definition;
  }

  private validateValue(
    definition: PlatformSettingDefinition,
    value: unknown,
  ): Prisma.InputJsonValue {
    if (value === null || value === undefined) {
      throw new BadRequestException('Setting value is required');
    }

    switch (definition.valueType) {
      case PlatformSettingValueType.STRING:
        if (typeof value !== 'string') {
          throw new BadRequestException('Setting value must be a string');
        }
        return value;

      case PlatformSettingValueType.NUMBER:
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new BadRequestException(
            'Setting value must be a finite number',
          );
        }
        return value;

      case PlatformSettingValueType.BOOLEAN:
        if (typeof value !== 'boolean') {
          throw new BadRequestException('Setting value must be a boolean');
        }
        return value;

      case PlatformSettingValueType.DECIMAL_STRING:
        if (typeof value !== 'string' || !/^\d+(\.\d{1,4})?$/.test(value)) {
          throw new BadRequestException(
            'Setting value must be a decimal string',
          );
        }
        return value;

      case PlatformSettingValueType.STRING_ARRAY:
        if (
          !Array.isArray(value) ||
          !value.every((item) => typeof item === 'string')
        ) {
          throw new BadRequestException('Setting value must be a string array');
        }
        return value;

      case PlatformSettingValueType.JSON:
        return this.toJsonValue(value);
    }
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new BadRequestException('Setting value must be valid JSON');
    }
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  }
}
