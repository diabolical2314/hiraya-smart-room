// src/sensor/sensor.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';

@Controller('sensor')
export class SensorController {
  // Inject the gateway so we can use its broadcast function
  constructor(private readonly eventsGateway: EventsGateway) {}

  @Post('data')
  receiveHardwareData(@Body() data: { temperature: number; humidity: number; power: number }) {
    console.log('Received new sensor data:', data);
    
    // Instantly broadcast this data to anyone looking at the Vue dashboard!
    this.eventsGateway.broadcastSensorData(data);

    return { message: 'Data received and broadcasted successfully' };
  }
}