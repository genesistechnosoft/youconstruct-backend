import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { RedisThrottlerStorage } from './common/throttling/redis-throttler.storage';
import { AuthModule } from './modules/auth/auth.module';
import { AttributesModule } from './modules/attributes/attributes.module';
import { BannersModule } from './modules/banners/banners.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { UnitsModule } from './modules/units/units.module';
import { UsersModule } from './modules/users/users.module';
import { VendorOnboardingModule } from './modules/vendor-onboarding/vendor-onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { MediaModule } from './modules/media/media.module';
import { MetaModule } from './modules/meta/meta.module';
import { VendorStoreModule } from './modules/vendor-store/vendor-store.module';
import { VendorFinanceModule } from './modules/vendor-finance/vendor-finance.module';
import { VendorDashboardModule } from './modules/vendor-dashboard/vendor-dashboard.module';
import { CartModule } from './modules/cart/cart.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlatformSettingsModule } from './modules/platform-settings/platform-settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { BulkUploadModule } from './modules/bulk-upload/bulk-upload.module';
import { HomeModule } from './modules/home/home.module';
import { ProfessionalCategoriesModule } from './modules/professional-categories/professional-categories.module';
import { ProfessionalsModule } from './modules/professionals/professionals.module';
import { ProfessionalProjectsModule } from './modules/professional-projects/professional-projects.module';
import { ProfessionalDiscoveryModule } from './modules/professional-discovery/professional-discovery.module';
import { SmsModule } from './common/sms/sms.module';
import { CommerceOtpModule } from './common/otp/commerce-otp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: 60000,
            limit: 100,
          },
        ],
        storage: new RedisThrottlerStorage(config),
      }),
    }),
    PassportModule,
    PrismaModule,
    SmsModule,
    CommerceOtpModule,
    RbacModule,
    StorageModule,
    QueueModule,
    NotificationsModule,
    AuthModule,
    AttributesModule,
    BannersModule,
    BrandsModule,
    CategoriesModule,
    MediaModule,
    MetaModule,
    ProductsModule,
    UnitsModule,
    UsersModule,
    VendorOnboardingModule,
    VendorStoreModule,
    VendorFinanceModule,
    VendorDashboardModule,
    CartModule,
    CouponsModule,
    OrdersModule,
    ReturnsModule,
    PaymentsModule,
    PlatformSettingsModule,
    WishlistModule,
    BulkUploadModule,
    HomeModule,
    ProfessionalCategoriesModule,
    ProfessionalsModule,
    ProfessionalProjectsModule,
    ProfessionalDiscoveryModule,
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
