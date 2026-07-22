import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { ActiveContextGuard } from './common/guards/active-context.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OnboardingOnlyGuard } from './common/guards/onboarding-only.guard';
import { OwnerOnlyGuard } from './common/guards/owner-only.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ImpersonationAuditInterceptor } from './common/interceptors/impersonation-audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { UnitsModule } from './modules/units/units.module';
import { UsersModule } from './modules/users/users.module';
import { VendorOnboardingModule } from './modules/vendor-onboarding/vendor-onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { MediaModule } from './modules/media/media.module';
import { VendorStoreModule } from './modules/vendor-store/vendor-store.module';
import { VendorFinanceModule } from './modules/vendor-finance/vendor-finance.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PassportModule,
    PrismaModule,
    RbacModule,
    StorageModule,
    QueueModule,
    AuthModule,
    BrandsModule,
    CategoriesModule,
    MediaModule,
    ProductsModule,
    UnitsModule,
    UsersModule,
    VendorOnboardingModule,
    VendorStoreModule,
    VendorFinanceModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ActiveContextGuard,
    },
    {
      provide: APP_GUARD,
      useClass: OwnerOnlyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: OnboardingOnlyGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ImpersonationAuditInterceptor,
    },
  ],
})
export class AppModule {}
