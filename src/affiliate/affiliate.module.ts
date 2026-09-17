import { Module } from '@nestjs/common';
import { AffiliateController } from './affiliate.controller';
import { AffiliateService } from './affiliate.service';
import { PrismaService } from 'prisma/prisma.service';

@Module({
    controllers: [AffiliateController],
    providers: [AffiliateService, PrismaService],
    exports: [AffiliateService],
})
export class AffiliateModule { }
