import { Module } from '@nestjs/common';
import { SensorsController } from './sensors.controller';
import { SensorsService } from './sensors.service';
import { PrismaService } from '../prismajs/prisma.service';

@Module({
  controllers: [SensorsController],
  providers: [SensorsService, PrismaService],
})
export class SensorsModule {}