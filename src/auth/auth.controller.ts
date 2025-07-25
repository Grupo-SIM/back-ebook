import * as requestIp from 'request-ip';
import { AppService } from 'src/app.service';
import {
  Body,
  Controller,
  createParamDecorator,
  HttpException,
  Param,
  Post,
  Req,
  UseGuards,
  Get,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  AuthOutputDTO,
  CreateUserInputDTO,
  LoginInputDTO,
  UpdatePasswordInputDTO,
  UpdateRecoveryPasswordInputDTO,
} from './dto/auth.dto';
import { JwtAuthGuardUser } from './guard/jwt-auth.guard';

export const ClientIp = createParamDecorator((data, req) => {
  return requestIp.getClientIp(req);
});

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private appService: AppService,
  ) { }

  @ApiOperation({ summary: 'Generate an access token for user' })
  @ApiResponse({
    status: 200,
    type: AuthOutputDTO,
    description: 'Returns the access token for user',
  })
  @ApiBody({ type: LoginInputDTO })
  @Post('/user/login')
  async userLogin(
    @Body() body: LoginInputDTO,
    @ClientIp() ip: string,
    @Req() req: any,
  ) {
    try {
      const userAgent = req.headers['user-agent'];
      const data = await this.authService.validateUser(body, ip, userAgent, 'USER');
      return data;
    } catch (error) {
      throw new HttpException(error.message, error.status);
    }
  }

  @ApiOperation({ summary: 'Generate an access token for ADMIN' })
  @ApiResponse({
    status: 200,
    type: AuthOutputDTO,
    description: 'Returns the access token for ADMIN',
  })
  @ApiBody({ type: LoginInputDTO })
  @Post('/admin/login')
  async adminLogin(
    @Body() body: LoginInputDTO,
    @ClientIp() ip: string,
    @Req() req: any,
  ) {
    try {
      const userAgent = req.headers['user-agent'];
      const data = await this.authService.validateUser(body, ip, userAgent, 'ADMIN');
      return data;
    } catch (error) {
      throw new HttpException(error.message, error.status);
    }
  }

  @ApiOperation({ summary: 'Generate an access token for CUSTOMER' })
  @ApiResponse({
    status: 200,
    type: AuthOutputDTO,
    description: 'Returns the access token for CUSTOMER',
  })
  @ApiBody({ type: LoginInputDTO })
  @Post('/customer/login')
  async customerLogin(
    @Body() body: LoginInputDTO,
    @ClientIp() ip: string,
    @Req() req: any,
  ) {
    try {
      const userAgent = req.headers['user-agent'];
      const data = await this.authService.validateUser(body, ip, userAgent, 'CUSTOMER');
      return data;
    } catch (error) {
      throw new HttpException(error.message, error.status);
    }
  }

  @ApiOperation({ summary: 'Login universal - permite acesso a múltiplas plataformas com o mesmo email' })
  @ApiResponse({
    status: 200,
    type: AuthOutputDTO,
    description: 'Returns the access token and user roles',
  })
  @ApiBody({ type: LoginInputDTO })
  @Post('/universal/login')
  async universalLogin(
    @Body() body: LoginInputDTO,
    @ClientIp() ip: string,
    @Req() req: any,
  ) {
    try {
      const userAgent = req.headers['user-agent'];
      
      // Buscar usuário por email
      const user = await this.authService.findUserByEmail(body.email);

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      // Verificar senha usando bcrypt (mesmo método dos outros endpoints)
      const validPassword = await this.authService.validatePassword(user.id, body.password);

      if (!validPassword) {
        throw new HttpException('Invalid password', 409);
      }

      if (!user.isActive) {
        throw new HttpException('User is inactive', 409);
      }

      // Obter todas as roles do usuário
      const roles = await this.authService.getUserRoles(user.id);

      // Gerar token com a role principal
      const payload = {
        id: user.id,
        name: user.name || '',
        role: user.role.toString(),
        email: user.email,
        createdById: user.createdById,
      };

      const access_token = await this.authService.login(payload);

      const userResponse = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.toString(),
        roles: roles, // Incluir todas as roles disponíveis
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
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  @ApiOperation({ summary: 'Obter todas as roles de um usuário' })
  @ApiResponse({
    status: 200,
    description: 'Returns all roles for the authenticated user',
    schema: {
      type: 'object',
      properties: {
        roles: {
          type: 'array',
          items: { type: 'string' },
          example: ['USER', 'ADMIN']
        }
      }
    }
  })
  @UseGuards(JwtAuthGuardUser)
  @ApiBearerAuth()
  @Get('/my-roles')
  async getMyRoles(@Req() req: any) {
    try {
      const roles = await this.authService.getUserRoles(req.user.id);
      return { roles };
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  @ApiOperation({ summary: 'Adicionar role ADMIN a um usuário existente' })
  @ApiResponse({
    status: 200,
    description: 'Role ADMIN adicionada com sucesso',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Role ADMIN adicionada com sucesso'
        },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            roles: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email do usuário que receberá a role ADMIN'
        }
      },
      required: ['email']
    }
  })
  @Post('/add-admin-role')
  async addAdminRole(@Body() body: { email: string }) {
    try {
      const user = await this.authService.findUserByEmail(body.email);
      
      if (!user) {
        throw new HttpException('User not found', 404);
      }

      // Adicionar role ADMIN
      await this.authService.addAdminRole(user.id);

      // Buscar usuário atualizado
      const updatedUser = await this.authService.findUserByEmail(body.email);
      const roles = await this.authService.getUserRoles(updatedUser.id);

      return {
        message: 'Role ADMIN adicionada com sucesso',
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          roles: roles
        }
      };
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  @ApiOperation({ summary: 'Verificar se um usuário pode acessar o painel admin' })
  @ApiResponse({
    status: 200,
    description: 'Retorna se o usuário pode acessar o painel admin',
    schema: {
      type: 'object',
      properties: {
        canAccessAdmin: {
          type: 'boolean',
          example: true
        },
        message: {
          type: 'string',
          example: 'Usuário pode acessar o painel admin'
        }
      }
    }
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email do usuário para verificar'
        }
      },
      required: ['email']
    }
  })
  @Post('/check-admin-access')
  async checkAdminAccess(@Body() body: { email: string }) {
    try {
      const user = await this.authService.findUserByEmail(body.email);
      
      if (!user) {
        return {
          canAccessAdmin: false,
          message: 'Usuário não encontrado'
        };
      }

      const hasAdminRole = user.role.toString() === 'ADMIN';
      const hasAdminAccount = !!user.admin;

      if (hasAdminRole || hasAdminAccount) {
        return {
          canAccessAdmin: true,
          message: 'Usuário pode acessar o painel admin'
        };
      } else {
        return {
          canAccessAdmin: false,
          message: 'Usuário precisa criar uma conta admin para acessar o painel'
        };
      }
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  @ApiOperation({ summary: 'Registrar uma nova conta (ADMIN, USER ou CUSTOMER)' })
  @ApiResponse({
    status: 201,
    type: AuthOutputDTO,
    description: 'Conta criada com sucesso. Retorna o token de acesso.',
  })
  @ApiResponse({
    status: 409,
    description: 'Usuário com este email já existe',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos fornecidos',
  })
  @ApiBody({ type: CreateUserInputDTO })
  @Post('/register')
  async register(
    @Body() body: CreateUserInputDTO,
    @ClientIp() ip: string,
    @Req() req: any,
  ) {
    try {
      const userAgent = req.headers['user-agent'];

      const result = await this.authService.createUser(body);

      console.log(`Novo usuário registrado: ${body.email} (${body.role}) - IP: ${ip} - User-Agent: ${userAgent}`);

      return result;
    } catch (error) {
      throw new HttpException(error.message, error.status || 500);
    }
  }

  @ApiOperation({
    summary: 'Esqueci minha senha - Gerar nova senha',
    description: 'Gera uma nova senha aleatória e envia por email para o usuário'
  })
  @ApiParam({
    name: 'email',
    required: true,
    type: String,
    description: 'Email do usuário que esqueceu a senha'
  })
  @ApiResponse({
    status: 200,
    description: 'Nova senha gerada e enviada por email com sucesso',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Nova senha enviada para o email'
        },
        email: {
          type: 'string',
          example: 'usuario@exemplo.com'
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Usuário não encontrado'
  })
  @ApiResponse({
    status: 409,
    description: 'Usuário inativo'
  })
  @Post('/recovery/:email')
  async recovery(@Param('email') email: string) {
    try {
      return await this.authService.passwordRecoveryLink(email);
    } catch (error) {
      throw new HttpException(error.message, error.status);
    }
  }

  @ApiOperation({ summary: 'Reset password using recovery token' })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Invalid or expired recovery token',
  })
  @ApiBody({ type: UpdateRecoveryPasswordInputDTO })
  @Post('/reset-password/:token')
  async resetPassword(
    @Param('token') token: string,
    @Body() body: UpdateRecoveryPasswordInputDTO,
  ) {
    try {
      return await this.authService.resetPassword(token, body);
    } catch (error) {
      throw new HttpException(error.message, error.status);
    }
  }

  @ApiOperation({ summary: 'Update user password' })
  @ApiResponse({
    status: 200,
    description: 'Password updated successfully',
  })
  @ApiBody({ type: UpdatePasswordInputDTO })
  @UseGuards(JwtAuthGuardUser)
  @ApiBearerAuth()
  @Post('/update-password')
  async updatePassword(@Req() req, @Body() body: UpdatePasswordInputDTO) {
    try {
      await this.authService.updatePassword(req.user.id, body);
      return { message: 'Password updated successfully' };
    } catch (error) {
      throw new HttpException(error.message, error.status);
    }
  }

  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({
    status: 200,
    description: 'User logged out successfully',
  })
  @UseGuards(JwtAuthGuardUser)
  @ApiBearerAuth()
  @Post('/logout')
  async userLogout(@Req() req: any) {
    return { message: 'User logged out successfully' };
  }
}
