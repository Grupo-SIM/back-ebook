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