import pg from 'pg';
const admin = new pg.Client({ connectionString: 'postgres://rm:rm@localhost:5432/postgres' });
await admin.connect();
await admin.query('drop database if exists readymix_e2e with (force)');
await admin.query('create database readymix_e2e owner rm');
await admin.end();
