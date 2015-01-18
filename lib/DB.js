'use strict'

var r = require('rethinkdb'),
    Promise = require('bluebird'),
    env =   process.env.NODE_ENV || 'development',
    isDevEnv = env === 'development',
    _ = require('lodash'),
    pool = require('generic-pool'),
    DB;


DB = function DB(config){

    if(!config.db){
        throw new Error("Database is not specified for the connection");
    }

    this.config = config;
    this.connectionPool = pool.Pool(_.extend({
        name: 'rethinkdb',
        max : 100,
        min : 0,
        log : false,
        idleTimeoutMillis : 30000,
        reapIntervalMillis : 15000,
        create: function(callback) {
            r.connect({
                host: config.host || 'localhost',
                port: config.port || 28015,
                db: config.db
            }, function(err, connection) {
                if(err) {
                    console.log("[ERROR]: " + err.message);
                    return callback(new Error(err.message));
                }
                connection._id = Math.floor(Math.random()*10001);
                isDevEnv && console.log("[DEBUG]: Connection created: %s", connection._id);
                callback(null, connection);
            });
        },
        destroy: function(connection) {
            isDevEnv && console.log("[DEBUG]: Connection closed: %s", connection._id);
            connection.close();
        }
    }, config.pool));

};


DB.prototype.connect = function(){
    return Promise.promisify(this.connectionPool.acquire)();
};


DB.prototype.release = function(conn){
    conn && this.connectionPool.release(conn);
};

DB.prototype.run = function(query, opts){
    var self = this, opts = opts || { returnCursor : false}, response;
    return self.connect().then(function (conn) {
        return query.run(conn).then(function(cursor){
            self.release(conn);
            if (!cursor) return null;
            if (opts.returnCursor) return cursor;
            return cursor.toArray ? cursor.toArray() : cursor;
        }).error(function(err){
            self.release(conn);
        });
    });
};

module.exports = DB;
