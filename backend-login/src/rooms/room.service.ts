// src/rooms/rooms.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prismajs/prisma.service'; 

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.room.findMany({
      orderBy: { createdAt: 'asc' }
    });
  }

  async create(data: { id: string; name: string }) {
    return this.prisma.room.create({
      data: {
        id: data.id,
        name: data.name,
      },
    });
  }

  // UPDATED: Now handles the name AND the new thresholds
  async update(
    id: string, 
    data: { 
      name?: string; 
      tempThreshold?: number; 
      humThreshold?: number; 
      pwrThreshold?: number 
    }
  ) {
    // Optional: Check if the room actually exists first to prevent cryptic errors
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException(`Room with ID ${id} not found`);
    }

    return this.prisma.room.update({
      where: { id },
      data: { 
        name: data.name,
        tempThreshold: data.tempThreshold,
        humThreshold: data.humThreshold,
        pwrThreshold: data.pwrThreshold,
      },
    });
  }

  // Delete a room
  async remove(id: string) {
    return this.prisma.room.delete({
      where: { id },
    });
  }
}