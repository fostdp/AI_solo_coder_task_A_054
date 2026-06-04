const { Pool } = require('pg');
const dbConfig = require('../config/db-config');

const pool = new Pool({
    user: dbConfig.user,
    password: dbConfig.password,
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    min: dbConfig.poolMin,
    max: dbConfig.poolMax,
    idleTimeoutMillis: dbConfig.poolIdleTimeoutMillis,
    connectionTimeoutMillis: dbConfig.poolConnectionTimeoutMillis,
    ssl: dbConfig.ssl ? { rejectUnauthorized: false } : undefined
});

pool.on('connect', () => {
    console.log('Database connection established');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

pool.on('acquire', () => {
    if (process.env.NODE_ENV === 'development') {
        console.log(`DB Pool - Total: ${pool.totalCount}, Idle: ${pool.idleCount}, Waiting: ${pool.waitingCount}`);
    }
});

async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.NODE_ENV === 'development' && duration > 100) {
            console.log(`Slow query (${duration}ms): ${text.substring(0, 100)}`);
        }
        return res;
    } catch (err) {
        console.error('Query error:', err.message);
        throw err;
    }
}

async function getClient() {
    return await pool.connect();
}

async function closePool() {
    await pool.end();
}

module.exports = {
    query,
    getClient,
    closePool,
    pool
};
