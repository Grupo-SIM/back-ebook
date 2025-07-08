import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  HttpException,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './user.dto';
import { JwtAuthGuardAll } from '../auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuardAll)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Post()
  @ApiOperation({
    summary: 'Create a new user',
    description: 'Permite que usuários criem um novo usuário'
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Não autorizado'
  })
  async createUser(
    @Body() createUserDto: CreateUserDto,
    @GetUser() creator: RequestWithUser['user'],
    @Req() req: any,
  ): Promise<UserResponseDto> {
    try {
      const creatorId = creator.createdById || creator.id;
      return await this.userService.createUser(createUserDto, creatorId, req);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao criar usuário:', error);
      throw new HttpException(
        'Erro interno do servidor ao criar usuário.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all users within context' })
  @ApiResponse({
    status: 200,
    description: 'Return all users within the authenticated user context.',
    type: [UserResponseDto],
  })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: ['ADMIN', 'USER', 'CUSTOMER'],
    description: 'Filter users by role (optional)'
  })
  async getAllUsers(
    @GetUser() authenticatedUser: RequestWithUser['user'],
    @Query('role') role?: string,
  ): Promise<UserResponseDto[]> {
    try {
      const contextId = authenticatedUser.createdById || authenticatedUser.id;
      return await this.userService.getAllUsers(contextId, role);
    } catch (error) {
      throw new HttpException(
        error.message || 'Erro interno do servidor ao buscar usuários.',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('my-profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'Return current user profile.',
    type: UserResponseDto,
  })
  async getMyProfile(
    @GetUser() authenticatedUser: RequestWithUser['user'],
  ): Promise<UserResponseDto> {
    try {
      return await this.userService.getUserById(authenticatedUser.id);
    } catch (error) {
      console.error('Erro ao buscar perfil do usuário:', error);
      throw new HttpException(
        'Erro interno do servidor ao buscar perfil.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiResponse({
    status: 200,
    description: 'Return the user.',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUserById(
    @Param('id') id: string,
    @GetUser() authenticatedUser: RequestWithUser['user'],
  ): Promise<UserResponseDto> {
    try {
      const contextId = authenticatedUser.createdById || authenticatedUser.id;
      const user = await this.userService.getUserById(id);

      if (user.id !== authenticatedUser.id && user.createdBy?.id !== contextId) {
        throw new HttpException('Access denied', HttpStatus.FORBIDDEN);
      }

      return user;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro ao buscar usuário:', error);
      throw new HttpException(
        'Erro interno do servidor ao buscar usuário.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update a user',
    description: 'Permite que usuários atualizem um usuário'
  })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully.',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Não autorizado'
  })
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() updater: RequestWithUser['user'],
    @Req() req: any,
  ): Promise<UserResponseDto> {
    try {
      const updaterUserId = updater.createdById || updater.id;
      return await this.userService.updateUser(id, updateUserDto, updaterUserId, req);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao atualizar usuário:', error);
      throw new HttpException(
        'Erro interno do servidor ao atualizar usuário.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('my-profile')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully.',
    type: UserResponseDto,
  })
  async updateMyProfile(
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() authenticatedUser: RequestWithUser['user'],
  ): Promise<UserResponseDto> {
    try {
      return await this.userService.updateUser(authenticatedUser.id, updateUserDto, authenticatedUser.id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao atualizar perfil:', error);
      throw new HttpException(
        'Erro interno do servidor ao atualizar perfil.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({
    status: 200,
    description: 'User deleted successfully.',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async deleteUser(
    @Param('id') id: string,
    @GetUser() deleter: RequestWithUser['user'],
    @Req() req: any,
  ): Promise<UserResponseDto> {
    try {
      const deleterUserId = deleter.createdById || deleter.id;
      return await this.userService.deleteUser(id, deleterUserId, req);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao deletar usuário:', error);
      throw new HttpException(
        'Erro interno do servidor ao deletar usuário.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('role/:role')
  @ApiOperation({ summary: 'Get users by role within context' })
  @ApiResponse({
    status: 200,
    description: 'Return users by role within the authenticated user context.',
    type: [UserResponseDto],
  })
  async getUsersByRole(
    @Param('role') role: string,
    @GetUser() authenticatedUser: RequestWithUser['user'],
  ): Promise<UserResponseDto[]> {
    try {
      const contextId = authenticatedUser.createdById || authenticatedUser.id;
      return await this.userService.getUsersByRole(role, contextId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Erro interno do servidor ao buscar usuários por role.',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
