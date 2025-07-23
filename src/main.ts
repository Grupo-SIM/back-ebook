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
const PORT = 3332;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

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

  const config = new DocumentBuilder()
    .setTitle('Ebook API')
    .setDescription('Ebook API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const { httpAdapter } = app.get(HttpAdapterHost);

  app.use(bodyParser.json({ limit: '100mb' }));
  app.use(requestIp.mw());
  app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
  app.enableCors();

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  await app.listen(PORT);
}

bootstrap().finally(() => {
  console.log(`listening on port ${PORT}`);
});
