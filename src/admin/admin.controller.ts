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
import { CreateAdminDto, UpdateAdminDto, AdminResponseDto, AdminRevenueDto, AdminRevenueDetailedDto } from './admin.dto';
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

  // ========== POST ROUTES ==========
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

  @Post('recalculate-all-sales')
  @ApiOperation({
    summary: 'Recalcula contadores de vendas de TODOS os livros',
    description: 'Executa uma migração para contabilizar vendas passadas baseado no histórico de pedidos pagos'
  })
  @ApiResponse({
    status: 200,
    description: 'Contabilização de vendas passadas concluída com sucesso'
  })
  async recalculateAllSales() {
    return this.adminService.recalculateAllSales();
  }

  // ========== GET ROUTES (SPECIFIC PATHS FIRST) ==========
  @Get()
  @ApiOperation({ summary: 'Get all admins' })
  @ApiResponse({
    status: 200,
    description: 'Return all admins.',
    type: [AdminResponseDto],
  })
  async getAllAdmins(): Promise<AdminResponseDto[]> {
    console.log('🔥 getAllAdmins endpoint chamado');
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
    console.log('🔥 getAllAdminNames endpoint chamado');
    return this.adminService.getAllAdminNames();
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
      console.log('🔥 getUsersInAdminContext endpoint chamado para admin:', admin.id);
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
    console.log('🔥 getRecentActivities endpoint chamado para admin:', admin.id);
    // Garantir que page e limit são números
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 10;
    return this.adminService.getRecentActivities(admin.id, pageNum, limitNum);
  }

  // ========== REVENUE ROUTES (BEFORE :id ROUTES) ==========
  @Get('revenue')
  @ApiOperation({ summary: 'Obter receita total de todos os admins (ranking)' })
  @ApiResponse({
    status: 200,
    description: 'Receita total de todos os admins ordenada por receita',
    type: [AdminRevenueDto]
  })
  async getAllAdminsRevenue(): Promise<AdminRevenueDto[]> {
    console.log('🔥 getAllAdminsRevenue endpoint chamado');
    return this.adminService.getAllAdminsRevenue();
  }

  @Get('revenue/my')
  @ApiOperation({ summary: 'Obter receita total do admin autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Receita total do admin autenticado',
    type: AdminRevenueDto
  })
  async getMyRevenue(@GetUser() admin: RequestWithUser['user']): Promise<AdminRevenueDto> {
    console.log('🔥 getMyRevenue - Dados do admin recebido:', {
      id: admin.id, // ← Este é o userId
      role: admin.role,
      email: admin.email,
      name: admin.name
    });

    // 🔥 CORREÇÃO: Buscar admin pelo userId, não pelo adminId
    return this.adminService.getAdminRevenueByUserId(admin.id);
  }

  @Get('revenue/my/detailed')
  @ApiOperation({ summary: 'Obter receita detalhada do admin autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Receita detalhada do admin autenticado com histórico dos últimos 12 meses',
    type: AdminRevenueDetailedDto
  })
  async getMyRevenueDetailed(@GetUser() admin: RequestWithUser['user']): Promise<AdminRevenueDetailedDto> {
    console.log('🔥 getMyRevenueDetailed - Dados do admin recebido:', {
      id: admin.id, // ← Este é o userId
      role: admin.role,
      email: admin.email,
      name: admin.name
    });

    // 🔥 CORREÇÃO: Buscar admin pelo userId, não pelo adminId
    return this.adminService.getAdminRevenueDetailedByUserId(admin.id);
  }

  // Endpoints para gerenciar tokens dos admins
  @Get('tokens')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Get all admin tokens' })
  @ApiResponse({ status: 200, description: 'Admin tokens retrieved successfully.' })
  async getAllAdminTokens() {
    return this.adminService.getAllAdminTokens();
  }

  @Get('tokens/:adminId')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Get admin token by admin ID' })
  @ApiResponse({ status: 200, description: 'Admin token retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Admin token not found.' })
  async getAdminToken(@Param('adminId') adminId: string) {
    const token = await this.adminService.getAdminToken(adminId);
    if (!token) {
      throw new NotFoundException('Token do admin não encontrado');
    }
    return token;
  }

  @Post('tokens')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Create admin token' })
  @ApiResponse({ status: 201, description: 'Admin token created successfully.' })
  @ApiResponse({ status: 409, description: 'Admin already has a token.' })
  async createAdminToken(@Body() data: { adminId: string; token: string; title?: string }) {
    return this.adminService.createAdminToken(data);
  }

  @Put('tokens/:adminId')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Update admin token' })
  @ApiResponse({ status: 200, description: 'Admin token updated successfully.' })
  @ApiResponse({ status: 404, description: 'Admin token not found.' })
  async updateAdminToken(
    @Param('adminId') adminId: string,
    @Body() data: { token?: string; title?: string; isActive?: boolean }
  ) {
    return this.adminService.updateAdminToken(adminId, data);
  }

  @Delete('tokens/:adminId')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Delete admin token' })
  @ApiResponse({ status: 200, description: 'Admin token deleted successfully.' })
  @ApiResponse({ status: 404, description: 'Admin token not found.' })
  async deleteAdminToken(@Param('adminId') adminId: string) {
    await this.adminService.deleteAdminToken(adminId);
    return { message: 'Token do admin deletado com sucesso' };
  }

  // ========== GET ROUTES WITH PARAMETERS (LAST) ==========
  @Get(':id')
  @ApiOperation({ summary: 'Get an admin by id' })
  @ApiResponse({
    status: 200,
    description: 'Return the admin.',
    type: AdminResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Admin not found.' })
  async getAdminById(@Param('id') id: string): Promise<AdminResponseDto> {
    console.log('🔥 getAdminById endpoint chamado para id:', id);
    const admin = await this.adminService.getAdminById(id);
    if (!admin) {
      throw new NotFoundException('Admin not found.');
    }
    return admin;
  }

  @Get(':id/revenue')
  @ApiOperation({ summary: 'Obter receita total de um admin específico' })
  @ApiResponse({
    status: 200,
    description: 'Receita total do admin especificado',
    type: AdminRevenueDto
  })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async getAdminRevenue(
    @Param('id') adminId: string
  ): Promise<AdminRevenueDto> {
    console.log('🔥 getAdminRevenue endpoint chamado para adminId:', adminId);
    return this.adminService.getAdminRevenue(adminId);
  }

  @Get(':id/revenue/detailed')
  @ApiOperation({ summary: 'Obter receita detalhada de um admin específico (com histórico mensal)' })
  @ApiResponse({
    status: 200,
    description: 'Receita detalhada do admin especificado com histórico dos últimos 12 meses',
    type: AdminRevenueDetailedDto
  })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async getAdminRevenueDetailed(
    @Param('id') adminId: string
  ): Promise<AdminRevenueDetailedDto> {
    console.log('🔥 getAdminRevenueDetailed endpoint chamado para adminId:', adminId);
    return this.adminService.getAdminRevenueDetailed(adminId);
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
    console.log('🔥 getAdminByUserId endpoint chamado para userId:', userId);
    const admin = await this.adminService.getAdminByUserId(userId);
    if (!admin) {
      throw new NotFoundException('Admin not found for the given user ID.');
    }
    return admin;
  }

  // ========== PUT ROUTES ==========
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
      console.log('🔥 updateUserInAdminContext endpoint chamado para userId:', userId);
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
      console.log('🔥 updateAdmin endpoint chamado para id:', id);
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

  // ========== DELETE ROUTES ==========
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
      console.log('🔥 deleteUserInAdminContext endpoint chamado para userId:', userId);
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
      console.log('🔥 deleteAdmin endpoint chamado para id:', id);
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
}
