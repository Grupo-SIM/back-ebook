export const productionConfig = {
  // Configurações específicas para produção
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
    credentials: true,
  },
  // Configurações de segurança para produção
  security: {
    helmet: true,
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutos
      max: 100, // limite de 100 requests por IP
    },
  },
  // Configurações de logging para produção
  logging: {
    level: 'warn',
    enableSwagger: false, // Desabilitar Swagger em produção
  },
  // Configurações de arquivos estáticos
  staticFiles: {
    uploads: '/uploads',
    maxFileSize: '100mb',
  },
}; 
