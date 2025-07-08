import { Module } from '@nestjs/common';
import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';

@Module({
    controllers: [FavoriteController],
    providers: [FavoriteService, PrismaService, RedisService],
    exports: [FavoriteService],
})
export class FavoriteModule { } 