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
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
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
import { JwtAuthGuardUser, JwtAuthGuardAdmin } from './guard/jwt-auth.guard';

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

  @ApiOperation({ summary: 'Create admin account for existing user with same email' })
  @ApiResponse({
    status: 200,
    type: AuthOutputDTO,
    description: 'Creates admin account for existing user with same email',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        password: { type: 'string' },
        name: { type: 'string' },
        cpf: { type: 'string', example: '12345678909' }
      },
      required: ['email', 'password', 'name', 'cpf']
    }
  })
  @Post('/create-admin-account')
  async createAdminAccount(@Body() body: { email: string; password: string; name: string; cpf: string }) {
    try {
      const createUserData: CreateUserInputDTO = {
        email: body.email,
        password: body.password,
        confirmPassword: body.password,
        name: body.name,
        cpf: String(body.cpf ?? '').replace(/\D/g, ''),
        role: 'ADMIN'
      };

      const result = await this.authService.createUser(createUserData);
      return result;
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
  @Post('register')
  @ApiOperation({ summary: 'Registrar novo usuário' })
  @ApiResponse({ status: 201, description: 'Usuário registrado com sucesso.' })
  @ApiResponse({ status: 409, description: 'E-mail já registrado.' })
  async register(
    @Body() body: CreateUserInputDTO,
    @ClientIp() ip: string,
    @Req() req: any,
  ) {
    try {
      return await this.authService.createUser(body);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  // NOVOS ENDPOINTS PARA SINCRONIZAÇÃO COM API DOM

  @Post('sync-tokens')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Sincronizar tokens existentes da API DOM' })
  @ApiResponse({ status: 200, description: 'Tokens sincronizados com sucesso.' })
  async syncTokens(@Body() body: { email: string; password: string; userId: string }) {
    try {
      await this.authService.syncExistingTokens(body.userId, body.email, body.password);
      return { message: 'Tokens sincronizados com sucesso' };
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  @Post('get-api-dom-tokens')
  @ApiOperation({ summary: 'Buscar tokens da API DOM' })
  @ApiResponse({ status: 200, description: 'Tokens buscados com sucesso.' })
  async getApiDomTokens(@Body() body: { email: string; password: string }) {
    try {
      return await this.authService.getApiDomTokens(body.email, body.password);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  @Post('force-sync-user')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Forçar sincronização de usuário com API DOM' })
  @ApiResponse({ status: 200, description: 'Usuário sincronizado com sucesso.' })
  async forceSyncUser(@Body() body: { userId: string; email: string; password: string; name: string }) {
    try {
      // Sincronizar com API DOM
      await this.authService.syncUserWithApiDom({
        id: body.userId,
        name: body.name,
        email: body.email,
        role: 'ADMIN'
      }, body.password);

      return { message: 'Usuário sincronizado com sucesso' };
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  @Post('force-sync-by-email')
  @UseGuards(JwtAuthGuardAdmin)
  @ApiOperation({ summary: 'Forçar sincronização de usuário por email com API DOM' })
  @ApiResponse({ status: 200, description: 'Usuário sincronizado com sucesso.' })
  async forceSyncByEmail(@Body() body: { email: string; password: string }) {
    try {
      // Buscar usuário usando o método público do AuthService
      const user = await this.authService.findUserByEmail(body.email);

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      await this.authService.syncUserWithApiDom(user, body.password);

      return {
        message: 'Sincronização forçada realizada com sucesso',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    } catch (error) {
      throw new InternalServerErrorException(`Erro na sincronização: ${error.message}`);
    }
  }

  @Post('test-sync')
  @ApiOperation({ summary: 'Testar sincronização com API DOM' })
  @ApiResponse({ status: 200, description: 'Teste realizado com sucesso.' })
  async testSync(@Body() body: { email: string; password: string; name: string }) {
    try {
      console.log('=== TESTE DE SINCRONIZAÇÃO ===');
      console.log('Dados de teste:', { email: body.email, name: body.name, hasPassword: !!body.password });

      // Testar registro na API DOM
      const registerPayload = {
        name: body.name,
        email: body.email,
        password: body.password,
      };

      console.log('Enviando payload de registro:', { ...registerPayload, password: '***' });

      const registerResponse = await fetch('https://api-dom.jbmidia.com/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
          'origin': 'https://admin.ebooksim.com',
        },
        body: JSON.stringify(registerPayload),
      });

      console.log('Status do registro:', registerResponse.status);
      console.log('Headers do registro:', Object.fromEntries(registerResponse.headers.entries()));

      if (!registerResponse.ok) {
        const errorText = await registerResponse.text();
        console.log('Erro no registro:', errorText);
        throw new Error(`Erro ao registrar na API DOM: ${registerResponse.status} - ${errorText}`);
      }

      const registerData = await registerResponse.json();
      console.log('Registro bem-sucedido:', registerData);

      // Testar geração de token
      const tokenPayload = {
        email: body.email,
        password: body.password,
        title: `Token para ${body.name}`,
      };

      console.log('Enviando payload de token:', { ...tokenPayload, password: '***' });

      const tokenResponse = await fetch('https://api-dom.jbmidia.com/auth/generate-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
          'origin': 'https://admin.ebooksim.com',
        },
        body: JSON.stringify(tokenPayload),
      });

      console.log('Status do token:', tokenResponse.status);
      console.log('Headers do token:', Object.fromEntries(tokenResponse.headers.entries()));

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.log('Erro no token:', errorText);
        throw new Error(`Erro ao gerar token na API DOM: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Token gerado:', tokenData);

      // Testar listagem de tokens
      const tokensData = await this.authService.getApiDomTokens(body.email, body.password);
      console.log('Tokens listados:', tokensData);

      console.log('=== TESTE CONCLUÍDO COM SUCESSO ===');

      return {
        message: 'Sincronização testada com sucesso',
        registerData,
        tokenData,
        tokensData,
      };
    } catch (error) {
      console.error('Erro no teste:', error);
      throw new ConflictException(error.message);
    }
  }

  @Post('test-connection')
  @ApiOperation({ summary: 'Testar conexão com API DOM' })
  @ApiResponse({ status: 200, description: 'Conexão testada com sucesso.' })
  async testConnection() {
    try {
      console.log('=== TESTE DE CONEXÃO COM API DOM ===');

      // Testar se a API DOM está acessível
      const response = await fetch('https://api-dom.jbmidia.com/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
          'origin': 'https://admin.ebooksim.com',
        },
        body: JSON.stringify({
          name: 'test',
          email: 'test@test.com',
          password: 'test123',
        }),
      });

      console.log('Status da conexão:', response.status);
      console.log('Headers da resposta:', Object.fromEntries(response.headers.entries()));

      const responseText = await response.text();
      console.log('Resposta da API:', responseText);

      return {
        message: 'Conexão testada',
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        response: responseText,
      };
    } catch (error) {
      console.error('Erro na conexão:', error);
      throw new ConflictException(`Erro de conexão: ${error.message}`);
    }
  }

  @Post('test-custom-fees')
  @ApiOperation({ summary: 'Testar criação de taxas customizadas' })
  @ApiResponse({ status: 200, description: 'Teste de taxas customizadas executado' })
  async testCustomFees(@Body() body: { userId: string; adminToken: string; userName: string }) {
    try {
      console.log('🧪 Testando criação de taxas customizadas...');

      const customFeeData = {
        userId: body.userId,
        percentage: 14.99,
        fixedFee: 4.00,
        type: 'BOTH',
        description: `Taxa especial: PIX 12,99% + R$ 3,00 | Cartão 14,99% + R$ 4,00 - ${body.userName}`,
        isActive: true,
      };

      console.log('Payload de teste:', customFeeData);

      const response = await fetch('https://api-dom.jbmidia.com/custom-fees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
          'x-access-token': body.adminToken,
          'origin': 'https://admin.ebooksim.com',
        },
        body: JSON.stringify(customFeeData),
      });

      const status = response.status;
      const responseText = await response.text();

      console.log(`📡 Status da criação: ${status}`);
      console.log(`📄 Resposta: ${responseText}`);

      if (response.ok) {
        const result = JSON.parse(responseText);
        return {
          success: true,
          message: 'Taxas customizadas criadas com sucesso',
          status,
          result,
          details: 'Teste de criação de taxas customizadas passou'
        };
      } else {
        return {
          success: false,
          message: 'Erro ao criar taxas customizadas',
          status,
          error: responseText,
          details: 'Verifique o token e os dados enviados'
        };
      }

    } catch (error) {
      console.error('❌ Erro ao testar taxas customizadas:', error);
      return {
        success: false,
        message: 'Erro ao testar taxas customizadas',
        error: error.message,
        details: 'Verifique a conexão com API DOM'
      };
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
