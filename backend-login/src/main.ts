import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ADD THIS LINE TO FIX THE CONNECTION ERROR
  app.enableCors(); 

  await app.listen(3000); // Or whatever port your backend uses
}
bootstrap();