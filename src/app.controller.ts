import { Controller, Get, Post, Body, Param, UseGuards, Req, Res, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'Teste do serviço de email' })
  @ApiResponse({ status: 200, description: 'Email enviado com sucesso' })
  async testEmailService() {
    return this.appService.testEmailService('test@example.com', 'Test User');
  }
}
