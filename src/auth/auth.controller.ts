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

  @Post('register')
  @ApiOperation({ summary: 'Registrar novo usuário' })
  @ApiResponse({ status: 201, description: 'Usuário registrado com sucesso.' })
  @ApiResponse({ status: 409, description: 'E-mail já registrado.' })
  async register(@Body() body: CreateUserInputDTO) {
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