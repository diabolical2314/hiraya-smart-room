// src/rooms/rooms.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { RoomsService } from './room.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  getAllRooms() {
    return this.roomsService.findAll();
  }

  @Post()
  createRoom(@Body() body: { id: string; name: string }) {
    return this.roomsService.create(body);
  }

  // UPDATED: Now accepts name AND the optional threshold fields
  @Patch(':id')
  updateRoom(
    @Param('id') id: string, 
    @Body() body: { 
      name?: string; 
      tempThreshold?: number; 
      humThreshold?: number; 
      pwrThreshold?: number 
    }
  ) {
    return this.roomsService.update(id, body);
  }

  @Delete(':id')
  removeRoom(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }
}