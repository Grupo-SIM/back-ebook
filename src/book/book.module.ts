import { Module } from '@nestjs/common';
import { BookController } from './book.controller';
import { BookService } from './book.service';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { FavoriteModule } from '../favorite/favorite.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { AdminBookController } from './admin-book.controller';

@Module({
    imports: [FavoriteModule, CheckoutModule],
    controllers: [BookController, AdminBookController],
    providers: [BookService, PrismaService, RedisService],
    exports: [BookService],
})
export class BookModule { } 