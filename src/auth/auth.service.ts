import * as bcrypt from 'bcrypt';
import { PrismaService } from 'prisma/prisma.service';
import { AppService } from 'src/app.service';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthOutputDTO,
  CreateUserInputDTO,
  LoginInputDTO,
  PayloadAuth,
  UpdatePasswordInputDTO,
  UpdateRecoveryPasswordInputDTO,
} from './dto/auth.dto';
import { Role } from 'src/types/interfaces/role';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prismaService: PrismaService,
    private appService: AppService,
  ) { }

  public generateHashPassword(password: string) {
    const salt = bcrypt.genSaltSync(9);
    const hash = bcrypt.hashSync(password, salt);
    return hash;
  }

  async validateUser(
    data: LoginInputDTO,
    ip: string,
    userAgent: string,
    expectedRole: 'USER' | 'ADMIN' | 'CUSTOMER',
  ): Promise<AuthOutputDTO> {
    const user = await this.prismaService.user.findUnique({
      where: {
        email: String(data.email).toLowerCase().trim(),
      },
      include: {
        admin: true,
        createdBy: true,
      }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role.toString() !== expectedRole) {
      throw new ConflictException(`User is not a ${expectedRole}`);
    }

    const validPassword = bcrypt.compareSync(data.password, user.password);

    if (!validPassword) {
      throw new ConflictException('Invalid password');
    }

    if (!user.isActive) {
      throw new ConflictException('User is inactive.');
    }

    const payload: PayloadAuth = {
      id: user.id,
      name: user.name || '',
      role: user.role.toString(),
      email: user.email,
      createdById: user.createdById,
    };

    const access_token = await this.login(payload);

    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.toString(),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      isActive: user.isActive,
      createdById: user.createdById,
      admin: user.admin
    };

    return {
      token: access_token,
      user: userResponse,
    };
  }

  async login(payload: PayloadAuth): Promise<string> {
    const access_token = this.jwtService.sign(payload);
    return access_token;
  }

  async passwordRecoveryLink(email: string) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: {
          email,
        },
      });
      if (!user) throw new NotFoundException('User not found');

      if (!user.isActive) {
        throw new ConflictException('User inactive');
      }

      const recovery = this.jwtService.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        { expiresIn: '20m' },
      );

      return 'sent';
    } catch (error) {
      console.error('Erro em passwordRecoveryLink:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao processar recuperação de senha.');
    }
  }

  async resetPassword(token: string, data: UpdateRecoveryPasswordInputDTO) {
    try {
      // Validar se as senhas coincidem
      if (data.password !== data.confirmPassword) {
        throw new ConflictException('As senhas não coincidem');
      }

      // Verificar o token
      const payload = this.jwtService.verify(token);

      const user = await this.prismaService.user.findUnique({
        where: { id: payload.id },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (!user.isActive) {
        throw new ConflictException('User inactive');
      }

      // Atualizar a senha
      const newHashedPassword = this.generateHashPassword(data.password);

      await this.prismaService.user.update({
        where: { id: user.id },
        data: { password: newHashedPassword },
      });

      return { message: 'Password reset successfully' };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new ConflictException('Recovery token has expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new ConflictException('Invalid recovery token');
      }
      throw error;
    }
  }

  async updatePassword(
    userId: string,
    data: UpdatePasswordInputDTO,
  ): Promise<void> {
    if (data.password !== data.confirmPassword) {
      throw new ConflictException('As senhas não coincidem');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOldPasswordValid = bcrypt.compareSync(
      data.oldPassword,
      user.password,
    );
    if (!isOldPasswordValid) {
      throw new ConflictException('Invalid old password');
    }

    const newHashedPassword = this.generateHashPassword(data.password);

    await this.prismaService.user.update({
      where: { id: userId },
      data: { password: newHashedPassword },
    });
  }

  async createUser(data: CreateUserInputDTO, creatorUserId?: string): Promise<AuthOutputDTO> {
    if (data.password !== data.confirmPassword) {
      throw new ConflictException('As senhas não coincidem');
    }

    const existingUserByEmail = await this.prismaService.user.findUnique({
      where: {
        email: data.email,
      },
    });

    if (existingUserByEmail) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = this.generateHashPassword(data.password);

    const newUser = await this.prismaService.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashedPassword,
        role: data.role as Role,
        isActive: true,
        createdById: creatorUserId,
      },
      include: {
        admin: true,
        createdBy: true,
      }
    });

    if (newUser.role === Role.ADMIN) {
      await this.prismaService.admin.create({
        data: {
          userId: newUser.id,
        },
      });
    }

    const payload: PayloadAuth = {
      id: newUser.id,
      name: newUser.name || '',
      role: newUser.role.toString(),
      email: newUser.email,
      createdById: newUser.createdById,
    };

    const access_token = await this.login(payload);

    const userResponse = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role.toString(),
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
      isActive: newUser.isActive,
      createdById: newUser.createdById,
      admin: newUser.admin
    };

    return {
      token: access_token,
      user: userResponse,
    };
  }
}