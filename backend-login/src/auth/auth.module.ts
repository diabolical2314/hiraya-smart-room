import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prismajs/prisma.service'; // Import your database service

@Module({
  controllers: [AuthController],
  // Add both services to the providers array!
  providers: [AuthService, PrismaService], 
})
export class AuthModule {}