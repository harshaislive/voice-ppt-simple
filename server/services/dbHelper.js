// Database utility for sql.js to provide better-sqlite3 like interface

class DatabaseHelper {
    constructor(db) {
        this.db = db;
    }
    
    // Run a SQL statement with parameters (for INSERT, UPDATE, DELETE)
    run(sql, params = []) {
        try {
            this.db.run(sql, params);
            return { 
                changes: this.db.getRowsModified(),
                lastInsertRowid: null // sql.js doesn't easily provide this
            };
        } catch (error) {
            console.error('Database run error:', error);
            throw error;
        }
    }
    
    // Get a single row (for SELECT)
    get(sql, params = []) {
        try {
            const results = this.db.exec(sql, params);
            if (results.length === 0 || results[0].values.length === 0) {
                return undefined;
            }
            
            const result = results[0];
            const columns = result.columns;
            const row = result.values[0];
            
            // Convert to object
            const obj = {};
            columns.forEach((col, i) => {
                obj[col] = row[i];
            });
            
            return obj;
        } catch (error) {
            console.error('Database get error:', error);
            throw error;
        }
    }
    
    // Get all rows (for SELECT)
    all(sql, params = []) {
        try {
            const results = this.db.exec(sql, params);
            if (results.length === 0) {
                return [];
            }
            
            const result = results[0];
            const columns = result.columns;
            
            return result.values.map(row => {
                const obj = {};
                columns.forEach((col, i) => {
                    obj[col] = row[i];
                });
                return obj;
            });
        } catch (error) {
            console.error('Database all error:', error);
            throw error;
        }
    }
    
    // Execute multiple SQL statements
    exec(sql) {
        try {
            this.db.exec(sql);
        } catch (error) {
            console.error('Database exec error:', error);
            throw error;
        }
    }
    
    // Prepare a statement (returns a statement object)
    prepare(sql) {
        const stmt = this.db.prepare(sql);
        
        return {
            run: (...params) => {
                stmt.bind(params);
                stmt.step();
                stmt.reset();
                return { 
                    changes: this.db.getRowsModified(),
                    lastInsertRowid: null
                };
            },
            get: (...params) => {
                stmt.bind(params);
                if (stmt.step()) {
                    const columns = stmt.getColumnNames();
                    const row = stmt.get();
                    stmt.reset();
                    
                    const obj = {};
                    columns.forEach((col, i) => {
                        obj[col] = row[i];
                    });
                    return obj;
                }
                stmt.reset();
                return undefined;
            },
            all: (...params) => {
                const results = [];
                stmt.bind(params);
                while (stmt.step()) {
                    const columns = stmt.getColumnNames();
                    const row = stmt.get();
                    
                    const obj = {};
                    columns.forEach((col, i) => {
                        obj[col] = row[i];
                    });
                    results.push(obj);
                }
                stmt.reset();
                return results;
            },
            finalize: () => {
                stmt.free();
            }
        };
    }
    
    // Transaction helper
    transaction(fn) {
        return (...args) => {
            this.db.run('BEGIN TRANSACTION');
            try {
                const result = fn(...args);
                this.db.run('COMMIT');
                return result;
            } catch (error) {
                this.db.run('ROLLBACK');
                throw error;
            }
        };
    }
    
    // Pragma (for compatibility)
    pragma(statement) {
        // Just execute pragma statements
        this.db.run(`PRAGMA ${statement}`);
    }
    
    // Close database
    close() {
        // sql.js doesn't have a close method, but we can save and exit
        const { saveDatabase } = require('./init');
        saveDatabase();
    }
    
    // Save database to file
    save() {
        const { saveDatabase } = require('./init');
        saveDatabase();
    }
}

module.exports = DatabaseHelper;
