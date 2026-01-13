import { Controller, Get, Post, Body, Param, UseGuards, Req, Res, HttpStatus, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { TestEmailDto } from './dto/test-email.dto';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Health check da API' })
  @ApiResponse({ status: 200, description: 'API funcionando' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({ summary: 'Status de saúde da API' })
  @ApiResponse({ status: 200, description: 'API saudável' })
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  @Get('test-routes')
  @ApiOperation({ summary: 'Teste de rotas disponíveis' })
  @ApiResponse({ status: 200, description: 'Rotas listadas' })
  getTestRoutes() {
    return {
      message: 'Rotas de teste disponíveis',
      routes: {
        auth: [
          'POST /auth/user/login',
          'POST /auth/admin/login',
          'POST /auth/customer/login',
        ],
        books: [
          'GET /books/purchased',
          'GET /books/10/download',
          'GET /books/10/purchase-status',
        ],
        test: [
          'GET /test-routes',
          'GET /health',
        ],
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Post('/test-email')
  @ApiOperation({ summary: 'Teste do serviço de email SMTP - Envie um email de teste' })
  @ApiResponse({ status: 200, description: 'Email enviado com sucesso' })
  @ApiResponse({ status: 400, description: 'Erro ao enviar email' })
  async testEmailService(@Body() testEmailDto: TestEmailDto) {
    const email = testEmailDto?.email;
    
    if (!email) {
      return {
        success: false,
        message: 'Por favor, forneça um email no corpo da requisição. Exemplo: { "email": "seu@email.com" }',
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await this.appService.testEmailService(email, 'Usuário de Teste');
      return {
        success: true,
        message: `Email de teste enviado com sucesso para ${email}`,
        details: result,
        timestamp: new Date().toISOString(),
        smtpConfig: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          secure: process.env.SMTP_SECURE,
          user: process.env.SMTP_USER,
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Erro ao enviar email de teste',
        error: error.message,
        timestamp: new Date().toISOString(),
        smtpConfig: {
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT,
          secure: process.env.SMTP_SECURE,
          user: process.env.SMTP_USER,
        }
      };
    }
  }
}
