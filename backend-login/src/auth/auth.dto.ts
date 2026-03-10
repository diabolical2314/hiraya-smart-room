// src/auth/auth.dto.ts
import { IsEmail, IsNotEmpty, Matches, MinLength } from 'class-validator';

export class AuthDto {
  @IsEmail({}, { message: 'Must be a valid email address.' })
  @Matches(/^[a-zA-Z0-9_.+-]+@gmail\.com$/, { 
    message: 'Only @gmail.com email addresses are allowed.' 
  })
  @IsNotEmpty()
  email: string;

  @MinLength(6, { message: 'Password must be at least 6 characters long.' })
  @IsNotEmpty()
  password: string;
}