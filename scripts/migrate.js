require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb } = require('../db');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(relPath) {
    const full = path.join(DATA_DIR, relPath);
    if (!fs.existsSync(full)) return null;
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
}

async function migrate() {
    console.log('Connecting to MongoDB...');
    const db = await getDb();

    // ---------- students ----------
    const students = readJson('students.json') || [];
    if (students.length) {
        await db.collection('students').drop().catch(() => {});
        const docs = students.map(s => ({ ...s, _id: s.id }));
        await db.collection('students').insertMany(docs);
        console.log(`Migrated ${docs.length} students`);
    }

    // ---------- professors ----------
    const professors = readJson('professors.json') || [];
    if (professors.length) {
        await db.collection('professors').drop().catch(() => {});
        const docs = professors.map(p => ({ ...p, _id: p.id }));
        await db.collection('professors').insertMany(docs);
        console.log(`Migrated ${docs.length} professors`);
    }

    // ---------- cert_statuses ----------
    const certStatuses = readJson('cert_status.json') || {};
    const certDocs = Object.entries(certStatuses).map(([key, val]) => ({ ...val, _id: key }));
    if (certDocs.length) {
        await db.collection('cert_statuses').drop().catch(() => {});
        await db.collection('cert_statuses').insertMany(certDocs);
        console.log(`Migrated ${certDocs.length} cert statuses`);
    }

    // ---------- chats ----------
    const chatsDir = path.join(DATA_DIR, 'chats');
    if (fs.existsSync(chatsDir)) {
        await db.collection('chats').drop().catch(() => {});
        let totalMessages = 0;
        for (const file of fs.readdirSync(chatsDir)) {
            if (!file.endsWith('.json')) continue;
            const messages = JSON.parse(fs.readFileSync(path.join(chatsDir, file), 'utf-8'));
            if (messages.length) {
                await db.collection('chats').insertMany(messages);
                totalMessages += messages.length;
            }
        }
        await db.collection('chats').createIndex({ courseId: 1, chatType: 1, timestamp: 1 });
        console.log(`Migrated ${totalMessages} chat messages`);
    }

    // ---------- office_hours ----------
    const ohDir = path.join(DATA_DIR, 'office_hours');
    if (fs.existsSync(ohDir)) {
        await db.collection('office_hours').drop().catch(() => {});
        const ohDocs = [];
        for (const file of fs.readdirSync(ohDir)) {
            if (!file.endsWith('.json')) continue;
            const courseId = path.basename(file, '.json');
            const slots = JSON.parse(fs.readFileSync(path.join(ohDir, file), 'utf-8'));
            ohDocs.push({ _id: courseId, slots });
        }
        if (ohDocs.length) await db.collection('office_hours').insertMany(ohDocs);
        console.log(`Migrated office hours for ${ohDocs.length} courses`);
    }

    console.log('\nMigration complete!');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
