import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: true })
export class SensorsGateway {
  @WebSocketServer()
  server: Server | undefined;

  sendUpdate(data: any) {
    this.server?.emit('sensor_update', data);
  }
}