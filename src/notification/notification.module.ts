import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';

@Module({
    controllers: [NotificationController],
    providers: [NotificationService, PrismaService, RedisService],
    exports: [NotificationService]
})
export class NotificationModule { } 