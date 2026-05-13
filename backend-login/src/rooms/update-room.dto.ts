// src/rooms/dto/update-room.dto.ts

import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  tempThreshold?: number;

  @IsOptional()
  @IsNumber()
  humThreshold?: number;

  @IsOptional()
  @IsNumber()
  pwrThreshold?: number;
}