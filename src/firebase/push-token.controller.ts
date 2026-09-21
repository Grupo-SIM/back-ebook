import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from 'prisma/prisma.service';
import { JwtAuthGuardAll } from '../auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';

@ApiTags('Push')
@Controller('push')
@UseGuards(JwtAuthGuardAll)
@ApiBearerAuth()
export class PushTokenController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('register')
  async register(@GetUser() user: { id: string }, @Body('token') token: string) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { fcmToken: token },
    });
    return { ok: true };
  }

  @Delete('unregister')
  async unregister(@GetUser() user: { id: string }) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { fcmToken: null },
    });
    return { ok: true };
  }
}
