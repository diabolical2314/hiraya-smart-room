import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { SensorController } from './sensor/sensor.controller'; // Make sure this is imported
import { EventsGateway } from './events/events.gateway';       // Make sure this is imported

@Module({
  imports: [AuthModule],
  controllers: [AppController, SensorController], // Must be in controllers
  providers: [AppService, EventsGateway],         // Must be in providers
})
export class AppModule {}