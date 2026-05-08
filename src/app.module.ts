import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminService } from './admin/admin.service';
import { AdminController } from './admin/admin.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import * as dotenv from 'dotenv';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './http-exception.filter';
import { UserController } from './user/user.controller';
import { UserService } from './user/user.service';
import { WebhookController } from './webhook/dom/dom-webhook.controller';
import { WebhookService } from './webhook/dom/dom-webhook.service';
import { BookModule } from './book/book.module';
import { CategoryModule } from './category/category.module';
import { FavoriteModule } from './favorite/favorite.module';
import { CheckoutModule } from './checkout/checkout.module';
import { NotificationModule } from './notification/notification.module';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ImageControllerUser } from './image/image.controller';
import { ImageService } from './image/image.service';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from 'prisma/prisma.service';
import { GenericService } from './generic.service';
import { RedisService } from './redis.service';
import { JwtStrategy } from './auth/guard/jwt.strategy';
import { CommonModule } from './common/common.module';
import { PaymentsController } from './payments/payments.controller';
import { InternalStatsController } from './internal/internal-stats.controller';

dotenv.config();

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
    }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || "secret",
      signOptions: { expiresIn: '24h' },
      global: true,
    }),
    CommonModule,
    AuthModule,
    BookModule,
    CategoryModule,
    FavoriteModule,
    CheckoutModule,
    NotificationModule,
  ],
  controllers: [
    AppController,
    AdminController,
    UserController,
    WebhookController,
    ImageControllerUser,
    PaymentsController,
    InternalStatsController,
  ],
  providers: [
    {
      provide: 'APP_FILTER',
      useClass: AllExceptionsFilter,
    },
    {
      provide: 'APP_FILTER',
      useClass: HttpExceptionFilter,
    },
    UserService,
    GenericService,
    RedisService,
    AdminService,
    WebhookService,
    ImageService,
    JwtStrategy,
  ],
  exports: [],
})
export class AppModule { }
