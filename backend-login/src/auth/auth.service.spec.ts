// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthDto } from './auth.dto';

const prisma = new PrismaClient();

@Injectable()
export class AuthService {
  // Helper to create a user so you can actually test the login
  async register(dto: AuthDto) {
    const existingUser = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException('Email already exists');

    return prisma.user.create({
      data: { email: dto.email, password: dto.password },
    });
  }

  async login(dto: AuthDto) {
    const user = await prisma.user.findUnique({ where: { email: dto.email } });
    
    // In a real app, compare hashed passwords using bcrypt
    if (!user || user.password !== dto.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { message: 'Login successful', user: { id: user.id, email: user.email } };
  }
}