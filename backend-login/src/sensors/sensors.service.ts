import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prismajs/prisma.service';
import PDFDocument = require('pdfkit');
import { Response } from 'express';

@Injectable()
export class SensorsService {
  constructor(private prisma: PrismaService) {}

  async generatePdfReport(timeframe: string, res: Response) {
    const now = new Date();
    const startDate = new Date();
    
    if (timeframe === 'daily') {
      startDate.setDate(now.getDate() - 1);
    } else if (timeframe === 'weekly') {
      startDate.setDate(now.getDate() - 7);
    } else if (timeframe === 'monthly') {
      startDate.setMonth(now.getMonth() - 1);
    }

    // 1. Fetch records
    const records = await this.prisma.sensorData.findMany({
      where: { createdAt: { gte: startDate, lte: now } },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Fetch Extremes
    const peakTemp = await this.prisma.sensorData.findFirst({
      where: { createdAt: { gte: startDate, lte: now } },
      orderBy: { temperature: 'desc' },
    });

    const peakHumidity = await this.prisma.sensorData.findFirst({
      where: { createdAt: { gte: startDate, lte: now } },
      orderBy: { humidity: 'desc' },
    });

    // 3. Process Data, Math, and Averages
    const RATE_PER_KWH = 11.00; 
    const POWER_FACTOR = 0.90;  
    const INTERVAL_SECONDS = 1; 

    let totalKwh = 0;
    let sumTemp = 0;
    let sumHum = 0;
    let validTempReadings = 0;
    let validHumReadings = 0;

    const chartData: Record<string, number> = {};

    records.forEach((record) => {
      // Power Calculation
      const voltage = record.voltage ?? 0;
      const current = record.current ?? 0;
      const powerWatts = voltage * current * POWER_FACTOR; 
      const kwh = (powerWatts / 1000) * (INTERVAL_SECONDS / 3600); 
      totalKwh += kwh;

      // Environment Calculation
      if (record.temperature) { sumTemp += record.temperature; validTempReadings++; }
      if (record.humidity) { sumHum += record.humidity; validHumReadings++; }

      // Group data dynamically based on timeframe
      let timeLabel = '';
      if (timeframe === 'daily') {
        timeLabel = record.createdAt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
      } else if (timeframe === 'weekly') {
        timeLabel = record.createdAt.toLocaleDateString('en-US', { weekday: 'short' });
      } else {
        timeLabel = record.createdAt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
      }

      if (!chartData[timeLabel]) chartData[timeLabel] = 0;
      chartData[timeLabel] += kwh;
    });
    
    const totalCost = totalKwh * RATE_PER_KWH;
    const avgTemp = validTempReadings ? (sumTemp / validTempReadings) : 0;
    const avgHum = validHumReadings ? (sumHum / validHumReadings) : 0;

    // --- NUMBER FORMATTERS ---
    const formatCurrency = (val: number) => 'PHP ' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    const formatNum = (val: number, dec: number = 1) => new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(val);

    // 4. Initialize PDF Document
    const doc = new PDFDocument({ margin: 0, size: 'A4' }); // Removing default margins so we can draw edge-to-edge backgrounds
    doc.pipe(res);

    // --- DRAW BACKGROUND ---
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f4f6f9'); // Light gray dashboard background

    // --- DRAW HEADER ---
    doc.rect(0, 0, doc.page.width, 100).fill('#1a252f'); // Dark blue header
    doc.fillColor('#ffffff').fontSize(24).font('Helvetica-Bold').text('CCIS Monitoring Report', 40, 30);
    doc.fillColor('#bdc3c7').fontSize(12).font('Helvetica').text(`Overview: ${timeframe.toUpperCase()}  |  Date: ${startDate.toLocaleDateString()} - ${now.toLocaleDateString()}`, 40, 60);

    // --- SECTION 1: 4 KPI CARDS ---
    // Calculate 4 columns
    const margin = 40;
    const gap = 15;
    const cardWidth = (doc.page.width - (margin * 2) - (gap * 3)) / 4;
    const cardY = 125;
    const cardHeight = 90;

    // Card 1: Cost
    this.drawDashboardCard(doc, margin, cardY, cardWidth, cardHeight, 'TOTAL COST', formatCurrency(totalCost), 'Estimated Php', '#e74c3c');
    // Card 2: Energy
    this.drawDashboardCard(doc, margin + cardWidth + gap, cardY, cardWidth, cardHeight, 'TOTAL ENERGY', `${formatNum(totalKwh, 4)}`, 'kWh Consumed', '#9b59b6');
    // Card 3: Avg Temp
    this.drawDashboardCard(doc, margin + (cardWidth + gap) * 2, cardY, cardWidth, cardHeight, 'AVG TEMP', `${formatNum(avgTemp)}°C`, 'Maintained', '#3498db');
    // Card 4: Avg Hum
    this.drawDashboardCard(doc, margin + (cardWidth + gap) * 3, cardY, cardWidth, cardHeight, 'AVG HUMIDITY', `${formatNum(avgHum)}%`, 'Maintained', '#f39c12');

    // --- SECTION 2: THE BAR CHART ---
    const chartY = cardY + cardHeight + 25;
    const chartHeight = 240;
    const chartWidth = doc.page.width - (margin * 2);

    // Draw White Card Background for Chart
    doc.roundedRect(margin, chartY, chartWidth, chartHeight, 6).fill('#ffffff');
    doc.fillColor('#2c3e50').fontSize(14).font('Helvetica-Bold').text('Energy Usage Trend (kWh)', margin + 20, chartY + 20);
    
    if (Object.keys(chartData).length > 0) {
      this.drawBarChart(doc, margin + 20, chartY + 50, chartWidth - 40, chartHeight - 80, chartData);
    } else {
      doc.fillColor('#95a5a6').fontSize(12).font('Helvetica-Oblique').text('Waiting for sensor data to generate chart...', margin + 20, chartY + 120, { align: 'center', width: chartWidth - 40 });
    }

    // --- SECTION 3: ENVIRONMENTAL EXTREMES ---
    const extY = chartY + chartHeight + 25;
    const extWidth = (chartWidth - gap) / 2;

    if (peakTemp) {
      this.drawExtremeCard(doc, margin, extY, extWidth, 80, 'Peak Temperature Recorded', `${peakTemp.temperature}°C`, peakTemp.createdAt.toLocaleString(), '#e74c3c');
    }
    if (peakHumidity) {
      this.drawExtremeCard(doc, margin + extWidth + gap, extY, extWidth, 80, 'Peak Humidity Recorded', `${peakHumidity.humidity}%`, peakHumidity.createdAt.toLocaleString(), '#3498db');
    }

    doc.end();
  }

  /**
   * HELPER 1: Draws the modern KPI Cards at the top of the PDF
   */
  private drawDashboardCard(doc: typeof PDFDocument, x: number, y: number, w: number, h: number, title: string, value: string, subtext: string, accentColor: string) {
    // White Card Background
    doc.roundedRect(x, y, w, h, 6).fill('#ffffff');
    
    // Colored Top Border
    doc.roundedRect(x, y, w, 6, 6).fill(accentColor);
    doc.rect(x, y + 3, w, 3).fill(accentColor); // Flattens the bottom corners of the top border

    // Text Content
    doc.fillColor('#7f8c8d').fontSize(10).font('Helvetica-Bold').text(title, x + 15, y + 20);
    
    // Dynamically adjust font size if currency/number gets too long
    const valFontSize = value.length > 10 ? 16 : 20; 
    doc.fillColor('#2c3e50').fontSize(valFontSize).font('Helvetica-Bold').text(value, x + 15, y + 40);
    
    doc.fillColor('#95a5a6').fontSize(9).font('Helvetica').text(subtext, x + 15, y + 68);
  }

  /**
   * HELPER 2: Draws the extreme records cards at the bottom
   */
  private drawExtremeCard(doc: typeof PDFDocument, x: number, y: number, w: number, h: number, title: string, value: string, dateStr: string, iconColor: string) {
    doc.roundedRect(x, y, w, h, 6).fill('#ffffff');
    
    // Little colored dot to act as an "Icon"
    doc.circle(x + 20, y + 25, 5).fill(iconColor);
    
    doc.fillColor('#2c3e50').fontSize(12).font('Helvetica-Bold').text(title, x + 35, y + 20);
    doc.fillColor(iconColor).fontSize(22).font('Helvetica-Bold').text(value, x + 35, y + 40);
    doc.fillColor('#95a5a6').fontSize(9).font('Helvetica').text(`Recorded on: ${dateStr}`, x + 100, y + 50);
  }

  /**
   * HELPER 3: Improved Bar Chart with clean gridlines and formatting
   */
  private drawBarChart(doc: typeof PDFDocument, x: number, y: number, width: number, height: number, data: Record<string, number>) {
    const labels = Object.keys(data);
    const values = Object.values(data);
    
    const maxVal = Math.max(...values) || 1;
    const availableWidth = width - 40; 
    const barSpacing = availableWidth / labels.length;
    
    // Make bars thinner and more elegant
    const barWidth = Math.min(barSpacing * 0.5, 40); 
    const chartX = x + 30; 
    
    // Draw Grid Lines & Y-Axis Labels
    for (let i = 0; i <= 4; i++) {
      const gridY = y + height - (height * (i / 4));
      const labelVal = (maxVal * (i / 4));
      
      // ALLOW UP TO 4 DECIMAL PLACES ON THE Y-AXIS
      const formattedLabel = new Intl.NumberFormat('en-US', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 4 
      }).format(labelVal);
      
      // Y-axis text
      doc.fillColor('#95a5a6').fontSize(8).font('Helvetica').text(formattedLabel, x - 15, gridY - 4, { width: 40, align: 'right' });
      
      // Soft Horizontal Grid Line
      doc.lineWidth(0.5).strokeColor('#ecf0f1');
      doc.moveTo(chartX, gridY).lineTo(chartX + availableWidth, gridY).stroke();
    }

    // Draw Bars and X-Axis Labels
    labels.forEach((label, i) => {
      const val = values[i];
      const barHeight = (val / maxVal) * height;
      const barX = chartX + (i * barSpacing) + (barSpacing - barWidth) / 2;
      const barY = y + height - barHeight;

      // Draw the Bar (Modern Teal color)
      if (barHeight > 0) {
        doc.fillColor('#c8e63c') // Lime green matching your UI
           .rect(barX, barY, barWidth, barHeight)
           .fill();

        // ALLOW UP TO 4 DECIMAL PLACES ON TOP OF BARS
        const formattedVal = new Intl.NumberFormat('en-US', { 
          minimumFractionDigits: 0, 
          maximumFractionDigits: 4 
        }).format(val);
        
        doc.fillColor('#34495e').fontSize(7).font('Helvetica-Bold')
           .text(formattedVal, barX - 10, barY - 12, { width: barWidth + 20, align: 'center' });
      }

      // X-Axis Label at the bottom
      doc.fillColor('#7f8c8d').fontSize(8).font('Helvetica')
         .text(label, barX - 15, y + height + 10, { width: barWidth + 30, align: 'center' });
    });
  }
}