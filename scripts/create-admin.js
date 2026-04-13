/**
 * create-admin.js
 * One-time script to create a superadmin account.
 *
 * Usage:
 *   node scripts/create-admin.js
 *
 * You will be prompted for username, name, and password.
 * The password is hashed with bcrypt before insertion.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const bcrypt   = require('bcryptjs');
const db       = require('../config/database');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n🎮 Playmist – Create Admin Account\n');

  const username = (await ask('Username: ')).trim();
  const name     = (await ask('Display name: ')).trim();
  const password = (await ask('Password: ')).trim();
  const role     = (await ask('Role (superadmin / manager / support) [default: superadmin]: ')).trim() || 'superadmin';

  if (!username || !name || !password) {
    console.error('❌ All fields are required.');
    process.exit(1);
  }

  const validRoles = ['superadmin', 'manager', 'support'];
  if (!validRoles.includes(role)) {
    console.error(`❌ Invalid role. Must be one of: ${validRoles.join(', ')}`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    const [result] = await db.query(
      'INSERT INTO admins (username, name, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, name, hash, role]
    );
    console.log(`\n✅ Admin created successfully! ID: ${result.insertId}`);
    console.log(`   Username : ${username}`);
    console.log(`   Role     : ${role}`);
    console.log(`\n👉 Login at: http://localhost:${process.env.PORT || 3000}/sitehandler/login\n`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.error('❌ Username already exists.');
    } else {
      console.error('❌ Error:', err.message);
    }
    process.exit(1);
  }

  rl.close();
  process.exit(0);
}

main().catch(console.error);
