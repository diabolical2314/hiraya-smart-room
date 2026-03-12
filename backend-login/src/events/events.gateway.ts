// src/events/events.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

// Enable CORS so your Vue app on port 5173 can connect
@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway {
  
  @WebSocketServer()
  server: Server;

  // This is the function we will call whenever new hardware data arrives
  broadcastSensorData(data: { temperature: number; humidity: number }) {
    // 'sensor_update' is the name of the event Vue will be listening for
    this.server.emit('sensor_update', data); 
  }
}