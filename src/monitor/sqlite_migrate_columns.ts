import * as path from 'path';
const Database = require('better-sqlite3');

const dbPath = path.join(process.cwd(), 'pool_history.sqlite');
const db = new Database(dbPath);

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
function getCurrentColumns(table: string): string[] {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const rows = stmt.all();
  return rows.map((row: any) => row.name);
}

function addMissingColumns(table: string, desired: { name: string; type: string }[]) {
  const current = getCurrentColumns(table);
  for (const col of desired) {
    if (!current.includes(col.name)) {
      console.log(`Adding column ${col.name} (${col.type}) to ${table}...`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type};`);
    }
  }
}

addMissingColumns('active_pools', desiredColumns);

console.log('Migration complete.'); 