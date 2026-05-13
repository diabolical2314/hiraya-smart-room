// src/rooms/room.entity.ts
import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('rooms')
export class Room {
  @PrimaryColumn()
  id: string | undefined; // e.g., 'comlab2'

  @Column()
  name: string | undefined; // e.g., 'Computer Laboratory 2'
}