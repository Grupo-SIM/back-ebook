import { Module } from '@nestjs/common';
import { BookController } from './book.controller';
import { BookService } from './book.service';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';

@Module({
    controllers: [BookController],
    providers: [BookService, PrismaService, RedisService],
    exports: [BookService],
})
export class BookModule { } 