import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GenericService } from 'src/generic.service';
import { CreateUserDto, UserResponseDto } from './user.dto';
import { AdminService } from 'src/admin/admin.service';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis.service';
import { Role } from 'src/types/interfaces/role';

@Injectable()
export class UserService extends GenericService {
  constructor(
    private readonly adminService: AdminService,
    public readonly prisma: PrismaService,
    public readonly redisService: RedisService,
  ) {
    super(prisma, redisService);
  }

  private getClientIp(req: any): string {
    if (!req) return 'unknown';
    return req.ip ||
      req.headers?.['x-forwarded-for']?.split(',')[0] ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      'unknown';
  }

  private async isUniqueName(name: string, createdById?: string): Promise<boolean> {
    const whereCondition = createdById
      ? { name, createdById }
      : { name };

    const user = await this.prisma.user.findFirst({
      where: whereCondition
    });
    return !user;
  }

  async getAllUsers(createdById?: string, role?: string): Promise<UserResponseDto[]> {
    const whereCondition: any = {};

    if (createdById) {
      const queryingUser = await this.prisma.user.findUnique({
        where: { id: createdById }
      });

      if (queryingUser) {
        if (queryingUser.role === 'ADMIN' && !queryingUser.createdById) {
          whereCondition.OR = [
            { createdById: null },
            { createdById: createdById }
          ];
        } else {
          whereCondition.createdById = createdById;
        }
      }
    }

    if (role) {
      const validRoles = ['ADMIN', 'USER', 'CUSTOMER'];
      if (!validRoles.includes(role.toUpperCase())) {
        throw new BadRequestException('Role must be ADMIN, USER or CUSTOMER');
      }
      whereCondition.role = role.toUpperCase();
    }

    const users = await this.prisma.user.findMany({
      where: whereCondition,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: [
        { role: 'asc' },
        { name: 'asc' }
      ],
    });

    return users.map(user => ({
      id: user.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      createdBy: user.createdBy
    }));
  }

  async getUserById(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        admin: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        avatarImage: true,
      }
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: user.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      avatarUrl: user.avatarImage?.url,
      createdBy: user.createdBy
    };
  }

  public generateHashPassword(password: string) {
    const salt = bcrypt.genSaltSync(9);
    const hash = bcrypt.hashSync(password, salt);
    return hash;
  }

  async getUsersByRole(role: string, createdById?: string): Promise<UserResponseDto[]> {
    const validRoles = ['ADMIN', 'USER', 'CUSTOMER'];
    if (!validRoles.includes(role)) {
      throw new ConflictException('Role must be ADMIN, USER or CUSTOMER');
    }

    const whereCondition: any = { role: role as Role };

    if (createdById) {
      const queryingUser = await this.prisma.user.findUnique({
        where: { id: createdById }
      });

      if (queryingUser) {
        if (queryingUser.role === 'ADMIN' && !queryingUser.createdById) {
          whereCondition.OR = [
            { role: role as Role, createdById: null },
            { role: role as Role, createdById: createdById }
          ];
          delete whereCondition.role;
        } else {
          whereCondition.createdById = createdById;
        }
      }
    }

    const users = await this.prisma.user.findMany({
      where: whereCondition,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return users.map(user => ({
      id: user.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      createdBy: user.createdBy
    }));
  }

  async createUser(data: CreateUserDto, creatorUserId?: string, req?: any): Promise<UserResponseDto> {
    if (!Object.values(Role).includes(data.role)) {
      throw new ConflictException('Role incorrect. Must be ADMIN, USER or CUSTOMER.');
    }

    if (data.password !== data.confirmPassword) {
      throw new ConflictException('As senhas não coincidem');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email }
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const isNameUnique = await this.isUniqueName(data.name, creatorUserId);
    if (!isNameUnique) {
      throw new ConflictException('Name must be unique within this context');
    }

    const newHashedPassword = this.generateHashPassword(data.password);

    let user;

    try {
      const creator = await this.prisma.user.findUnique({
        where: { id: creatorUserId }
      });

      if (creator?.role === Role.CUSTOMER && data.role !== Role.USER) {
        throw new UnauthorizedException('CUSTOMER can only create USER role');
      }

      user = await this.prisma.user.create({
        data: {
          name: data.name,
          email: data.email,
          password: newHashedPassword,
          role: data.role,
          isActive: true,
          createdById: creatorUserId
        }
      });

      await this.invalidateCache('all_users');

      return {
        id: user.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role as Role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        createdBy: creator
      };
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUser(
    id: string,
    data: { name?: string; email?: string; password?: string; avatarUrl?: string },
    updaterUserId?: string,
    req?: any
  ): Promise<UserResponseDto> {
    const oldUser = await this.prisma.user.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    });

    if (!oldUser) {
      throw new NotFoundException('User not found.');
    }

    const updater = await this.prisma.user.findUnique({
      where: { id: updaterUserId }
    });

    if (!updater) {
      throw new UnauthorizedException('Updater not found');
    }

    if (updater.role === Role.CUSTOMER && oldUser.createdById !== updater.id) {
      throw new UnauthorizedException('You can only update users you created');
    }

    if (updater.role === Role.USER && id !== updater.id) {
      throw new UnauthorizedException('Users cannot update other users');
    }

    if (data.name && data.name !== oldUser.name) {
      const isNameUnique = await this.isUniqueName(data.name, oldUser.createdById);
      if (!isNameUnique) {
        throw new ConflictException('Name must be unique within this context');
      }
    }

    if (data.email && data.email !== oldUser.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: data.email }
      });
      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    const updateData: any = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.password && data.password.trim().length > 0) {
      updateData.password = this.generateHashPassword(data.password);
    }
    // Atualizar avatar via URL
    if (data.avatarUrl && typeof data.avatarUrl === 'string') {
      // Buscar se já existe uma imagem com essa URL
      let image = await this.prisma.image.findFirst({ where: { url: data.avatarUrl } });
      if (!image) {
        image = await this.prisma.image.create({ data: { url: data.avatarUrl } });
      }
      updateData.avatarImageId = image.id;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (updatedUser.role === Role.ADMIN) {
      await this.redisService.deleteByPattern(`admin:*`);
      await this.redisService.del(`all_admins`);
    }

    await this.invalidateCache(`user:${id}`);
    await this.invalidateCache('all_users');

    return {
      id: updatedUser.id,
      userId: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role as Role,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
      createdBy: updatedUser.createdBy
    };
  }

  async deleteUser(id: string, deleterUserId?: string, req?: any): Promise<UserResponseDto> {
    const userToDelete = await this.prisma.user.findUnique({
      where: { id }
    });

    if (!userToDelete) {
      throw new NotFoundException('User not found.');
    }

    if (deleterUserId && userToDelete.createdById !== deleterUserId) {
      throw new ConflictException('You can only delete users you created');
    }

    await this.prisma.admin.deleteMany({ where: { userId: id } });

    const user = await this.prisma.user.delete({ where: { id } });

    await this.invalidateCache(`user:${id}`);
    await this.invalidateCache('all_users');

    if (user.role === Role.ADMIN) {
      await this.redisService.deleteByPattern(`admin:*`);
      await this.redisService.del(`all_admins`);
    }

    return {
      id: user.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, confirmNewPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    const passwordMatch = bcrypt.compareSync(currentPassword, user.password);
    if (!passwordMatch) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException('A nova senha e a confirmação não coincidem.');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('A nova senha deve ter pelo menos 6 caracteres.');
    }
    const hashed = this.generateHashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
    await this.invalidateCache(`user:${userId}`);
  }

  private async invalidateCache(cacheKey: string) {
    await this.redisService.del(cacheKey);
  }
}
