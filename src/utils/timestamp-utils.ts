import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

export const PST_TIMEZONE = 'America/Los_Angeles';

export function toPSTTimestamp(unixTimestamp: number): string {
    const date = new Date(unixTimestamp * 1000);
    return formatInTimeZone(date, PST_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

export function fromPSTTimestamp(pstTimestamp: string): number {
    const pstDate = toZonedTime(new Date(pstTimestamp), PST_TIMEZONE);
    return Math.floor(pstDate.getTime() / 1000);
}

export function getCurrentPSTTimestamp(): string {
    const now = new Date();
    return formatInTimeZone(now, PST_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
    }
    return `${minutes}m ${remainingSeconds}s`;
}

export function formatTradeTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return formatInTimeZone(date, PST_TIMEZONE, 'MM/dd/yyyy HH:mm:ss');
}

export function getCurrentUnixTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}

export function getCurrentUnixTimestampMs(): number {
    return Date.now();
} 