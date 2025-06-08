import * as path from 'path';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';

const dbPath = path.join(process.cwd(), 'pool_history.sqlite');
const db = new sqlite3.Database(dbPath);

// Promisify common database operations
const dbRun = promisify(db.run.bind(db));
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbExec = promisify(db.exec.bind(db));

// Define the desired columns and their types
const desiredColumns: { name: string; type: string }[] = [
  { name: 'pool_id', type: 'TEXT PRIMARY KEY' },
  { name: 'token_a_symbol', type: 'TEXT' },
  { name: 'token_b_symbol', type: 'TEXT' },
  { name: 'started_at', type: 'INTEGER' },
  { name: 'expires_at', type: 'INTEGER' },
  // Add more columns here as needed
  // { name: 'new_field', type: 'TEXT' },
];

// Get current columns in the table
async function getCurrentColumns(table: string): Promise<string[]> {
  const rows = await dbAll(`PRAGMA table_info(${table})`);
  return rows.map((row: any) => row.name);
}

// Add missing columns to a table
async function addMissingColumns(table: string, columns: { name: string; type: string }[]) {
  const currentColumns = await getCurrentColumns(table);
  
  for (const column of columns) {
    if (!currentColumns.includes(column.name)) {
      console.log(`Adding column ${column.name} to ${table}...`);
      await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type}`);
    }
  }
}

// Main migration function
async function migrateColumns() {
  try {
    // Add missing columns to pool_history table
    await addMissingColumns('pool_history', desiredColumns);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    db.close();
  }
}

// Run migration
migrateColumns().catch(console.error); 