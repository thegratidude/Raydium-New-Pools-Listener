import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface LogEntry {
  timestamp: string;
  level: string;
  context: string;
  message: string;
}

// Color codes for beautiful NestJS formatting
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  darkYellow: '\x1b[33m',  // Dark yellow (same as yellow but can be adjusted)
  orange: '\x1b[38;5;208m'  // Orange for a darker yellow alternative
};

@Injectable()
export class FileLoggerService implements LoggerService {
  private logStreams: Map<string, fs.WriteStream> = new Map();
  private readonly logsDir: string;
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB
  private readonly maxBackupCount = 5;

  constructor() {
    this.logsDir = path.join(process.cwd(), 'logs');
    this.ensureLogsDirectory();
  }

  private ensureLogsDirectory(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private getLogStream(logType: string): fs.WriteStream {
    if (!this.logStreams.has(logType)) {
      const logFile = path.join(this.logsDir, `${logType}.log`);
      const stream = fs.createWriteStream(logFile, { flags: 'a' });
      this.logStreams.set(logType, stream);
    }
    return this.logStreams.get(logType)!;
  }

  private rotateLogFile(logType: string): void {
    const logFile = path.join(this.logsDir, `${logType}.log`);
    
    try {
      const stats = fs.statSync(logFile);
      if (stats.size >= this.maxFileSize) {
        // Rotate existing backup files
        for (let i = this.maxBackupCount - 1; i >= 0; i--) {
          const oldFile = path.join(this.logsDir, `${logType}.log.${i}`);
          const newFile = path.join(this.logsDir, `${logType}.log.${i + 1}`);
          if (fs.existsSync(oldFile)) {
            fs.renameSync(oldFile, newFile);
          }
        }
        
        // Move current log file to .1
        const backupFile = path.join(this.logsDir, `${logType}.log.1`);
        fs.renameSync(logFile, backupFile);
        
        // Close and remove old stream
        const oldStream = this.logStreams.get(logType);
        if (oldStream) {
          oldStream.end();
          this.logStreams.delete(logType);
        }
      }
    } catch (error) {
      // File doesn't exist or other error, ignore
    }
  }

  private writeToLog(logType: string, entry: LogEntry): void {
    try {
      this.rotateLogFile(logType);
      const stream = this.getLogStream(logType);
      const logLine = `[${entry.timestamp}] [${entry.level}] [${entry.context}] ${entry.message}\n`;
      stream.write(logLine);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  private formatMessage(message: any, context?: string): string {
    if (typeof message === 'string') {
      return message;
    }
    if (message instanceof Error) {
      return `${message.message}\n${message.stack}`;
    }
    return JSON.stringify(message, null, 2);
  }

  private formatNestJSConsole(level: string, context: string, message: string): string {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    
    // Base NestJS format
    const baseFormat = `[Nest] ${process.pid}  - ${now.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    })}, ${timestamp}     ${level} [${context}] ${message}`;

    // Add colors based on level and context
    let coloredFormat = baseFormat;

    // Color the [Nest] prefix and timestamp with dark yellow/orange
    const nestPrefix = `[Nest] ${process.pid}  - ${now.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    })}, ${timestamp}`;
    coloredFormat = coloredFormat.replace(nestPrefix, `${colors.darkYellow}${nestPrefix}${colors.reset}`);

    // Color the level
    switch (level) {
      case 'LOG':
        coloredFormat = coloredFormat.replace(level, `${colors.green}${level}${colors.reset}`);
        break;
      case 'ERROR':
        coloredFormat = coloredFormat.replace(level, `${colors.red}${level}${colors.reset}`);
        break;
      case 'WARN':
        coloredFormat = coloredFormat.replace(level, `${colors.yellow}${level}${colors.reset}`);
        break;
      case 'DEBUG':
        coloredFormat = coloredFormat.replace(level, `${colors.blue}${level}${colors.reset}`);
        break;
    }

    // Color the context (service names)
    const contextColor = this.getContextColor(context);
    coloredFormat = coloredFormat.replace(`[${context}]`, `${contextColor}[${context}]${colors.reset}`);

    // Color special messages
    if (message.includes('✅')) {
      coloredFormat = coloredFormat.replace('✅', `${colors.green}✅${colors.reset}`);
    }
    if (message.includes('❌')) {
      coloredFormat = coloredFormat.replace('❌', `${colors.red}❌${colors.reset}`);
    }
    if (message.includes('⚠️')) {
      coloredFormat = coloredFormat.replace('⚠️', `${colors.yellow}⚠️${colors.reset}`);
    }
    if (message.includes('🏥')) {
      coloredFormat = coloredFormat.replace('🏥', `${colors.cyan}🏥${colors.reset}`);
    }
    if (message.includes('📨')) {
      coloredFormat = coloredFormat.replace('📨', `${colors.blue}📨${colors.reset}`);
    }
    if (message.includes('📊')) {
      coloredFormat = coloredFormat.replace('📊', `${colors.magenta}📊${colors.reset}`);
    }
    if (message.includes('🔗')) {
      coloredFormat = coloredFormat.replace('🔗', `${colors.cyan}🔗${colors.reset}`);
    }
    if (message.includes('⏰')) {
      coloredFormat = coloredFormat.replace('⏰', `${colors.yellow}⏰${colors.reset}`);
    }

    return coloredFormat;
  }

  private getContextColor(context: string): string {
    // Assign colors to different services for visual distinction
    const contextColors: { [key: string]: string } = {
      'NestFactory': colors.cyan,
      'SocketService': colors.cyan,
      'GatewayService': colors.magenta,
      'RaydiumListener': colors.green,
      'SimpleRaydiumListener': colors.orange,
      'Bootstrap': colors.bright + colors.white,
      'InstanceLoader': colors.gray,
      'RoutesResolver': colors.gray,
      'RouterExplorer': colors.gray,
      'NestApplication': colors.bright + colors.green,
      'Application': colors.gray,
      'WebSocket': colors.cyan,
      'PoolMonitor': colors.yellow,
      'RaydiumLayout': colors.magenta,
      'UnifiedPoolMonitorService': colors.blue,
      'FileLoggerService': colors.green,
    };

    return contextColors[context] || colors.white;
  }

  log(message: any, context?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'LOG',
      context: context || 'Application',
      message: this.formatMessage(message, context)
    };
    
    // Write to main application log
    this.writeToLog('nestjs', entry);
    
    // Write to console with beautiful NestJS formatting and colors
    console.log(this.formatNestJSConsole('LOG', entry.context, entry.message));
  }

  error(message: any, trace?: string, context?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      context: context || 'Application',
      message: this.formatMessage(message, context) + (trace ? `\n${trace}` : '')
    };
    
    // Write to error log
    this.writeToLog('errors', entry);
    
    // Also write to main log
    this.writeToLog('nestjs', entry);
    
    // Write to console with beautiful NestJS formatting and colors
    console.error(this.formatNestJSConsole('ERROR', entry.context, entry.message));
  }

  warn(message: any, context?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      context: context || 'Application',
      message: this.formatMessage(message, context)
    };
    
    // Write to main application log
    this.writeToLog('nestjs', entry);
    
    // Write to console with beautiful NestJS formatting and colors
    console.warn(this.formatNestJSConsole('WARN', entry.context, entry.message));
  }

  debug(message: any, context?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      context: context || 'Application',
      message: this.formatMessage(message, context)
    };
    
    // Write to debug log
    this.writeToLog('debug', entry);
    
    // Write to console with beautiful NestJS formatting and colors in development
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatNestJSConsole('DEBUG', entry.context, entry.message));
    }
  }

  verbose(message: any, context?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'VERBOSE',
      context: context || 'Application',
      message: this.formatMessage(message, context)
    };
    
    // Write to verbose log
    this.writeToLog('verbose', entry);
  }

  // Special method for WebSocket events
  logWebSocketEvent(eventType: string, data: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      context: 'WebSocket',
      message: `${eventType}: ${JSON.stringify(data, null, 2)}`
    };
    
    // Write to WebSocket log
    this.writeToLog('websocket', entry);
  }

  // Special method for pool monitoring events
  logPoolEvent(eventType: string, data: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      context: 'PoolMonitor',
      message: `${eventType}: ${JSON.stringify(data, null, 2)}`
    };
    
    // Write to pool monitor log
    this.writeToLog('pool_monitor', entry);
  }

  // Cleanup method to close all streams
  close(): void {
    for (const [logType, stream] of this.logStreams.entries()) {
      stream.end();
    }
    this.logStreams.clear();
  }
} 