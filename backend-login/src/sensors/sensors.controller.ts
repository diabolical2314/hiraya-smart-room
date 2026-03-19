import { Controller, Get, Post, Body } from '@nestjs/common';
import { PrismaService } from '../prismajs/prisma.service';

@Controller('sensors')
export class SensorsController {
  constructor(private prisma: PrismaService) {}

  // 1. The receiver (For the Raspberry Pi)
  @Post('data')
  async receiveData(@Body() data: any) {
    return this.prisma.sensorData.create({ data });
  }

  // 2. The window (For your Vue Frontend)
  @Get('latest')
  async getLatestData() {
    return this.prisma.sensorData.findMany({
      take: 10, // Grab the 10 most recent readings
      orderBy: {
        createdAt: 'desc', // Show newest data first
      },
    });
  }
}