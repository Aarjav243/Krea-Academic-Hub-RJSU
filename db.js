const { MongoClient } = require('mongodb');

if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not set. See .env.example');
}

const client = new MongoClient(process.env.MONGODB_URI);
let _db;

async function getDb() {
    if (_db) return _db;
    await client.connect();
    _db = client.db('krea_hub');
    return _db;
}

module.exports = { getDb };
