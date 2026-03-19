import { Controller, Post, Body } from '@nestjs/common';

@Controller('auth') 
export class AuthController {
  
  // 1. The Login Door (You already have this)
  @Post('login') 
  login(@Body() loginData: any) {
    console.log('Login attempt:', loginData);
    return { message: 'Successfully hit the login route!' };
  }

  // 2. The Register Door (ADD THIS NEW BLOCK)
  @Post('register')
  register(@Body() registerData: any) {
    console.log('Register attempt:', registerData);
    return { message: 'Successfully hit the register route!' };
  }

}