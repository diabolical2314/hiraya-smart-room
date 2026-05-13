import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { PrismaService } from '../prismajs/prisma.service';
import { SensorsGateway } from '../sensors/sensors.gateway';

@Injectable()
export class MqttService implements OnModuleInit {
  private client!: mqtt.MqttClient;
  private readonly logger = new Logger(MqttService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: SensorsGateway,
  ) {}

  onModuleInit() {
    const PI_IP = '192.168.137.154'; 
    this.client = mqtt.connect(`mqtt://${PI_IP}:1883`);

    this.client.on('connect', () => {
      this.logger.log('Connected to Raspberry Pi Broker');

      // 1. Subscribe to the NEW ComLab 1 Data
      this.client.subscribe('smart_hiraya/rooms/comlab1/sensors', (err) => {
        if (!err)
          this.logger.log(
            '📡 Subscribed to smart_hiraya/rooms/comlab1/sensors',
          );
      });

      // 2. Subscribe to ESP32 Humidity
      this.client.subscribe('esp32/humidity', (err) => {
        if (!err) this.logger.log('💧 Subscribed to esp32/humidity');
      });

      // 3. Subscribe to ESP32 Temperature
      this.client.subscribe('esp32/temperature', (err) => {
        if (!err) this.logger.log('🌡️ Subscribed to esp32/temperature');
      });
    });

    this.client.on('message', async (topic, message) => {
      
      // --- ESP32 HUMIDITY LOGIC ---
      if (topic === 'esp32/humidity') {
        try {
          const humidityValue = parseFloat(message.toString());
          this.logger.log(`💧 Real-time Humidity from ESP32: ${humidityValue}%`);
          this.gateway.sendUpdate({ humidity: humidityValue });
          await this.prisma.sensorData.create({
            data: { temperature: 0, humidity: humidityValue, current: 0, voltage: 0 },
          });
        } catch (error) {
          this.logger.error('Failed to process ESP32 humidity', error);
        }
      }

      // --- ESP32 TEMPERATURE LOGIC ---
      if (topic === 'esp32/temperature') {
        try {
          const tempValue = parseFloat(message.toString());
          this.logger.log(` Real-time Temperature from ESP32: ${tempValue}°C`);
          this.gateway.sendUpdate({ temperature: tempValue });
          await this.prisma.sensorData.create({
            data: { temperature: tempValue, humidity: 0, current: 0, voltage: 0 },
          });
        } catch (error) {
          this.logger.error('Failed to process ESP32 temperature', error);  
        }
      }

// --- LIVE COMLAB 1 LOGIC ---
      if (topic === 'smart_hiraya/rooms/comlab1/sensors') {
        try {
          const data = JSON.parse(message.toString());
          
          // Calculate Power (Watts = Volts x Amps)
          const calculatedPower = data.voltage * data.current;

          // 1. Let's update the terminal logger so you can actually see the Volts and Amps!
          this.logger.log(
            `📥 ComLab 1 Data caught: Temp ${data.temperature}°C, Hum ${data.humidity}%, V: ${data.voltage}V, A: ${data.current}A`
          );
          
          // 2. Combine EVERYTHING into ONE single update package for Vue
          this.gateway.sendUpdate({
            roomId: "1",                     // <-- Tell Vue explicitly this is for Room 1
            temperature: data.temperature,
            humidity: data.humidity,
            voltage: data.voltage,           // Send the raw voltage
            ampere: data.current,            // <-- FIX: Rename 'current' to 'ampere' for Vue!
            power: parseFloat(calculatedPower.toFixed(2)) // Send the calculated power
          });

          // 3. Save to PostgreSQL (keep this exactly as you had it)
          await this.prisma.sensorData.create({
            data: {
              temperature: data.temperature,
              humidity: data.humidity,
              voltage: data.voltage,
              current: data.current,
            },
          });
        } catch (error) {
          this.logger.error('Failed to process ComLab 1 sensor data', error);
        }
      }
    });
  }
}