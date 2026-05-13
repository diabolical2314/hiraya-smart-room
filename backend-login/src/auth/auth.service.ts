import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prismajs/prisma.service';
import { AuthDto } from './auth.dto';

@Injectable()
export class AuthService {
  // Sharing the exact same database connection used by your sensors
  constructor(private prisma: PrismaService) {}
  
  async register(dto: AuthDto) {
    const { email, password } = dto;
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new ConflictException('Email already exists');

    return this.prisma.user.create({
      data: { email, password },
    });
  }

  async login(dto: AuthDto) {
    const { email, password } = dto;
    if (!email || !password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    
    // Check if user exists and password matches
    if (!user || user.password !== password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { message: 'Login successful', user: { id: user.id, email: user.email } };
  }
}