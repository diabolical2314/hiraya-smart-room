import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' }, // This allows your Vue app to connect without being blocked
})
export class SensorsGateway {
  @WebSocketServer()
  server: Server;

  // This function sends the data to your Vue dashboard
  sendUpdate(data: any) {
    this.server.emit('sensor_update', data);
  }
}