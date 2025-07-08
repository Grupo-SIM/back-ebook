import { Request } from 'express';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'ADMIN' | 'USER' | 'CUSTOMER';
    createdById?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
}