import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { PrismaService } from '../prismajs/prisma.service';
import { SensorsGateway } from '../sensors/sensors.gateway';

@Injectable()
export class MqttService implements OnModuleInit {
  private client: mqtt.MqttClient;
  private readonly logger = new Logger(MqttService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: SensorsGateway,
  ) {}

  onModuleInit() {
  const PI_IP = '192.168.137.53';
  this.client = mqtt.connect(`mqtt://${PI_IP}:1883`);

  // Shared accumulator for esp32 topics
  const esp32State = { temperature: 0, humidity: 0, power: 0 };

  this.client.on('connect', () => {
    this.logger.log('✅ Connected to Raspberry Pi Broker');

    this.client.subscribe('smart_hiraya/rooms/comlab1/sensors', (err) => {
      if (!err) this.logger.log('📡 Subscribed to smart_hiraya/rooms/comlab1/sensors');
    });
    this.client.subscribe('esp32/humidity', (err) => {
      if (!err) this.logger.log('💧 Subscribed to esp32/humidity');
    });
    this.client.subscribe('esp32/temperature', (err) => {
      if (!err) this.logger.log('🌡️ Subscribed to esp32/temperature');
    });
  });

  this.client.on('message', async (topic, message) => {

    // --- ESP32 HUMIDITY ---
    if (topic === 'esp32/humidity') {
      try {
        esp32State.humidity = parseFloat(message.toString());
        this.logger.log(`💧 ESP32 Humidity: ${esp32State.humidity}%`);

        // Emit full packet so applySensorData() doesn't reject it
        this.gateway.sendUpdate({ ...esp32State });

        await this.prisma.sensorData.create({
          data: { temperature: esp32State.temperature, humidity: esp32State.humidity, power: 0 },
        });
      } catch (error) {
        this.logger.error('❌ Failed to process ESP32 humidity', error);
      }
    }

    // --- ESP32 TEMPERATURE ---
    if (topic === 'esp32/temperature') {
      try {
        esp32State.temperature = parseFloat(message.toString());
        this.logger.log(`🌡️ ESP32 Temperature: ${esp32State.temperature}°C`);

        // Emit full packet so applySensorData() doesn't reject it
        this.gateway.sendUpdate({ ...esp32State });

        await this.prisma.sensorData.create({
          data: { temperature: esp32State.temperature, humidity: esp32State.humidity, power: 0 },
        });
      } catch (error) {
        this.logger.error('❌ Failed to process ESP32 temperature', error);
      }
    }

    // --- COMLAB 1 ---
    if (topic === 'smart_hiraya/rooms/comlab1/sensors') {
      try {
        const data = JSON.parse(message.toString());
        const calculatedPower = parseFloat((data.voltage * data.current).toFixed(2));

        this.logger.log(
          `📥 ComLab 1: Temp ${data.temperature}°C | Hum ${data.humidity}% | Power ${calculatedPower}W`
        );

        // Single emit — all three fields present, roomId added for future routing
        this.gateway.sendUpdate({
          roomId: 'comlab1',                // <-- Fix 3: room routing
          temperature: data.temperature,
          humidity: data.humidity,
          power: calculatedPower,
        });

        await this.prisma.sensorData.create({
          data: {
            temperature: data.temperature,
            humidity: data.humidity,
            power: calculatedPower,
          },
        });
      } catch (error) {
        this.logger.error('❌ Failed to process ComLab 1 sensor data', error);
      }
    }
  });
}