import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from './config.js';

const migrationsDir = path.join(config.rootDir, 'migrations');

async function ensureDatabase() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.end();
}

async function migrate() {
  await ensureDatabase();

  const connection = await mysql.createConnection(config.db);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [appliedRows] = await connection.query('SELECT name FROM migrations');
  const applied = new Set(appliedRows.map(row => row.name));
  const files = (await fs.readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    console.log(`Applying migration: ${file}`);
    await connection.beginTransaction();

    try {
      await connection.query(sql);
      await connection.execute('INSERT INTO migrations (name) VALUES (?)', [file]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  await connection.end();
  console.log('Migrations complete.');
}

migrate().catch(error => {
  console.error(error);
  process.exit(1);
});
