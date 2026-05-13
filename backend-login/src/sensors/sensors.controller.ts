import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prismajs/prisma.service';
import { SensorsService } from './sensors.service'; 

@Controller('sensors')
export class SensorsController {
  constructor(
    private prisma: PrismaService,
    private sensorsService: SensorsService
  ) {}

  @Get('latest')
  async getLatest() {
    return this.prisma.sensorData.findFirst({
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- THIS IS THE ROUTE NESTJS IS MISSING ---
  @Get('report/download')
  async downloadReport(@Query('type') type: string, @Res() res: Response) {
    const reportType = type || 'daily';

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=ComLab1 Report${reportType}.pdf`,
    });

    await this.sensorsService.generatePdfReport(reportType, res);
  }
}