import { Module } from '@nestjs/common';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';

@Module({
    controllers: [CategoryController],
    providers: [CategoryService, PrismaService, RedisService],
    exports: [CategoryService],
})
export class CategoryModule { } 