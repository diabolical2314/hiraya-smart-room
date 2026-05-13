// src/app.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { SensorsController } from './sensors/sensors.controller'; 
import { PrismaService } from './prismajs/prisma.service'; 
import { MqttService } from './mqtt/mqtt.service';
import { SensorsGateway } from './sensors/sensors.gateway';
import { SensorsService } from './sensors/sensors.service';
import { RoomsModule } from './rooms/room.module'; // <-- Import the new module

@Module({
  imports: [
    AuthModule, 
    RoomsModule // <-- Add it to the imports array
  ],
  controllers: [SensorsController], 
  providers: [MqttService, PrismaService, SensorsGateway, SensorsService],   
})
export class AppModule {}