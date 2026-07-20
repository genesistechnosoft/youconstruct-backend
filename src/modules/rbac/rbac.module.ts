import { Global, Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminRolesController,
  PermissionsCatalogController,
  VendorRolesController,
} from './custom-roles.controller';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';
import { RbacRepository } from './rbac.repository';
import { RbacService } from './rbac.service';
import { SecurityAuditService } from './security-audit.service';
import {
  AdminTeamController,
  InvitationsController,
  VendorTeamController,
} from './team.controller';

@Global()
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [
    VendorRolesController,
    AdminRolesController,
    PermissionsCatalogController,
    VendorTeamController,
    AdminTeamController,
    InvitationsController,
    ImpersonationController,
  ],
  providers: [
    RbacRepository,
    RbacService,
    ImpersonationService,
    SecurityAuditService,
  ],
  exports: [
    RbacRepository,
    RbacService,
    ImpersonationService,
    SecurityAuditService,
  ],
})
export class RbacModule {}
