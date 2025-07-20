import * as bcrypt from 'bcrypt';
import { PrismaService } from 'prisma/prisma.service';
import { AppService } from 'src/app.service';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthOutputDTO,
  CreateUserInputDTO,
  LoginInputDTO,
  PayloadAuth,
  UpdatePasswordInputDTO,
  UpdateRecoveryPasswordInputDTO,
} from './dto/auth.dto';
import { Role } from 'src/types/interfaces/role';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prismaService: PrismaService,
    private appService: AppService,
  ) { }

  public generateHashPassword(password: string) {
    const salt = bcrypt.genSaltSync(9);
    const hash = bcrypt.hashSync(password, salt);
    return hash;
  }

  async validateUser(
    data: LoginInputDTO,
    ip: string,
    userAgent: string,
    expectedRole: 'USER' | 'ADMIN' | 'CUSTOMER',
  ): Promise<AuthOutputDTO> {
    const user = await this.prismaService.user.findUnique({
      where: {
        email: String(data.email).toLowerCase().trim(),
      },
      include: {
        admin: true,
        createdBy: true,
      }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role.toString() !== expectedRole) {
      throw new ConflictException(`User is not a ${expectedRole}`);
    }

    const validPassword = bcrypt.compareSync(data.password, user.password);

    if (!validPassword) {
      throw new ConflictException('Invalid password');
    }

    if (!user.isActive) {
      throw new ConflictException('User is inactive.');
    }

    const payload: PayloadAuth = {
      id: user.id,
      name: user.name || '',
      role: user.role.toString(),
      email: user.email,
      createdById: user.createdById,
    };

    const access_token = await this.login(payload);

    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.toString(),
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
  }

  async login(payload: PayloadAuth): Promise<string> {
    const access_token = this.jwtService.sign(payload);
    return access_token;
  }

  async passwordRecoveryLink(email: string) {
    try {
      const user = await this.prismaService.user.findUnique({
        where: {
          email: email.toLowerCase().trim(),
        },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      if (!user.isActive) {
        throw new ConflictException('Usuário inativo');
      }

      // Gerar nova senha aleatória
      const newPassword = this.appService.generateRandomPassword(12);
      const hashedPassword = this.generateHashPassword(newPassword);

      // Atualizar a senha no banco
      await this.prismaService.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      // Enviar email com a nova senha
      try {
        await this.appService.sendMail({
          to: user.email,
          subject: 'Nova senha gerada - EbookSIM',
          html: `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Nova Senha - EbookSIM</title>
              <style>
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                }
                
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                  background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
                  color: #ffffff;
                  line-height: 1.6;
                }
                
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 40px 20px;
                }
                
                .header {
                  text-align: center;
                  margin-bottom: 40px;
                }
                
                .logo {
                  font-size: 32px;
                  font-weight: 700;
                  color: #ffffff;
                  margin-bottom: 8px;
                  letter-spacing: -0.5px;
                }
                
                .subtitle {
                  color: #a1a1aa;
                  font-size: 16px;
                  font-weight: 400;
                }
                
                .card {
                  background: #1f1f1f;
                  border: 1px solid #2a2a2a;
                  border-radius: 12px;
                  padding: 32px;
                  margin-bottom: 24px;
                  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                }
                
                .title {
                  font-size: 28px;
                  font-weight: 700;
                  color: #ffffff;
                  margin-bottom: 16px;
                  text-align: center;
                }
                
                .text {
                  color: #d4d4d8;
                  font-size: 16px;
                  margin-bottom: 24px;
                  text-align: center;
                }
                
                .password-box {
                  background: #2a2a2a;
                  border: 2px solid #22c55e;
                  border-radius: 8px;
                  padding: 20px;
                  margin: 24px 0;
                  text-align: center;
                }
                
                .password-label {
                  color: #a1a1aa;
                  font-size: 14px;
                  font-weight: 500;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                  margin-bottom: 8px;
                }
                
                .password-value {
                  color: #22c55e;
                  font-size: 18px;
                  font-weight: 700;
                  font-family: 'Courier New', monospace;
                  letter-spacing: 2px;
                  background: #1a1a1a;
                  padding: 12px 16px;
                  border-radius: 6px;
                  display: inline-block;
                  margin-top: 8px;
                }
                
                .warning {
                  background: #dc2626;
                  color: #ffffff;
                  padding: 16px;
                  border-radius: 8px;
                  margin: 24px 0;
                  text-align: center;
                  font-weight: 600;
                }
                
                .cta-button {
                  display: inline-block;
                  background: #22c55e;
                  color: #000000;
                  text-decoration: none;
                  padding: 12px 24px;
                  border-radius: 8px;
                  font-weight: 600;
                  font-size: 14px;
                  text-align: center;
                  margin: 24px 0;
                  transition: all 0.2s ease;
                }
                
                .cta-button:hover {
                  background: #16a34a;
                  transform: translateY(-1px);
                }
                
                .footer {
                  text-align: center;
                  margin-top: 40px;
                  padding-top: 24px;
                  border-top: 1px solid #2a2a2a;
                }
                
                .footer-text {
                  color: #71717a;
                  font-size: 12px;
                  line-height: 1.5;
                }
                
                .badge {
                  display: inline-block;
                  background: #dc2626;
                  color: #ffffff;
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 11px;
                  font-weight: 600;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                }
                
                @media (max-width: 600px) {
                  .container {
                    padding: 20px 16px;
                  }
                  
                  .card {
                    padding: 24px;
                  }
                  
                  .title {
                    font-size: 24px;
                  }
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <div class="logo">EbookSIM</div>
                  <div class="subtitle">Sua biblioteca digital</div>
                </div>
                
                <div class="card">
                  <div class="badge">Nova Senha</div>
                  <h1 class="title">🔐 Nova senha gerada</h1>
                  <p class="text">
                    Olá <strong>${user.name}</strong>, uma nova senha foi gerada para sua conta.
                  </p>
                  
                  <div class="password-box">
                    <div class="password-label">Sua nova senha</div>
                    <div class="password-value">${newPassword}</div>
                  </div>
                  
                  <div class="warning">
                    ⚠️ Guarde esta senha em um local seguro e altere-a após fazer login!
                  </div>
                  
                  <p class="text">
                    Use esta senha para fazer login na sua conta. Recomendamos que você altere esta senha 
                    para uma de sua preferência após fazer login.
                  </p>
                  
                  <div style="text-align: center;">
                    <a href="${process.env.FRONTEND_URL || 'https://ebooksim.com'}" class="cta-button">
                      🚀 Fazer Login
                    </a>
                  </div>
                </div>
                
                <div class="footer">
                  <p class="footer-text">
                    Se você não solicitou esta alteração, entre em contato conosco imediatamente.<br>
                    Este email foi enviado automaticamente. Por favor, não responda a este email.
                  </p>
                </div>
              </div>
            </body>
            </html>
          `,
        });
      } catch (emailError) {
        console.error('Erro ao enviar email de nova senha:', emailError);
        // Se o email falhar, reverter a mudança de senha
        await this.prismaService.user.update({
          where: { id: user.id },
          data: { password: user.password }, // Restaurar senha original
        });
        throw new InternalServerErrorException('Erro ao enviar email. Tente novamente.');
      }

      return {
        message: 'Nova senha enviada para o email',
        email: user.email
      };
    } catch (error) {
      console.error('Erro em passwordRecoveryLink:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Erro ao processar recuperação de senha.');
    }
  }

  async resetPassword(token: string, data: UpdateRecoveryPasswordInputDTO) {
    try {
      // Validar se as senhas coincidem
      if (data.password !== data.confirmPassword) {
        throw new ConflictException('As senhas não coincidem');
      }

      // Verificar o token
      const payload = this.jwtService.verify(token);

      const user = await this.prismaService.user.findUnique({
        where: { id: payload.id },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (!user.isActive) {
        throw new ConflictException('User inactive');
      }

      // Atualizar a senha
      const newHashedPassword = this.generateHashPassword(data.password);

      await this.prismaService.user.update({
        where: { id: user.id },
        data: { password: newHashedPassword },
      });

      return { message: 'Password reset successfully' };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new ConflictException('Recovery token has expired');
      }
      if (error.name === 'JsonWebTokenError') {
        throw new ConflictException('Invalid recovery token');
      }
      throw error;
    }
  }

  async updatePassword(
    userId: string,
    data: UpdatePasswordInputDTO,
  ): Promise<void> {
    if (data.password !== data.confirmPassword) {
      throw new ConflictException('As senhas não coincidem');
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOldPasswordValid = bcrypt.compareSync(
      data.oldPassword,
      user.password,
    );
    if (!isOldPasswordValid) {
      throw new ConflictException('Invalid old password');
    }

    const newHashedPassword = this.generateHashPassword(data.password);

    await this.prismaService.user.update({
      where: { id: userId },
      data: { password: newHashedPassword },
    });
  }

  async createUser(data: CreateUserInputDTO, creatorUserId?: string): Promise<AuthOutputDTO> {
    if (data.password !== data.confirmPassword) {
      throw new ConflictException('As senhas não coincidem');
    }

    const existingUserByEmail = await this.prismaService.user.findUnique({
      where: {
        email: data.email,
      },
    });

    if (existingUserByEmail) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = this.generateHashPassword(data.password);

    const newUser = await this.prismaService.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashedPassword,
        role: data.role as Role,
        isActive: true,
        createdById: creatorUserId,
      },
      include: {
        admin: true,
        createdBy: true,
      }
    });

    if (newUser.role === Role.ADMIN) {
      await this.prismaService.admin.create({
        data: {
          userId: newUser.id,
        },
      });
    }

    // Enviar email de boas-vindas
    try {
      await this.appService.sendMail({
        to: newUser.email,
        subject: 'Bem-vindo ao EbookSIM! 🎉',
        html: `
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Bem-vindo ao EbookSIM</title>
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
                color: #ffffff;
                line-height: 1.6;
              }
              
              .container {
                max-width: 600px;
                margin: 0 auto;
                padding: 40px 20px;
              }
              
              .header {
                text-align: center;
                margin-bottom: 40px;
              }
              
              .logo {
                font-size: 32px;
                font-weight: 700;
                color: #ffffff;
                margin-bottom: 8px;
                letter-spacing: -0.5px;
              }
              
              .subtitle {
                color: #a1a1aa;
                font-size: 16px;
                font-weight: 400;
              }
              
              .card {
                background: #1f1f1f;
                border: 1px solid #2a2a2a;
                border-radius: 12px;
                padding: 32px;
                margin-bottom: 24px;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
              }
              
              .welcome-title {
                font-size: 28px;
                font-weight: 700;
                color: #ffffff;
                margin-bottom: 16px;
                text-align: center;
              }
              
              .welcome-text {
                color: #d4d4d8;
                font-size: 16px;
                margin-bottom: 24px;
                text-align: center;
              }
              
              .user-info {
                background: #2a2a2a;
                border-radius: 8px;
                padding: 20px;
                margin: 24px 0;
              }
              
              .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-top: 16px;
              }
              
              .info-item {
                display: flex;
                flex-direction: column;
              }
              
              .info-label {
                color: #a1a1aa;
                font-size: 12px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 4px;
              }
              
              .info-value {
                color: #ffffff;
                font-size: 14px;
                font-weight: 600;
                margin-left: 6px;
              }
              
              .features {
                margin: 32px 0;
              }
              
              .features-title {
                font-size: 18px;
                font-weight: 600;
                color: #ffffff;
                margin-bottom: 16px;
              }
              
              .feature-list {
                list-style: none;
              }
              
              .feature-item {
                display: flex;
                align-items: center;
                margin-bottom: 12px;
                color: #d4d4d8;
                font-size: 14px;
              }
              
              .feature-icon {
                width: 16px;
                height: 16px;
                margin-right: 12px;
                color: #22c55e;
              }
              
              .cta-button {
                display: inline-block;
                background: #22c55e;
                color: #000000;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 14px;
                text-align: center;
                margin: 24px 0;
                transition: all 0.2s ease;
              }
              
              .cta-button:hover {
                background: #16a34a;
                transform: translateY(-1px);
              }
              
              .footer {
                text-align: center;
                margin-top: 40px;
                padding-top: 24px;
                border-top: 1px solid #2a2a2a;
              }
              
              .footer-text {
                color: #71717a;
                font-size: 12px;
                line-height: 1.5;
              }
              
              .badge {
                display: inline-block;
                background: #22c55e;
                color: #000000;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }
              
              @media (max-width: 600px) {
                .container {
                  padding: 20px 16px;
                }
                
                .card {
                  padding: 24px;
                }
                
                .info-grid {
                  grid-template-columns: 1fr;
                }
                
                .welcome-title {
                  font-size: 24px;
                }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="logo">EbookSIM</div>
                <div class="subtitle">Sua biblioteca digital</div>
              </div>
              
              <div class="card">
                <h1 class="welcome-title">🎉 Bem-vindo ao EbookSIM!</h1>
                <p class="welcome-text">
                  Olá <strong>${newUser.name}</strong>, estamos muito felizes em tê-lo conosco! 
                  Sua conta foi criada com sucesso e você já pode começar a explorar nossa biblioteca.
                </p>
                
                <div class="user-info">
                  <div class="badge">Conta Criada</div>
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="info-label">Nome</span>
                      <span class="info-value">${newUser.name}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Email</span>
                      <span class="info-value">${newUser.email}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">Data de Criação</span>
                      <span class="info-value">${new Date(newUser.createdAt).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>
                </div>
                
                <div class="features">
                  <h3 class="features-title">✨ O que você pode fazer agora:</h3>
                  <ul class="feature-list">
                    <li class="feature-item">
                      <span class="feature-icon">📚</span>
                      Explorar nossa biblioteca de ebooks
                    </li>
                    <li class="feature-item">
                      <span class="feature-icon">💚</span>
                      Adicionar livros aos favoritos
                    </li>
                    <li class="feature-item">
                      <span class="feature-icon">🛒</span>
                      Fazer compras seguras
                    </li>
                    <li class="feature-item">
                      <span class="feature-icon">🔔</span>
                      Receber notificações sobre promoções
                    </li>
                    <li class="feature-item">
                      <span class="feature-icon">⭐</span>
                      Avaliar e comentar sobre os livros
                    </li>
                  </ul>
                </div>
                
                <div style="text-align: center;">
                  <a href="${process.env.FRONTEND_URL || 'https://ebooksim.com'}" class="cta-button">
                    🚀 Acessar Plataforma
                  </a>
                </div>
              </div>
              
              <div class="footer">
                <p class="footer-text">
                  Se você tiver alguma dúvida, não hesite em entrar em contato conosco.<br>
                  Agradecemos por escolher o EbookSIM!
                </p>
                <p class="footer-text" style="margin-top: 16px;">
                  Este email foi enviado automaticamente. Por favor, não responda a este email.
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
      });
    } catch (error) {
      console.error('Erro ao enviar email de boas-vindas:', error);
      // Não interrompe o fluxo se o email falhar
    }

    const payload: PayloadAuth = {
      id: newUser.id,
      name: newUser.name || '',
      role: newUser.role.toString(),
      email: newUser.email,
      createdById: newUser.createdById,
    };

    const access_token = await this.login(payload);

    const userResponse = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role.toString(),
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
      isActive: newUser.isActive,
      createdById: newUser.createdById,
      admin: newUser.admin
    };

    return {
      token: access_token,
      user: userResponse,
    };
  }
}