import { getCurrentPSTTimestamp } from './timestamp-utils.js';

export class Logger {
    private static formatMessage(level: string, message: string, data?: any): string {
        const timestamp = getCurrentPSTTimestamp();
        const dataStr = data ? JSON.stringify(data, null, 2) : '';
        return `[${timestamp}] ${level}: ${message}${dataStr ? '\n' + dataStr : ''}`;
    }

    static log(message: string, data?: any) {
        console.log(this.formatMessage('INFO', message, data));
    }

    static error(message: string, error?: any) {
        console.error(this.formatMessage('ERROR', message, error));
    }

    static warn(message: string, data?: any) {
        console.warn(this.formatMessage('WARN', message, data));
    }

    static debug(message: string, data?: any) {
        if (process.env.DEBUG) {
            console.debug(this.formatMessage('DEBUG', message, data));
        }
    }

    static trade(message: string, data?: any) {
        console.log(this.formatMessage('TRADE', message, data));
    }

    static pool(message: string, data?: any) {
        console.log(this.formatMessage('POOL', message, data));
    }
} 