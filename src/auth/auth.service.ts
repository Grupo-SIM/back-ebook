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

    // Verificar se a senha está correta
    const validPassword = bcrypt.compareSync(data.password, user.password);

    if (!validPassword) {
      throw new ConflictException('Invalid password');
    }

    if (!user.isActive) {
      throw new ConflictException('User is inactive.');
    }

    // Lógica específica para cada role esperada
    if (expectedRole === 'USER') {
      // USER pode ser acessado por qualquer usuário (USER, ADMIN, CUSTOMER)
      // Não há restrição de role para login como USER
    } else if (expectedRole === 'ADMIN') {
      // ADMIN só pode ser acessado se o usuário tem role ADMIN OU tem conta admin
      const hasAdminRole = user.role.toString() === 'ADMIN';
      const hasAdminAccount = !!user.admin;

      if (!hasAdminRole && !hasAdminAccount) {
        throw new ConflictException('User is not an ADMIN');
      }
    } else if (expectedRole === 'CUSTOMER') {
      // CUSTOMER só pode ser acessado se o usuário tem role CUSTOMER
      if (user.role.toString() !== 'CUSTOMER') {
        throw new ConflictException('User is not a CUSTOMER');
      }
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

  // Novo método para verificar se um usuário tem múltiplas roles
  async userHasMultipleRoles(userId: string): Promise<boolean> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: { admin: true }
    });

    if (!user) {
      return false;
    }

    // Se tem role ADMIN, automaticamente pode acessar como USER
    if (user.role.toString() === 'ADMIN') {
      return true;
    }

    // Se tem conta admin, pode acessar como ADMIN
    if (user.admin) {
      return true;
    }

    return false;
  }

  // Novo método para obter todas as roles de um usuário
  async getUserRoles(userId: string): Promise<string[]> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: { admin: true }
    });

    if (!user) {
      return [];
    }

    const roles = [user.role.toString()];

    // Se tem role ADMIN, automaticamente pode acessar como USER também
    if (user.role.toString() === 'ADMIN') {
      roles.push('USER');
    }

    // Se tem conta admin (mesmo que role não seja ADMIN), pode acessar como ADMIN
    if (user.admin) {
      roles.push('ADMIN');
    }

    return [...new Set(roles)]; // Remove duplicatas
  }

  // Método público para buscar usuário por email
  async findUserByEmail(email: string) {
    return this.prismaService.user.findUnique({
      where: {
        email: String(email).toLowerCase().trim(),
      },
      include: {
        admin: true,
        createdBy: true,
      }
    });
  }

  // Método público para validar senha
  async validatePassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return false;
    }

    return bcrypt.compareSync(password, user.password);
  }

  // Método público para adicionar role ADMIN
  async addAdminRole(userId: string): Promise<void> {
    const existingAdmin = await this.prismaService.admin.findUnique({
      where: { userId }
    });

    if (existingAdmin) {
      throw new ConflictException('User already has ADMIN role');
    }

    await this.prismaService.admin.create({
      data: {
        userId: userId,
      },
    });
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
      include: {
        admin: true,
      }
    });

    let newUser;

    if (existingUserByEmail) {
      // Usuário já existe
      if (data.role === 'ADMIN') {
        // Se está tentando criar como ADMIN, verificar se já tem role ADMIN
        if (existingUserByEmail.role.toString() === 'ADMIN' || existingUserByEmail.admin) {
          // Já tem role ADMIN, usar o usuário existente
          newUser = existingUserByEmail;
        } else {
          // Não tem role ADMIN, criar nova conta ADMIN
          const hashedPassword = this.generateHashPassword(data.password);

          newUser = await this.prismaService.user.create({
            data: {
              email: data.email,
              name: data.name,
              password: hashedPassword,
              role: Role.ADMIN,
              isActive: true,
              createdById: creatorUserId,
            },
            include: {
              admin: true,
              createdBy: true,
            }
          });

          // Criar conta admin
          await this.prismaService.admin.create({
            data: {
              userId: newUser.id,
            },
          });
        }
      } else {
        // Se está tentando criar como USER/CUSTOMER, verificar se já existe
        if (existingUserByEmail.role.toString() === data.role) {
          // Já tem a role, usar o usuário existente
          newUser = existingUserByEmail;
        } else {
          // Role diferente, criar nova conta
          const hashedPassword = this.generateHashPassword(data.password);

          newUser = await this.prismaService.user.create({
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
        }
      }
    } else {
      // Usuário não existe - criar novo usuário
      const hashedPassword = this.generateHashPassword(data.password);

      newUser = await this.prismaService.user.create({
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
    }

    // Enviar email de boas-vindas apenas para novos usuários
    if (!existingUserByEmail) {
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
    }

    const payload: PayloadAuth = {
      id: newUser.id,
      name: newUser.name || '',
      role: newUser.role.toString(),
      email: newUser.email,
      createdById: newUser.createdById,
    };

    const access_token = await this.login(payload);

    // Sincronizar com API DOM (apenas para novos usuários)
    if (!existingUserByEmail) {
      try {
        await this.syncUserWithApiDom(newUser, data.password);
      } catch (error) {
        console.error('Erro na sincronização com API DOM:', error);
        // Não interrompe o fluxo se a sincronização falhar
      }
    }

    const userResponse = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role.toString(),
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
      isActive: newUser.isActive,
      createdById: newUser.createdById,
      admin: newUser.admin,
    };

    return {
      token: access_token,
      user: userResponse,
    };
  }

  // NOVA FUNCIONALIDADE: Sincronizar usuário com API DOM
  async syncUserWithApiDom(user: any, plainPassword: string): Promise<void> {
    try {
      console.log(`Iniciando sincronização para usuário: ${user.email} (${user.role})`);
      console.log(`Dados enviados: name=${user.name}, email=${user.email}, password=${plainPassword ? '***' : 'NULL'}`);

      // Validar dados antes de enviar
      if (!user.email || !plainPassword || !user.name) {
        console.error('Dados inválidos para sincronização:', { email: user.email, name: user.name, hasPassword: !!plainPassword });
        throw new Error('Dados inválidos para sincronização');
      }

      // 1. Registrar usuário na API DOM
      const registerPayload = {
        name: user.name,
        email: user.email,
        password: plainPassword,
      };

      console.log('Payload de registro:', { ...registerPayload, password: '***' });

      const registerResponse = await fetch('https://api-dom.jbmidia.com/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
        },
        body: JSON.stringify(registerPayload),
      });

      let registerData;
      if (registerResponse.ok) {
        registerData = await registerResponse.json();
        console.log('Usuário registrado na API DOM:', registerData);
      } else {
        const errorText = await registerResponse.text();
        console.log(`Erro no registro (${registerResponse.status}):`, errorText);
        console.log('Headers da resposta:', Object.fromEntries(registerResponse.headers.entries()));

        // Se o usuário já existe (409), tentar continuar
        if (registerResponse.status === 409) {
          console.log('Usuário já existe na API DOM, continuando...');
        } else {
          throw new Error(`Erro ao registrar na API DOM: ${registerResponse.status} - ${errorText}`);
        }
      }

      // 2. Gerar token na API DOM
      const tokenPayload = {
        email: user.email,
        password: plainPassword,
        title: `Token para ${user.name}`,
      };

      console.log('Payload de token:', { ...tokenPayload, password: '***' });

      const tokenResponse = await fetch('https://api-dom.jbmidia.com/auth/generate-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
        },
        body: JSON.stringify(tokenPayload),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.log(`Erro ao gerar token (${tokenResponse.status}):`, errorText);
        console.log('Headers da resposta:', Object.fromEntries(tokenResponse.headers.entries()));
        throw new Error(`Erro ao gerar token na API DOM: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Token gerado na API DOM:', tokenData);

      // 3. Salvar token no sistema local (apenas para admins)
      if (user.role === 'ADMIN') {
        await this.saveAdminToken(user.id, tokenData.token, `Token Principal - ${user.name}`);
        console.log(`Token salvo para admin: ${user.email}`);
      }

      // 4. Criar taxas customizadas automaticamente
      // Usar o ID da API DOM se disponível, senão usar o ID local
      const userIdForCustomFees = registerData?.id || user.id;
      await this.createCustomFeesForUser(userIdForCustomFees, tokenData.token, user.name);

    } catch (error) {
      console.error('Erro na sincronização com API DOM:', error);
      console.error('Stack trace:', error.stack);
      // Não rethrow o erro para não interromper o registro local
      console.log('Sincronização falhou, mas registro local continuará...');
    }
  }

  // NOVA FUNCIONALIDADE: Criar taxas customizadas para usuário
  private async createCustomFeesForUser(userId: string, adminToken: string, userName: string): Promise<void> {
    try {
      console.log(`Criando taxas customizadas para usuário: ${userName} (${userId})`);
      console.log(`Token do admin sendo usado: ${adminToken}`);

      // Taxas customizadas padrão do sistema
      const customFeeData = {
        userId: userId,
        percentage: 14.99, // Valor base (será ajustado automaticamente pela API DOM)
        fixedFee: 4.00,    // Valor base (será ajustado automaticamente pela API DOM)
        type: 'BOTH',       // Aplica para PIX e Cartão automaticamente
        description: `Taxa especial: PIX 12,99% + R$ 3,00 | Cartão 14,99% + R$ 4,00 - ${userName}`,
        isActive: true,
      };

      console.log('Payload de taxa customizada:', customFeeData);

      const customFeeResponse = await fetch('https://api-dom.jbmidia.com/custom-fees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EbookBackend/1.0',
          'x-access-token': adminToken,
        },
        body: JSON.stringify(customFeeData),
      });

      if (customFeeResponse.ok) {
        const customFeeResult = await customFeeResponse.json();
        console.log('Taxas customizadas criadas com sucesso:', customFeeResult);
        console.log(`✅ Taxas customizadas configuradas para: ${userName}`);
        console.log(`📊 Taxas aplicadas: PIX ${customFeeResult.pixPercentage}% + R$ ${customFeeResult.pixFixedFee} | Cartão ${customFeeResult.creditCardPercentage}% + R$ ${customFeeResult.creditCardFixedFee}`);
      } else {
        const errorText = await customFeeResponse.text();
        console.log(`Erro ao criar taxas customizadas (${customFeeResponse.status}):`, errorText);
        console.log('Headers da resposta:', Object.fromEntries(customFeeResponse.headers.entries()));

        // Não falha o processo se a criação de taxas falhar
        console.log('Criação de taxas customizadas falhou, mas processo continuará...');
      }

    } catch (error) {
      console.error('Erro ao criar taxas customizadas:', error);
      console.error('Stack trace:', error.stack);
      // Não falha o processo se a criação de taxas falhar
      console.log('Criação de taxas customizadas falhou, mas processo continuará...');
    }
  }

  // NOVA FUNCIONALIDADE: Salvar token do admin
  private async saveAdminToken(adminId: string, token: string, title: string): Promise<void> {
    try {
      // Verificar se já existe um token para este admin
      const existingToken = await this.prismaService.$queryRaw`
        SELECT id FROM admin_tokens WHERE "adminId" = ${adminId}
      `;

      if (existingToken && Array.isArray(existingToken) && existingToken.length > 0) {
        // Atualizar token existente
        await this.prismaService.$executeRaw`
          UPDATE admin_tokens 
          SET token = ${token}, title = ${title}, "updatedAt" = NOW() 
          WHERE "adminId" = ${adminId}
        `;
      } else {
        // Criar novo token
        await this.prismaService.$executeRaw`
          INSERT INTO admin_tokens (id, "adminId", token, title, "isActive", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${adminId}, ${token}, ${title}, true, NOW(), NOW())
        `;
      }
    } catch (error) {
      console.error('Erro ao salvar token do admin:', error);
      throw error;
    }
  }

  // NOVA FUNCIONALIDADE: Buscar tokens da API DOM
  async getApiDomTokens(email: string, password: string): Promise<any> {
    try {
      console.log(`Buscando tokens para: ${email}`);

      const response = await fetch('https://api-dom.jbmidia.com/auth/list-tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          password: password,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Erro ao buscar tokens (${response.status}):`, errorText);
        throw new Error(`Erro ao buscar tokens: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`Tokens encontrados para ${email}:`, result);
      return result;
    } catch (error) {
      console.error('Erro ao buscar tokens da API DOM:', error);
      throw error;
    }
  }

  // NOVA FUNCIONALIDADE: Sincronizar tokens existentes
  async syncExistingTokens(userId: string, email: string, password: string): Promise<void> {
    try {
      // Buscar tokens da API DOM
      const tokensData = await this.getApiDomTokens(email, password);

      if (tokensData.tokens && tokensData.tokens.length > 0) {
        // Usar o primeiro token disponível
        const firstToken = tokensData.tokens[0];
        await this.saveAdminToken(userId, firstToken.token, firstToken.title || 'Token Sincronizado');
      }
    } catch (error) {
      console.error('Erro ao sincronizar tokens existentes:', error);
      throw error;
    }
  }
}
