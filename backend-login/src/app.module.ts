import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { SensorsController } from './sensors/sensors.controller'; 
import { PrismaService } from './prismajs/prisma.service'; 
import { MqttService } from './mqtt/mqtt.service';
import { SensorsGateway } from './sensors/sensors.gateway';
@Module({
  imports: [AuthModule],
  controllers: [SensorsController], // Added the new HTTP receiver
  providers: [MqttService, PrismaService, SensorsGateway],   
})
export class AppModule {}