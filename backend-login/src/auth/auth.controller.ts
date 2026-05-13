import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  // Inject the service here
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: AuthDto) {
    console.log('Register attempt:', dto);
    
    // THIS IS THE MISSING LINK: Hand the data to your service!
    return await this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: AuthDto) {
    console.log('Login attempt:', dto);
    
    // Hand the data to your service
    return await this.authService.login(dto);
  }
}