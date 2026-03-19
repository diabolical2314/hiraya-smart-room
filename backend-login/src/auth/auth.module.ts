import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller'; // Make sure this is imported

@Module({
  imports: [],
  controllers: [AuthController], // MUST be listed here
  providers: [],
})
export class AuthModule {}