import { Module, Global } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppService } from '../app.service';

@Global()
@Module({
  providers: [PrismaService, AppService],
  exports: [PrismaService, AppService],
})
export class CommonModule {} 
