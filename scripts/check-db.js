const db = require('../config/database');

async function runDiagnostics() {
  try {
    const [users] = await db.query('SELECT id, username, email FROM users');
    console.log('\n--- REGISTERED USERS ---');
    console.log(users);

    const [plays] = await db.query('SELECT * FROM analytics_games ORDER BY id DESC LIMIT 10');
    console.log('\n--- LATEST ANALYTICS ENTRIES ---');
    console.log(plays);

    const [dbName] = await db.query('SELECT DATABASE() as db');
    console.log('\nActive DB:', dbName[0].db);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Diagnostics Error:', err);
    process.exit(1);
  }
}

runDiagnostics();
