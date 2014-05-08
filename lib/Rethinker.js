/**
 * Created by root on 11/28/13.
 */

var Promise = require('bluebird'),
    _ = require('lodash'),
    r = require('rethinkdb'),
    relationships = {},
    modelTables = {},
    DB = require('./DB'),
    Rethinker = function () {};

Rethinker.DB = DB;

Rethinker.init = function init(dbConfig) {
    Rethinker.prototype.db = new DB(dbConfig);
    Rethinker.prototype.r = r;
    return Rethinker;
};

Rethinker.extend = function extend(protoProps, staticProps) {
    var parent = this;
    var child;


    protoProps = _.extend({
        modelName: '',
        tableName: '',
        relations: {},
        saveTimes: true
    }, protoProps);


    // The constructor function for the new subclass is either defined by you
    // (the "constructor" property in your `extend` definition), or defaulted
    // by us to simply call the parent's constructor.
    if (protoProps && _.has(protoProps, 'constructor')) {
        child = protoProps.constructor;
    } else {
        child = function () {
            return parent.apply(this, arguments);
        };
    }

    // Add static properties to the constructor function, if supplied.
    _.extend(child, parent, staticProps);

    // Set the prototype chain to inherit from `parent`
    child.prototype = Object.create(parent.prototype, {
        constructor: {
            value: child,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps) _.extend(child.prototype, protoProps);

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;


    relationships[protoProps.modelName] = protoProps.relations;

    modelTables[protoProps.modelName] = protoProps.tableName;

    initModel.call(child);


    return child;
};

Rethinker.prototype.buildQuery = function buildQuery(queryData, opts, queryTable) {

    var opts = opts || {}, queryCriteria, primaryKey = getPrimaryKey(queryData, opts);

    queryTable = queryTable || this.table;

    if (!queryData) {
        queryCriteria = queryTable;
    } else if (primaryKey) {
        queryCriteria = queryTable.get(primaryKey);

    } else {
        queryCriteria = opts.index ? queryTable.getAll(queryData, {index: opts.index}) : queryTable.filter(queryData);
    }

    return parseQuery.call(this, queryCriteria, opts, primaryKey);
};

function getRelationalData(modelData, modelName) {

    if (Array.isArray(modelData) || modelData === undefined) return [];

    var relations = relationships[modelName], relationAttrs = _.merge(relations.hasOne, relations.hasMany),
        modelRelationData = [];

    for (var attrName in relationAttrs) {
        var relationDef = relationAttrs[attrName];

        if (relationDef.sync && modelData[attrName]) {
            if (Array.isArray(modelData[attrName])) throw new Error("sync option doesn't support hasMany relation currently");
            modelRelationData.push(_.extend(relationDef, {
                related: attrName,
                data: relationDef.sync === 'readOnly' ? null : modelData[attrName],
                with: getRelationalData(modelData[attrName], relationDef.from),
                parentModel: modelName
            }));
        }
        delete modelData[attrName];
    }

    return modelRelationData;
}

function saveRelationalData(savedData, relationalData) {
    if (relationalData.length === 0) return false;

    function saveOrCreate(table, data) {
        this.saveTimes && (data[data.id ? 'updateTime' : 'createTime'] = Date.now());
        return this.db.run(data.id ? table.get(data.id).update(data, {returnVals: true}) : table.insert(data, {returnVals: true}))
    }

    function saveRelationAt(index, modelData, relationalData) {
        if (relationalData[index]) {

            var self = this,
                relationDef = relationalData[index],
                relTable = r.table(modelTables[relationDef.from]),
                relData = relationDef.data;

            if (relData === null) {
                return saveRelationAt.call(self, index + 1, modelData, relationalData);
            } else if (relationDef.filter) {

                relData[relationDef.on] = modelData.id;
                return saveOrCreate.call(self, relTable, relData)
                    .then(function (results) {
                        return saveRelationalData.call(self, results.new_val, relationDef.with);
                    })
                    .then(function () {
                        return saveRelationAt.call(self, index + 1, modelData, relationalData);
                    });


            } else {


                return saveOrCreate.call(self, relTable, relData)
                    .then(function (results) {
                        relData = results.new_val;
                        var updateData = {};
                        updateData[relationDef.on] = relData.id;
                        return self.db.run(r.table(modelTables[relationDef.parentModel]).get(modelData.id).update(updateData))
                    })
                    .then(function (results) {
                        return saveRelationalData.call(self, relData, relationDef.with);
                    })
                    .then(function () {
                        return saveRelationAt.call(self, index + 1, modelData, relationalData);
                    });


            }

        }
    }

    return saveRelationAt.call(this, 0, savedData, relationalData);

};


function getPrimaryKey(queryData, opts) {
    if(!queryData || typeof queryData === 'function'|| opts && opts.index) return null;
    return typeof queryData === 'object' ? queryData.id : queryData;
};

function addFilter(query, filter) {
    return filter ? query.filter(filter) : query;
}

function parseQuery(queryCriteria, opts, isSingleQuery) {

    var self = this;

    if (opts.join) {

        if (!Array.isArray(opts.join)) {
            opts.join = [opts.join];
        }

        for (var i = 0, ll = opts.join.length; i < ll; i++) {
            var joinOpt = opts.join[i],
                joinTable = r.table(joinOpt.from || (joinOpt.one ? joinOpt.one + 's' : joinOpt.many || joinOpt)),
                resultProp = joinOpt.one || joinOpt.many || joinOpt,
                joinProp = joinOpt.on || resultProp,
                relObject = {};

            if (isSingleQuery) {
                relObject[resultProp] = joinOpt.one ?
                    joinTable.get(queryCriteria(joinProp)) :
                    queryCriteria(joinProp).eqJoin(function (i) {
                        return i;
                    }, joinTable).zip();
                relObject[resultProp] = parseQuery.call(self, relObject[resultProp], joinOpt, joinOpt.one);
                queryCriteria = queryCriteria.merge(relObject);
            } else {
                if (joinOpt.one) {

                    queryCriteria = joinOpt.match === false ?
                        queryCriteria.outerJoin(joinTable, function (parentRow, joinRow) {
                            return parentRow(joinProp).eq(joinRow('id'));
                        }).map(function (row) {
                            relObject[resultProp] = r.branch(row.hasFields('right'), parseQuery.call(self, row('right'), joinOpt, true), null);
                            return row('left').merge(relObject);
                        }) :
                        queryCriteria.eqJoin(joinProp, joinTable).map(function (row) {
                            relObject[resultProp] = parseQuery.call(self, row('right'), joinOpt, true);
                            return row('left').merge(relObject);
                        });


                } else {
                    queryCriteria = queryCriteria.map(function (row) {
                        relObject[resultProp] = row(joinProp).eqJoin(function (i) {
                            return i;
                        }, joinTable).zip();
                        relObject[resultProp] = parseQuery.call(self, relObject[resultProp], joinOpt);
                        return row.merge(relObject);
                    });
                }
            }

        }

    }


    if (opts.with) {
        !Array.isArray(opts.with) && (opts.with = [opts.with]);

        for (var i = 0, ll = opts.with.length; i < ll; i++) {
            var withOpt = opts.with[i],
                parentName,
                relation,
                relationName,
                relationType,
                relationDef,
                withTable,
                withProp,
                hasManyQuery = null,
                manyManyQuery = null,
                relFilter = null,
                relObject = {};

            typeof withOpt === 'string' && (withOpt = {related: withOpt});

            !withOpt.parent && (withOpt.parent = self.modelName);
            parentName = withOpt.parent;
            relation = relationships[parentName];
            relationName = withOpt.related;

            if (relation.hasMany && relation.hasMany[relationName]) {
                relationDef = relation.hasMany[relationName];
                relationType = 'hasMany';
                if (relationDef.through) {

                    relationType = 'manyMany';
                    manyManyQuery = function (rowId, withOpt, relationDef) {

                        var manyManyQuery,
                            throughOpts = typeof relationDef.through === 'object' ? relationDef.through : {tableName: relationDef.through};

                        if (!throughOpts.tableName) {
                            throw new Error("tableName for 'through' option is not specified in " + parentName);
                        }

                        throughOpts.table = r.table(throughOpts.tableName);
                        throughOpts.filter = withOpt.filterThrough || relationDef.through.filter;

                        manyManyQuery = addFilter(throughOpts.table.getAll(rowId, {index: relationDef.on[0]}), throughOpts.filter)
                            .outerJoin(relationDef.fromTable, function (parentRow, joinRow) {
                                return parentRow(relationDef.on[1]).eq(joinRow('id'));
                            }).map(function (row) {
                                return r.branch(row.hasFields('right'), row('right'), null);
                            });

                        manyManyQuery = addFilter(manyManyQuery, relationDef.filter || withOpt.filter);

                        return manyManyQuery;
                    };
                }

            } else if (relation.hasOne && relation.hasOne[relationName]) {
                relationDef = relation.hasOne[relationName];
                relationType = 'hasOne';
            }

            if (!relationType) {
                throw new Error("relationship " + relationName + ' is not defined in ' + parentName);
            }


            if (withOpt.with) {
                !Array.isArray(withOpt.with) && (withOpt.with = [withOpt.with]);

                for (var j = 0, kk = withOpt.with.length; j < kk; j++) {
                    var subWithOpt = withOpt.with[j];

                    typeof subWithOpt === 'string' && (withOpt.with[j] = {related: subWithOpt});
                    withOpt.with[j].parent = relationDef.from;
                }
            }

            withTable = relationDef.fromTable = r.table(modelTables[relationDef.from]);
            withProp = relationDef.on;
            relFilter = relationDef.filter || withOpt.filter;


            if (isSingleQuery) {
                hasManyQuery = addFilter(withTable.getAll(queryCriteria('id'), {index: withProp}), relFilter);
                if (relationType === 'hasOne') {
                    relObject[relationName] = relFilter ? r.branch(hasManyQuery.count().gt(0), hasManyQuery.nth(0), null) : withTable.get(queryCriteria(withProp));
                } else if (relationType === 'hasMany') {
                    relObject[relationName] = hasManyQuery;
                } else if (relationType === 'manyMany') {
                    relObject[relationName] = manyManyQuery(queryCriteria('id'), withOpt, relationDef);
                }
                relObject[relationName] = parseQuery.call(self, relObject[relationName], withOpt, relationType === 'hasOne');
                relationType === 'hasMany' && (relObject[relationName] = relObject[relationName].coerceTo('array'));
                queryCriteria = queryCriteria.merge(relObject);

            } else {

                if (relationType === 'hasOne') {

                    queryCriteria = queryCriteria.map(function (row) {
                        if (relFilter) {
                            var allJoined = addFilter(withTable.getAll(row('id'), {index: withProp}), relFilter);
                            relObject[relationName] = r.branch(allJoined.count().gt(0), parseQuery.call(self, allJoined.nth(0), withOpt, true), null);
                        } else {
                            relObject[relationName] = r.branch(row.hasFields(withProp), parseQuery.call(self, withTable.get(row(withProp)), withOpt, true), null);
                        }
                        return row.merge(relObject);
                    });

                } else if (relationType === 'hasMany') {
                    queryCriteria = queryCriteria.map(function (row) {
                        relObject[relationName] = addFilter(withTable.getAll(row('id'), {index: withProp}), relFilter);
                        relObject[relationName] = parseQuery.call(self, relObject[relationName], withOpt).coerceTo('array');
                        return row.merge(relObject);
                    });
                } else if (relationType === 'manyMany') {

                    queryCriteria = queryCriteria.map(function (row) {
                        relObject[relationName] = manyManyQuery(row('id'), withOpt, relationDef);
                        relObject[relationName] = parseQuery.call(self, relObject[relationName], withOpt).coerceTo('array');
                        return row.merge(relObject);

                    });

                }
            }


        }


    }


    if (!isSingleQuery && opts.orderBy) {
        var orderBy = opts.orderBy.split(" "), orderAttr = orderBy[0];
        if (orderAttr.indexOf('.') >= 0) {
            var orderAttrArray = orderAttr.split('.');
            orderAttr = r.row(orderAttrArray[0]);
            for (var i = 1, ll = orderAttrArray.length; i < ll; i++) {
                orderAttr = orderAttr(orderAttrArray[i]);
            }
        }

        queryCriteria = queryCriteria.orderBy(r[orderBy[1] || 'asc'](orderAttr));
    }

    if (!isSingleQuery && opts.limit) {
        queryCriteria = queryCriteria.limit(opts.limit);
    }

    if (opts.fields) {
        queryCriteria = queryCriteria.pluck(opts.fields);
    }

    return queryCriteria;
}

function initModel() {
    var modelName = this.prototype.modelName || this.__super__.modelName,
        tableName = this.prototype.tableName || this.__super__.tableName,
        table;

    if (!modelName) {
        throw new Error("modelName cannot be empty");
    }

    table = this.prototype.table = r.table(tableName || modelName.charAt(0).toLowerCase() + modelName.slice(1) + 's');


    this.prototype['find' + modelName] = function (queryData, opts) {
        if(!queryData) throw new Error("query parameter for single query cannot be null");
        return this.db.run(this.buildQuery(queryData, opts)).then(function (results) {
            return Array.isArray(results) ? results[0] : results;
        });

    };

    this.prototype['findAll' + modelName] = function (queryData, opts) {
        return this.db.run(this.buildQuery(queryData, opts));
    }

    this.prototype['validate' + modelName] = function () {
        return true;
    };


    this.prototype['beforeCreate' + modelName] = function () {
        return true;
    };

    this.prototype['beforeUpdate' + modelName] = function () {
        return true;
    };

    this.prototype['beforeSave' + modelName] = function () {
        return true;
    };

    this.prototype['afterCreate' + modelName] = function (insertData) {
        return insertData;
    };

    this.prototype['afterUpdate' + modelName] = function (updateData) {
        return updateData;
    };

    this.prototype['create' + modelName] = function (insertData, opts) {
        var self = this,
            insertOpts = {validate: true, returnVals : true},
            insertedVal,
            relationalData = [];

        _.assign(insertOpts, opts);

        if (self.saveTimes) {
            var now = Date.now();
            if (Array.isArray(insertData)) {
                for (var i = 0, ll = insertData.length; i < ll; i++) {
                    insertData[i].createTime = now;
                }
            } else {
                insertData.createTime = now;
            }

        }


        return Promise.cast(insertOpts.validate ? self['validate' + modelName](insertData, 'create') : true)
            .then(function (isValid) {
                return isValid ? Promise.cast(self['beforeCreate' + modelName](insertData)) : false;
            })
            .then(function (proceedToCreate) {
                return proceedToCreate ? Promise.cast(self['beforeSave' + modelName](insertData)) : false;
            })
            .then(function (proceedToSave) {
                if (!proceedToSave) return null;

                relationalData = getRelationalData(insertData, self.modelName);
                return self.db.run(table.insert(insertData, {returnVals: Array.isArray(insertData) ? false : insertOpts.returnVals}));

            })
            .then(function (result) {
                if (!result) return null;
                insertedVal = insertData;
                if(result.inserted === 1){
                    insertOpts.returnVals && (insertedVal = result.new_val);
                }else if(result.inserted > 1) {
                    for (var i = 0, ll = result.generated_keys.length; i < ll; i++) {
                        insertedVal[i].id = result.generated_keys[i];
                    }
                }

                return Promise.cast(saveRelationalData.call(self, insertedVal, relationalData))
                    .then(function () {
                        if (relationalData.length > 0 && insertedVal.id) {
                            return self.db.run(self.buildQuery(insertedVal.id, {with: relationalData}))
                        } else {
                            return insertedVal;
                        }
                    })
                    .then(function (savedVal) {
                        savedVal && (savedVal = self['afterCreate' + modelName](savedVal) || savedVal);
                        return savedVal;
                    });

            });
    };


    this.prototype['update' + modelName] = function (updateData, queryData, opts) {
        var self = this,
            updateQuery,
            updatedVal,
            relationalData = [],
            updateOpts = {validate: true, returnVals : true};
        _.assign(updateOpts, opts);


        self.saveTimes && (updateData.updateTime = Date.now());

        return Promise.cast(updateOpts.validate ? self['validate' + modelName](updateData, 'update') : true)
            .then(function (isValid) {
                return isValid ? Promise.cast(self['beforeUpdate' + modelName](updateData)) : false;
            })
            .then(function (proceedToUpdate) {
                return proceedToUpdate ? Promise.cast(self['beforeSave' + modelName](updateData)) : false;
            })
            .then(function (proceedToSave) {
                if (!proceedToSave) return null;
                relationalData = getRelationalData(updateData, self.modelName);

                if (updateOpts.returnVals) { //temporary patch that returnVals doesnt support multiple-row selection
                    updateQuery = getPrimaryKey(queryData, opts) ?
                        self.buildQuery(queryData, opts).update(updateData, {returnVals: true}) :
                        self.buildQuery(queryData, _.assign({}, {orderBy: 'id', limit: 1}, updateOpts)).forEach(function (doc) {
                            return table.get(doc('id')).update(updateData, {returnVals: true});
                        });
                } else {
                    updateQuery = self.buildQuery(queryData, updateOpts).update(updateData);
                }

                return self.db.run(updateQuery);
            })
            .then(function (result) {
                if (!result) return null;
                if (updateOpts.returnVals) {
                    updatedVal = result.new_val;
                } else if (result.replaced || result.unchanged) {
                    updatedVal = updateData;
                }

                return Promise.cast(saveRelationalData.call(self, updatedVal, relationalData))
                    .then(function () {
                        if (relationalData.length > 0 && updatedVal.id) {
                            return self.db.run(self.buildQuery(updatedVal.id, {with: relationalData}))
                        } else {
                            return updatedVal;
                        }
                    })
                    .then(function (savedVal) {
                        savedVal && (savedVal = self['afterUpdate' + modelName](savedVal, result.old_val) || savedVal);
                        return savedVal;
                    });

            });

    }

    this.prototype['delete' + modelName] = function (queryData, opts) {
        return this.db.run(this.buildQuery(queryData, opts).delete());
    }

    this.prototype['exist' + modelName] = function (queryData, opts) {
        var queryCriteria = typeof queryData !== 'object' && !opts ?
            table.getAll(queryData) :
            this.buildQuery(queryData, opts);

        return this.db.run(queryCriteria.count()).then(function (count) {
            return count > 0;
        });
    }

    return table;
}


module.exports = Rethinker;

