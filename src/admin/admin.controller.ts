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
  ConflictException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { UserService } from '../user/user.service';
import { CreateAdminDto, UpdateAdminDto, AdminResponseDto } from './admin.dto';
import { CreateUserDto } from '../user/user.dto';
import { JwtAuthGuardPanel } from '../auth/guard/jwt-auth.guard';
import { JwtAuthGuardAdmin } from 'src/auth/guard/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/user.decorator';
import { RequestWithUser } from 'src/common/interfaces/request-with-user.interface';

@ApiTags('Admins')
@Controller('admins')
@UseGuards(JwtAuthGuardPanel)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly userService: UserService,
  ) { }

  @Post()
  @ApiOperation({ summary: 'Create a new admin' })
  @ApiResponse({
    status: 201,
    description: 'The admin has been successfully created.',
    type: AdminResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Admin already exists for this user ID.' })
  @ApiResponse({ status: 404, description: 'User not found for the given userId.' })
  @ApiResponse({ status: 500, description: 'Internal Server Error.' })
  async createAdmin(
    @Body() createAdminDto: CreateAdminDto,
  ): Promise<AdminResponseDto> {
    try {
      return await this.adminService.createAdmin(createAdminDto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao criar admin:', error);
      throw new HttpException(
        'Erro interno do servidor ao criar admin. Verifique os logs para mais detalhes.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a new user within admin context' })
  @ApiResponse({
    status: 201,
    description: 'User created successfully within admin context.',
  })
  @ApiResponse({ status: 409, description: 'User with this email already exists or name conflicts.' })
  async createUserInAdminContext(
    @Body() createUserDto: CreateUserDto,
    @GetUser() admin: RequestWithUser['user'],
  ) {
    try {
      // Usa o ID do admin como creator para manter o contexto
      const creatorId = admin.createdById || admin.id;
      return await this.userService.createUser(createUserDto, creatorId);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao criar usuário no contexto admin:', error);
      throw new HttpException(
        'Erro interno do servidor ao criar usuário.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('users')
  @ApiOperation({ summary: 'Get all users within admin context' })
  @ApiResponse({
    status: 200,
    description: 'Return all users within admin context.',
  })
  async getUsersInAdminContext(
    @GetUser() admin: RequestWithUser['user'],
  ) {
    try {
      // Busca usuários criados por este admin
      const creatorId = admin.createdById || admin.id;
      return await this.userService.getAllUsers(creatorId);
    } catch (error) {
      console.error('Erro ao buscar usuários no contexto admin:', error);
      throw new HttpException(
        'Erro interno do servidor ao buscar usuários.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('users/:userId')
  @ApiOperation({ summary: 'Update a user within admin context' })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully.',
  })
  @ApiResponse({ status: 404, description: 'User not found or not accessible.' })
  async updateUserInAdminContext(
    @Param('userId') userId: string,
    @Body() updateData: { name?: string; email?: string; password?: string },
    @GetUser() admin: RequestWithUser['user'],
  ) {
    try {
      const updaterUserId = admin.createdById || admin.id;
      return await this.userService.updateUser(userId, updateData, updaterUserId);
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

  @Delete('users/:userId')
  @ApiOperation({ summary: 'Delete a user within admin context' })
  @ApiResponse({
    status: 200,
    description: 'User deleted successfully.',
  })
  @ApiResponse({ status: 404, description: 'User not found or not accessible.' })
  async deleteUserInAdminContext(
    @Param('userId') userId: string,
    @GetUser() admin: RequestWithUser['user'],
  ) {
    try {
      const deleterUserId = admin.createdById || admin.id;
      return await this.userService.deleteUser(userId, deleterUserId);
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

  @Get()
  @ApiOperation({ summary: 'Get all admins' })
  @ApiResponse({
    status: 200,
    description: 'Return all admins.',
    type: [AdminResponseDto],
  })
  async getAllAdmins(): Promise<AdminResponseDto[]> {
    return await this.adminService.getAllAdmins();
  }

  @Get('names')
  @ApiOperation({ summary: 'Obter todos os nomes dos administradores' })
  @ApiResponse({
    status: 200,
    description: 'Retorna uma lista com os nomes dos administradores.',
    type: [String],
  })
  async getAllAdminNames(): Promise<string[]> {
    return this.adminService.getAllAdminNames();
  }

  @Get('activities')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar atividades recentes do admin (dashboard)' })
  @ApiResponse({ status: 200, description: 'Atividades recentes do admin' })
  async getRecentActivities(
    @GetUser() admin: RequestWithUser['user'],
    @Query('page') page: number | string = 1,
    @Query('limit') limit: number | string = 10
  ) {
    // Garantir que page e limit são números
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    return this.adminService.getRecentActivities(admin.id, pageNum, limitNum);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an admin by id' })
  @ApiResponse({
    status: 200,
    description: 'Return the admin.',
    type: AdminResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Admin not found.' })
  async getAdminById(@Param('id') id: string): Promise<AdminResponseDto> {
    const admin = await this.adminService.getAdminById(id);
    if (!admin) {
      throw new NotFoundException('Admin not found.');
    }
    return admin;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an admin' })
  @ApiResponse({
    status: 200,
    description: 'Admin updated successfully.',
    type: AdminResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Admin not found.' })
  async updateAdmin(
    @Param('id') id: string,
    @Body() updateAdminDto: UpdateAdminDto,
  ): Promise<AdminResponseDto> {
    try {
      return await this.adminService.updateAdmin(id, updateAdminDto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao atualizar admin:', error);
      throw new HttpException(
        'Erro interno do servidor ao atualizar admin.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an admin' })
  @ApiResponse({
    status: 200,
    description: 'Admin deleted successfully.',
    type: AdminResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Admin not found.' })
  async deleteAdmin(@Param('id') id: string): Promise<AdminResponseDto> {
    try {
      return await this.adminService.deleteAdmin(id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Erro inesperado ao deletar admin:', error);
      throw new HttpException(
        'Erro interno do servidor ao deletar admin.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get admin by user ID' })
  @ApiResponse({
    status: 200,
    description: 'Return the admin for the given user ID.',
    type: AdminResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Admin not found for the given user ID.' })
  async getAdminByUserId(
    @Param('userId') userId: string,
  ): Promise<AdminResponseDto> {
    const admin = await this.adminService.getAdminByUserId(userId);
    if (!admin) {
      throw new NotFoundException('Admin not found for the given user ID.');
    }
    return admin;
  }
}