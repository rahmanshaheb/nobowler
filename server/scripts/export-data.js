// export-data.js
//
// One-off handover script: dumps all real match data (schema is already
// captured in db/schema.sql) as portable INSERT statements, so a new
// developer can `psql` this into their own local/hosted Postgres and
// have realistic data to develop against, without touching production.
//
// Deliberately excludes admin_account and scorer_passcode DATA (real
// login credentials) — those tables are created empty by schema.sql;
// the new developer sets their own local admin/passcode.

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
});

// Insertion order respects FK dependencies. match_player is inserted
// before match's man_of_the_match_id is restored via a deferred UPDATE
// at the end (same circular-dependency resolution schema.sql itself uses).
const TABLES_IN_ORDER = [
  'rule_section',
  'match',
  'match_player',
  'scorer_session',
  'innings',
  'pair_innings',
  'pair_innings_state',
  'bowling_spell',
  'delivery',
  'match_note',
  'audit_log',
];

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`;
  if (typeof value === 'object') {
    // JSONB columns arrive as parsed objects from node-postgres.
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function dumpTable(client, table) {
  const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY 1`);
  if (rows.length === 0) return `-- ${table}: 0 rows\n`;
  const columns = Object.keys(rows[0]);
  const lines = rows.map((row) => {
    const values = columns.map((col) => {
      if (table === 'match' && col === 'man_of_the_match_id') return 'NULL';
      return sqlLiteral(row[col]);
    });
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
  });
  return `-- ${table}: ${rows.length} rows\n${lines.join('\n')}\n`;
}

async function main() {
  const client = await pool.connect();
  try {
    const parts = [
      '-- Data export for handover — generated ' + new Date().toISOString(),
      '-- Restore with: psql "$DATABASE_URL" -f this_file.sql',
      '-- (run db/schema.sql FIRST to create the empty tables/views)',
      '',
      'BEGIN;',
      '',
    ];
    for (const table of TABLES_IN_ORDER) {
      process.stderr.write(`Dumping ${table}...\n`);
      parts.push(await dumpTable(client, table));
    }
    parts.push('-- Restore man_of_the_match_id now that match_player rows exist');
    const { rows: motmRows } = await client.query(
      'SELECT id, man_of_the_match_id FROM match WHERE man_of_the_match_id IS NOT NULL'
    );
    for (const row of motmRows) {
      parts.push(
        `UPDATE match SET man_of_the_match_id = ${sqlLiteral(row.man_of_the_match_id)} WHERE id = ${sqlLiteral(row.id)};`
      );
    }
    parts.push('', 'COMMIT;', '');

    const outDir = path.join(__dirname, '..', '..', 'handover');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `database_export_${new Date().toISOString().slice(0, 10)}.sql`);
    fs.writeFileSync(outFile, parts.join('\n'));
    process.stderr.write(`\n✓ Wrote ${outFile}\n`);
  } finally {
    client.release();
    pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
