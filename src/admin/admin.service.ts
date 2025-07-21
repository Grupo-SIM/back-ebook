import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { GenericService } from 'src/generic.service';
import { AdminResponseDto } from './admin.dto';
import dayjs from 'dayjs';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class AdminService extends GenericService {
  async getAllAdmins(): Promise<AdminResponseDto[]> {
    try {
      return await this.getAll0('admin');
    } catch (error) {
      const items0 = await this.prisma.admin.findMany({
        include: {
          adminUser: true,
        },
      });

      return items0.map((e) => ({
        ...e,
        name: e.adminUser?.name,
        email: e.adminUser.email,
        userId: e.adminUser.id,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      }));
    }
  }

  async getAllAdminNames(): Promise<string[]> {
    const admins = await this.prisma.admin.findMany({
      select: {
        adminUser: {
          select: {
            name: true
          }
        }
      },
    });

    return admins
      .map(admin => admin.adminUser.name)
      .filter(name => name !== null && name !== undefined);
  }
  async getAll0(modelName: string): Promise<any[]> {
    const cacheKey = `all_${modelName}s`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const items0 = await this.prisma.admin.findMany({
      include: {
        adminUser: true,
      },
    });

    const items = items0.map((e) => ({
      ...e,
      name: e.adminUser?.name,
      email: e.adminUser.email,
      userId: e.adminUser.id,
      createdAt: dayjs(e.createdAt).format('DD/MM/YYYY'),
    }));

    await this.redisService.set(
      cacheKey,
      JSON.stringify(items),
      this.CACHE_TTL,
    );
    return items;
  }

  async getAdminById(id: string): Promise<AdminResponseDto> {
    return this.getById0('admin', id);
  }

  async getById0(modelName: string, id: string): Promise<any | null> {
    const cacheKey = `${modelName}:${id}`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const item0 = await this.prisma.admin.findUnique({
      where: { id },
      include: {
        adminUser: true,
      },
    });

    if (!item0) {
      return null;
    }

    const item = {
      ...item0,
      name: item0.adminUser.name,
      email: item0.adminUser.email,
      role: item0.adminUser.role,
    };

    await this.redisService.set(
      cacheKey,
      JSON.stringify(item),
      this.CACHE_TTL,
    );

    return item;
  }

  async createAdmin(data: { userId: string }): Promise<AdminResponseDto> {
    return this.create('admin', data);
  }

  async updateAdmin(id: string, data: { name?: string; email?: string }): Promise<any> {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      include: { adminUser: true }
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: admin.userId },
      data: {
        name: data.name,
        email: data.email,
      },
    });

    await this.invalidateCache(id);
    return { ...admin, user: updatedUser };
  }

  async deleteAdmin(id: string): Promise<AdminResponseDto> {
    const admin = await this.delete('admin', id);
    await this.invalidateCache(id);
    return admin;
  }

  private async invalidateCache(id: string) {
    await this.redisService.del(`admin:${id}`);
    await this.redisService.del('all_admins');
  }

  async getAdminByUserId(userId: string): Promise<AdminResponseDto | null | any> {
    const cacheKey = `admin:user:${userId}`;
    const cachedData = await this.redisService.get(cacheKey);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const admin = await this.prisma.admin.findUnique({
      where: { userId },
      include: { adminUser: true },
    });

    if (admin) {
      await this.redisService.set(cacheKey, JSON.stringify(admin), this.CACHE_TTL);
    }

    return admin;
  }

  async getRecentActivities(adminId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    // Buscar logs imutáveis da tabela ActivityLog
    const [logs, total] = await Promise.all([
      this.prisma['activityLog'].findMany({
        where: { adminId },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma['activityLog'].count({ where: { adminId } })
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data: logs.map(log => ({
        id: log.id,
        type: log.type,
        message: log.message,
        timestamp: log.timestamp,
        bookId: log.bookId,
        bookTitle: log.bookTitle,
      })),
      page,
      limit,
      total,
      totalPages
    };
  }
}