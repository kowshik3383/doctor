const mysql = require('mysql2');

const pool = mysql.createPool({
	host: 'localhost',
	user: 'root',
	password: 'newpassword',
	database: 'hospital',
});

module.exports = pool.promise(); // Use promise-based queries
