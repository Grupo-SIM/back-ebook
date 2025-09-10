import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { NotificationModule } from 'src/notification/notification.module';
import { AppService } from 'src/app.service';

@Module({
    imports: [NotificationModule],
    controllers: [CheckoutController],
    providers: [CheckoutService, PrismaService, RedisService, AppService],
    exports: [CheckoutService]
})
export class CheckoutModule { } 
