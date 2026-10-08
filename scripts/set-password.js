// Set admin password for PulseDrop Dashboard
// Usage: node scripts/set-password.js
const bcrypt = require('bcryptjs');
const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Enter admin username: ', (username) => {
    rl.question('Enter admin password: ', (password) => {
        const hash = bcrypt.hashSync(password, 10);
        fs.writeFileSync('./.admin_hash', hash);
        console.log('\nPassword hash saved to .admin_hash');
        console.log('Set in config.js or environment:');
        console.log(`  ADMIN_USER=${username}`);
        console.log(`  ADMIN_PASS_HASH=${hash}`);
        rl.close();
    });
});
