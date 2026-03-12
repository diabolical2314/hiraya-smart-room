// src/events/events.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

// Enable CORS so your Vue app on port 5173 can connect
@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway {
  
  @WebSocketServer()
  server: Server;

  // This is the function we will call whenever new hardware data arrives
  // Update the data interface to include power: number
  broadcastSensorData(data: { temperature: number; humidity: number; power: number }) {
    this.server.emit('sensor_update', data); 
  }
}