import 'reflect-metadata';
import 'es6-shim';
import * as bodyParser from 'body-parser';
import * as requestIp from 'request-ip';
import { ValidationPipe } from '@nestjs/common';
import {
  HttpAdapterHost,
  NestFactory,
} from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

dotenv.config();
const PORT = process.env.PORT || 3332;

async function bootstrap() {
  console.log('🚀 Iniciando aplicação NestJS...');
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌 Porta: ${PORT}`);
  console.log(`📁 Diretório de trabalho: ${process.cwd()}`);

  const app = await NestFactory.create(AppModule, { 
    cors: true,
    logger: ['log', 'error', 'warn', 'debug', 'verbose']
  });

  console.log('✅ Aplicação NestJS criada com sucesso');

  // ✅ CORRIGIDO: Adicionado 'transformOptions' para conversão implícita de tipos.
  // Isso é essencial para query params e ajuda com dados de formulários.
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  console.log('✅ ValidationPipe configurado');

  // ✅ Swagger sempre habilitado
  const config = new DocumentBuilder()
    .setTitle('Ebook API')
    .setDescription('Ebook API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  console.log('✅ Swagger configurado');

  const { httpAdapter } = app.get(HttpAdapterHost);

  app.use(bodyParser.json({ limit: '100mb' }));
  app.use(requestIp.mw());
  app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
  app.enableCors();

  console.log('✅ Middlewares configurados');

  // ✅ NOVO: Middleware para servir arquivos estáticos da pasta uploads
  const express = require('express');
  const path = require('path');
  
  // Em produção (Docker), o caminho é /usr/src/app/uploads
  // Em desenvolvimento, o caminho é process.cwd()/uploads
  const uploadsPath = path.join(process.cwd(), 'uploads');
  console.log(`📁 Caminho dos uploads: ${uploadsPath}`);
  
  app.use('/uploads', express.static(uploadsPath));

  console.log('✅ Arquivos estáticos configurados');

  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  });

  await app.listen(PORT);
  console.log(`🎉 Aplicação iniciada com sucesso na porta ${PORT}`);
  console.log(`📚 Swagger disponível em: http://localhost:${PORT}/api`);
  console.log(`🔗 Endpoints de autenticação:`);
  console.log(`   - POST /auth/user/login`);
  console.log(`   - POST /auth/admin/login`);
  console.log(`   - POST /auth/customer/login`);
  console.log(`🔗 Endpoints de livros:`);
  console.log(`   - GET /books/purchased`);
  console.log(`   - GET /books/10/download`);
  console.log(`   - GET /books/10/purchase-status`);
}

bootstrap().catch((error) => {
  console.error('💥 Erro ao iniciar aplicação:', error);
  process.exit(1);
});
