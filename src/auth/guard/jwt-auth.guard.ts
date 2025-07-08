import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Role } from 'src/types/interfaces/role';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdById?: string;
  };
}

@Injectable()
export class JwtAuthGuardUser extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}

@Injectable()
export class JwtAuthGuardAdmin extends AuthGuard('jwt') implements CanActivate {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (user.role !== 'ADMIN') {
      throw new UnauthorizedException('Access denied. Admin role required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardCustomer extends AuthGuard('jwt') implements CanActivate {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (user.role !== 'CUSTOMER') {
      throw new UnauthorizedException('Access denied. Customer role required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardAdminOrUser extends AuthGuard('jwt') implements CanActivate {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (!['ADMIN', 'USER'].includes(user.role)) {
      throw new UnauthorizedException('Access denied. Admin or User role required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardAdminOrCustomer extends AuthGuard('jwt') implements CanActivate {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (user.role !== Role.ADMIN && user.role !== Role.CUSTOMER) {
      throw new UnauthorizedException('Access denied. Admin or Customer role required.');
    }

    return true;
  }
}

@Injectable()
export class JwtAuthGuardPanel extends AuthGuard('jwt') implements CanActivate {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (!['ADMIN', 'CUSTOMER'].includes(user.role)) {
      throw new UnauthorizedException('Access denied. Panel access required.');
    }

    return user;
  }
}

@Injectable()
export class JwtAuthGuardAll extends AuthGuard('jwt') implements CanActivate {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    if (!['ADMIN', 'USER', 'CUSTOMER'].includes(user.role)) {
      throw new UnauthorizedException('Access denied. Valid role required.');
    }

    return user;
  }
}