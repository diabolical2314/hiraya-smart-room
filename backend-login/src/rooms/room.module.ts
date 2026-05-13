// src/rooms/rooms.module.ts
import { Module } from '@nestjs/common';
import { RoomsService } from './room.service';
import { RoomsController } from './room.controller';
import { PrismaService } from '../prismajs/prisma.service'; // Make sure this path matches

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, PrismaService],
})
export class RoomsModule {}