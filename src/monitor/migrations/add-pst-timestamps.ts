import { Database } from 'sqlite3';
import { toPSTTimestamp } from '../../utils/timestamp-utils.js';
import { Logger } from '../../utils/logger.js';

export async function migrateToPSTTimestamps(db: Database): Promise<void> {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Start transaction
            db.run('BEGIN TRANSACTION');

            try {
                // Add PST timestamp columns if they don't exist
                const addColumnsQueries = [
                    // Pending pools table
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS first_seen_pst TEXT`,
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS exists_since_pst TEXT`,
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS ready_since_pst TEXT`,
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS failed_at_pst TEXT`,
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS last_checked_pst TEXT`,
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS last_readiness_check_pst TEXT`,
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS created_at_pst TEXT`,
                    `ALTER TABLE pending_pools ADD COLUMN IF NOT EXISTS updated_at_pst TEXT`,

                    // Pool snapshots table
                    `ALTER TABLE pool_snapshots ADD COLUMN IF NOT EXISTS timestamp_pst TEXT`,
                    `ALTER TABLE pool_snapshots ADD COLUMN IF NOT EXISTS created_at_pst TEXT`,

                    // Trades table
                    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS timestamp_pst TEXT`,
                    `ALTER TABLE trades ADD COLUMN IF NOT EXISTS created_at_pst TEXT`
                ];

                // Execute all ALTER TABLE statements
                addColumnsQueries.forEach(query => {
                    db.run(query, (err) => {
                        if (err) {
                            Logger.error(`Error adding PST timestamp columns: ${err.message}`);
                            throw err;
                        }
                    });
                });

                // Update existing records with PST timestamps
                const updateQueries = [
                    // Update pending pools
                    `UPDATE pending_pools SET
                        first_seen_pst = datetime(first_seen, 'unixepoch', 'localtime', '-8 hours'),
                        exists_since_pst = CASE WHEN exists_since IS NOT NULL THEN datetime(exists_since, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
                        ready_since_pst = CASE WHEN ready_since IS NOT NULL THEN datetime(ready_since, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
                        failed_at_pst = CASE WHEN failed_at IS NOT NULL THEN datetime(failed_at, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
                        last_checked_pst = CASE WHEN last_checked IS NOT NULL THEN datetime(last_checked, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
                        last_readiness_check_pst = CASE WHEN last_readiness_check IS NOT NULL THEN datetime(last_readiness_check, 'unixepoch', 'localtime', '-8 hours') ELSE NULL END,
                        created_at_pst = datetime(created_at, 'unixepoch', 'localtime', '-8 hours'),
                        updated_at_pst = datetime(updated_at, 'unixepoch', 'localtime', '-8 hours')
                    WHERE first_seen_pst IS NULL`,

                    // Update pool snapshots
                    `UPDATE pool_snapshots SET
                        timestamp_pst = datetime(timestamp, 'unixepoch', 'localtime', '-8 hours'),
                        created_at_pst = datetime(created_at, 'unixepoch', 'localtime', '-8 hours')
                    WHERE timestamp_pst IS NULL`,

                    // Update trades
                    `UPDATE trades SET
                        timestamp_pst = datetime(timestamp, 'unixepoch', 'localtime', '-8 hours'),
                        created_at_pst = datetime(created_at, 'unixepoch', 'localtime', '-8 hours')
                    WHERE timestamp_pst IS NULL`
                ];

                // Execute all UPDATE statements
                updateQueries.forEach(query => {
                    db.run(query, (err) => {
                        if (err) {
                            Logger.error(`Error updating PST timestamps: ${err.message}`);
                            throw err;
                        }
                    });
                });

                // Commit transaction
                db.run('COMMIT', (err) => {
                    if (err) {
                        Logger.error(`Error committing migration: ${err.message}`);
                        reject(err);
                        return;
                    }
                    Logger.log('Successfully migrated database to use PST timestamps');
                    resolve();
                });

            } catch (error) {
                // Rollback on error
                db.run('ROLLBACK', (rollbackErr) => {
                    if (rollbackErr) {
                        Logger.error(`Error rolling back migration: ${rollbackErr.message}`);
                    }
                    reject(error);
                });
            }
        });
    });
} 