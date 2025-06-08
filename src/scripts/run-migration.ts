import { Database } from 'sqlite3';
import { migrateToPSTTimestamps } from '../monitor/migrations/add-pst-timestamps.js';
import { Logger } from '../utils/logger.js';
import * as path from 'path';

async function main() {
    const dbPath = path.join(process.cwd(), 'pool_history.sqlite');
    const db = new Database(dbPath);

    try {
        Logger.log('Starting PST timestamp migration...');
        await migrateToPSTTimestamps(db);
        Logger.log('Migration completed successfully');
    } catch (error) {
        Logger.error('Migration failed:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

main().catch(error => {
    Logger.error('Unhandled error during migration:', error);
    process.exit(1);
}); 