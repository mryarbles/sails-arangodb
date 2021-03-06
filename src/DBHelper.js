/*global console, process*/
var Arango = require('arangojs'),
    Q = require('q'),
    async = require('async'),
    _ = require('lodash'),
    aqb = require('aqb'),
    debug = require('debug')('sails-arangodb:connection');
    
export default class DbHelper {

    constructor(db, graph, collections, config) {
        this.db = db;
        this.graph = graph;
        this.collections = collections;
        this.config = _.extend(config, defaults);
        this._classes = null;
    }


    logError(err) {
        console.error(err.stack);
    }

    getClass(collection) {
        return this._classes[collection];
    }

    ensureIndex() {
        // to be implemented?
    }

    /*Makes sure that all the collections are synced to database classes*/
    // TODO: This is broken by 1.0 no instance methods
    registerCollections() {
        var deferred = Q.defer();
        var me = this;
        var db = me.db;
        var graph = me.graph;
        var collections = this.collections;

        async.auto({
                ensureDB: function (next) {
                    debug('ensureDB()');
                    var system_db = Arango({
                        url: serverUrl,
                        databaseName: '_system'
                    });
                    system_db.listDatabases(function (err, dbs) {
                        if (err) {
                            DbHelper.logError(err);
                            process.exit(1);
                        }

                        // Create the DB if needed
                        if (dbs.indexOf(db.name) === -1) {
                            system_db.createDatabase(db.name, function (err, result) {
                                if (err) {
                                    DbHelper.logError(err);
                                    process.exit(1);
                                }
                                debug('Created database: ' + db.name);
                                next(null, db.name);
                            });
                        } else {
                            next(null, db.name);
                        }
                    });
                },

                // Get collections from DB
                getCollections: ['ensureDB', function (next) {
                    debug('getCollections()');
                    db.collections(function (err, cols) {
                        if (err) {
                            DbHelper.logError(err);
                            process.exit(1);
                        }
                        var docCollection = cols.filter(function (c) {
                            if (c.type == 2) { // @TODO: Use something like ArangoDB.EDGE_COLLECTION
                                // see https://github.com/gabriel-letarte/arangojs/blob/master/src/collection.js
                                // export const types = {
                                //   DOCUMENT_COLLECTION: 2,
                                //   EDGE_COLLECTION: 3
                                // };
                                return c;
                            }
                        });
                        var edgeCollection = cols.filter(function (c) {
                            if (c.type == 3) { // @TODO: see above
                                return c;
                            }
                        });
                        next(null, {
                            'docCollection': docCollection,
                            'edgeCollection': edgeCollection,
                        });
                    });
                }],

                /**
                 * Get all existing named graphs
                 */
                getNamedGraphs: ['ensureDB', function (next) {
                    debug('getNamedGraphs');
                    db.listGraphs()
                        .then((graphs) => {
                            debug('graphs:', graphs);
                            let graphs_hash = {};
                            graphs.forEach((g) => {
                                graphs_hash[g._key] = g;
                            });
                            next(null, graphs_hash);
                        })
                        .catch((err) => {
                            next(err);
                        });
                }],

                // Get relations from DB
                getEdgeCollections: ['ensureDB', function (next) {
                    debug('getEdgeCollections()');
                    var edgeCollections = [];
                    _.each(collections, function (v, k) {
                        _.each(v.attributes, function (vv, kk) {
                            if (vv.edge) {
                                vv.from = v.tableName;
                                edgeCollections.push(vv);
                            }
                        });
                    });
                    next(null, edgeCollections);
                }],

                createMissingCollections: ['getCollections', function (next, results) {
                    debug('createMissingCollections()');
                    var currentCollections = results.getCollections.docCollection;
                    var missingCollections = _.filter(collections, function (v, k) {
                        debug('createMissingCollections edgeDefinitions:', v.adapter.query._attributes.$edgeDefinitions);
                        debug('createMissingCollections hasSchema:', v.adapter.query.hasSchema);
                        return _.find(currentCollections, function (klass) {
                            return v.adapter.collection == klass.name;
                        }) === undefined && (!v.adapter.query.attributes ||
                            !v.adapter.query.attributes.$edgeDefinitions
                        );
                    });
                    if (missingCollections.length > 0) {
                        async.mapSeries(missingCollections,
                            function (collection, cb) {
                                debug('db.collection - CALLED', collection.adapter.collection, 'junctionTable:', collection.meta.junctionTable);
                                db.collection(collection.adapter.collection).create(function (err) {
                                    if (err) {
                                        debug('err:', err);
                                        return cb(err, null);
                                    }
                                    debug('db.collection - DONE');
                                    return cb(null, collection);
                                });
                            },
                            function (err, created) {
                                next(err, created);
                            });
                    } else {
                        next(null, []);
                    }
                }],

                /**
                 * Create any missing Edges
                 */
                createMissingEdges: ['getCollections', 'getEdgeCollections', function (next, results) {
                    debug('createMissingEdges()');
                    var classes = results.getCollections;
                    async.mapSeries(results.getEdgeCollections,
                        function (collection, cb) {
                            if (!_.find(classes, function (v) {
                                    return (v == collection.edge);
                                })) {
                                debug('db.edgeCollection - CALLED', collection.edge);
                                db.edgeCollection(collection.edge).create(function (results) {
                                    debug('db.edgeCollection - DONE');
                                    return cb(null, collection);
                                });
                            }
                            return cb(null, null);
                        },
                        function (err, created) {
                            next(err, created);
                        });
                }],

                /**
                 * Create any missing Named Graphs
                 */
                createMissingNamedGraph: ['createMissingCollections', 'getNamedGraphs', function (next, results) {
                    const currentNamedGraphs = results.getNamedGraphs;
                    debug('createMissingNamedGraph currentNamedGraphs:', currentNamedGraphs);
                    const missingNamedGraphs = {};
                    _.each(collections, (v, k) => {
                        debug('createMissingNamedGraph hasSchema:', v.adapter.query.hasSchema, 'k:', k);
                        if (currentNamedGraphs[k] === undefined &&
                            v.adapter.query.attributes &&
                            v.adapter.query.attributes.$edgeDefinitions
                        ) {
                            missingNamedGraphs[k] = v;
                        }
                    });

                    const promises = [];
                    _.each(missingNamedGraphs, (g, k) => {
                        promises.push(me.createGraph(db, k, g.attributes.$edgeDefinitions));
                    });
                    Q.all(promises)
                        .then((r) => {
                            next(null, r);
                        })
                        .fail((err) => {
                            next(err);
                        });
                }],

                addVertexCollections: ['createMissingCollections', function (next, results) {
                    debug('addVertexCollections()');
                    async.mapSeries(results.createMissingCollections,
                        function (collection, cb) {
                            graph.addVertexCollection(collection.tableName, function () {
                                return cb(null, collection);
                            });
                        },
                        function (err, created) {
                            next(null, results);
                        });
                }],

                addEdgeDefinitions: ['addVertexCollections', 'createMissingEdges', function (complete, results) {
                    debug('addEdgeDefinitions()');
                    async.mapSeries(results.getEdgeCollections,
                        function (edge, cb) {
                            graph.addEdgeDefinition({
                                from: [edge.from],
                                collection: edge.edge,
                                to: [edge.collection]
                            }, function () {
                                cb(null, edge);
                            });
                        },
                        function (err, created) {
                            complete(null, results);
                        });
                }]
            },
            function (err, results) {
                if (err) {
                    debug('ASYNC.AUTO - err:', err);
                    deferred.reject(err);
                    return;
                }
                debug('ASYNC.AUTO - DONE results:', results);

                deferred.resolve(results.createMissingCollections);

            });

        return deferred.promise;
    };

    quote(val) {
        return aqb(val).toAQL();
    }

    /*Query methods starts from here*/
    query(collection, query, cb) {
        debug('query() ', query);
        this.db.query(query,  (err, cursor) => {
            if (err) return cb(err);
            cursor.all((err, vals) => {
                return cb(err, vals);
            });
        });
    };

    getDB(cb) {
        var db = this.db;
        return cb(db);
    }

    optionsToQuery(collection, options, qb) {
        const self = this;

        debug('optionsToQuery() options:', options);
        qb = qb ? qb : aqb.for('d').in(collection);


        const buildWhere = function (where, recursed) {
            debug('buildWhere where:', where, 'recursed:', recursed);

            var outer_i = 0;
            _.each(where, (v, k) => {

                if (outer_i > 0) {
                    if (whereStr !== '') whereStr += ` && `;
                }
                outer_i += 1;

                // handle or: [{field1: 'value', field2: 'value'}, ...]
                if (k === 'or') {
                    if (_.isArray(v)) {
                        whereStr += `${recursed ? '&&' : ''} (`;
                        _.each(v, (v_element, i_element) => {
                            if (i_element > 0) {
                                whereStr += ' || ';
                            }
                            buildWhere(v_element, true, i_element);
                        });
                        whereStr += ')';
                        return;
                    }
                }

                // like as keyword
                if (k === 'like') {
                    k = Object.keys(v)[0];
                    v = {
                        'like': v[k]
                    };
                }

                // Handle filter operators
                debug('options.where before operators: k:', k, 'v:', typeof v, v);
                var operator = '==';
                var eachFunction = '';
                var skip = false;
                var pre = '';

                // handle config default caseSensitive option
                debug('config caseSensitive:', self.config.caseSensitive);
                if (self.config.hasOwnProperty('caseSensitive')) {
                    if (!self.config.caseSensitive) {
                        eachFunction = 'LOWER';
                    } else {
                        eachFunction = '';
                    }
                }

                if (v && typeof v === 'object') {
                    // handle array of values for IN
                    if (_.isArray(v)) {
                        operator = 'IN';
                        eachFunction = '';
                    } else {
                        // Handle filter's options

                        debug('v caseSensitive:', v.caseSensitive);
                        if (v.hasOwnProperty('caseSensitive')) {
                            if (!v.caseSensitive) {
                                eachFunction = 'LOWER';
                            } else {
                                eachFunction = '';
                            }
                            delete v.caseSensitive;
                        }

                        _.each(v, (vv, kk) => {
                            debug('optionsToQuery kk:', kk, 'vv:', typeof vv, vv);
                            v = vv;
                            switch (kk) {
                                case 'contains':
                                    operator = 'LIKE';
                                    v = `%${vv}%`;
                                    break;

                                case 'like':
                                    operator = 'LIKE';
                                    break;

                                case 'startsWith':
                                    operator = 'LIKE';
                                    v = `${vv}%`;
                                    break;

                                case 'endsWith':
                                    operator = 'LIKE';
                                    v = `%${vv}`;
                                    break;

                                case 'lessThanOrEqual':
                                case '<=':
                                    operator = '<=';
                                    pre = `HAS(d, "${k}") AND`;
                                    break;

                                case 'lessThan':
                                case '<':
                                    operator = '<';
                                    pre = `HAS(d, "${k}") AND`;
                                    break;

                                case 'greaterThanOrEqual':
                                case '>=':
                                    operator = '>=';
                                    break;

                                case 'greaterThan':
                                case '>':
                                    operator = '>';
                                    break;

                                case 'not':
                                case '!':
                                    if (_.isArray(vv)) { // in waterline v0.11/12
                                        operator = 'NOT IN';
                                        eachFunction = '';
                                    } else {
                                        operator = '!=';
                                    }
                                    break;

                                case 'nin': // in waterline master (upcoming)
                                    operator = 'NOT IN';
                                    eachFunction = '';
                                    break;

                                default:
                                    const newWhere = {};
                                    newWhere[`${k}.${kk}`] = vv;
                                    buildWhere(newWhere, true); // recursive for next level
                                    skip = true;
                            }
                        });
                    }
                }

                if (skip) {
                    return; // to outer each() loop
                }

                switch (k) {
                    case 'id':
                        whereStr += `${eachFunction}(d._key) ${operator} ${eachFunction}(${aqb(v).toAQL()})`;
                        break;
                    case '_key':
                    case '_rev':
                        whereStr += `${eachFunction}(d.${k}) ${operator} ${eachFunction}(${aqb(v).toAQL()})`;
                        break;
                    default:
                        whereStr += `(${pre} ${eachFunction}(d.${k}) ${operator} ${eachFunction}(${aqb(v).toAQL()}))`;
                        break;
                }

                debug('interim whereStr:', whereStr);

            });
        } // function buildWhere

        if (options.where && options.where !== {}) {
            var whereStr = '';

            buildWhere(options.where);

            debug('whereStr:', whereStr);
            debug('qb:', qb);
            qb = qb.filter(aqb.expr('(' + whereStr + ')'));
        }

        // handle sort option
        if (options.sort && !_.isEmpty(options.sort)) {
            var sortArgs;
            debug('sort options:', options.sort);
            // as an object {'field': -1|1}
            sortArgs = _.map(options.sort, (v, k) => {
                return [`d.${k}`, `${v < 0 ? 'DESC' : 'ASC'}`];
            });

            // force consistent results
            sortArgs.push(['d._key', 'ASC']);

            sortArgs = _.flatten(sortArgs);

            debug('sortArgs:', sortArgs);
            qb = qb.sort.apply(qb, sortArgs);
        }

        if (options.limit !== undefined) {
            qb = qb.limit((options.skip ? options.skip : 0), options.limit);
        } else if (options.skip !== undefined) {
            qb = qb.limit(options.skip, Number.MAX_SAFE_INTEGER);
        }

        debug('optionsToQuery() returns:', qb);
        return qb;
    }

    // e.g. FOR d IN userTable2 COLLECT Group="all" into g RETURN {age: AVERAGE(g[*].d.age)}
    applyFunctions(options, qb) {
        // handle functions
        let funcs = {};
        _.each(options, (v, k) => {
            if (_.includes(['where', 'sort', 'limit', 'skip', 'select', 'joins'], k)) {
                return;
            }
            funcs[k] = v;
        });
        
        debug('applyFunctions() funcs:', funcs);

        if (Object.keys(funcs).length === 0) {
            qb = qb.return({
                'd': 'd'
            });
            return qb;
        }

        const funcs_keys = Object.keys(funcs);
        
        debug('applyFunctions() funcs_keys:', funcs_keys);

        let isGroupBy = false;
        let collectObj = {};

        let retobj = {};
        funcs_keys.forEach((func) => {
            options[func].forEach((field) => {
                if (typeof field !== 'object') {
                    if (func === 'groupBy') {
                        isGroupBy = true;
                        collectObj[field] = `d.${field}`;
                        retobj[field] = field;
                    } else {
                        retobj[field] = aqb.fn(func.toUpperCase())('g[*].d.' + field);
                    }
                }
            });
        });

        if (isGroupBy) {
            qb = qb.collect(collectObj).into('g');
        } else {
            qb = qb.collect('Group', '"all"').into('g');
        }

        debug('retobj:', retobj);
        qb = qb.return({
            'd': retobj
        });
        return qb;
    }

    find(collection, options, cb) {

        debug('connection find() collection:', collection, 'options:', options);
        var qb = this.optionsToQuery(collection, options);
        qb = this.applyFunctions(options, qb);

        var find_query = qb.toAQL();
        
        debug('find_query:', find_query);

        this.db.query(find_query, (err, cursor) => {
            debug('connection find() query err:', err);
            if (err) return cb(err);

            this._filterSelected(cursor, options)
                .then((vals) => {
                    debug('query find response:', vals.length, 'documents returned for query:', find_query);
                    debug('vals:', vals);
                    return cb(null, _.map(vals, (item) => {
                        return item.d;
                    }));
                })
                .catch((err) => {
                    console.error('find() error:', err);
                    cb(err, null);
                });
        });
    }

    //Deletes a collection from database
    drop(collection, relations, cb) {
        this.db.collection(collection).drop(cb);
    }

    /*
     * Updates a document from a collection
     */
    update(collection, options, values, cb) {
        debug('update options:', options);
        let replace = false;
        
        if (options.where) {
            replace = options.where.$replace || false;
            delete options.where.$replace;
        }

        if (replace) {
            // provide a new createdAt
            values.createdAt = new Date();
        }

        debug('values:', values);

        let qb = this.optionsToQuery(collection, options);
        let doc = aqb(values);

        if (replace) {
            qb = qb.replace('d').with_(doc).in(collection);
        } else {
            qb = qb.update('d').with_(doc).in(collection);
        }
        
        let query = qb.toAQL() + ' LET modified = NEW RETURN modified';
        debug('update() query:', query);

        this.db.query(query, (err, cursor) => {
            if (err) return cb(err);
            cursor.all((err, vals) => {
                return cb(err, vals);
            });
        });
    }


    /*
     * Deletes a document from a collection
     */
    destroy(collection, options, cb) {
        var qb = this.optionsToQuery(collection, options);
        debug('destroy() qb:', qb);
        qb = qb.remove('d').in(collection);
        this.db.query(qb.toAQL() + ' LET removed = OLD RETURN removed', (err, cursor) => {
            if (err) return cb(err);
            cursor.all((err, vals) => {
                return cb(err, vals);
            });
        });
    }

    _filterSelected(cursor, criteria) {
        // filter to selected fields
        return cursor.map((v) => {
            debug('_filterSelected v:', v);
            if (criteria.select && criteria.select.length > 0) {
                let nv = {
                    d: {}
                };
                _.each(criteria.joins, (join) => {
                    nv[join.alias] = v[join.alias];
                });

                ['_id', '_key', '_rev'].forEach((k) => {
                    nv.d[k] = v.d[k];
                });

                criteria.select.forEach((sk) => {
                    nv.d[sk] = v.d[sk];
                });
                debug('nv:', nv);
                return nv;
            }
            return v;
        });
    }

    /*
     * Perform simple join
     */
    join(collection, criteria, cb) {
        debug('join collection:', collection, 'criteria:', criteria);
        debug('criteria.joins:', criteria.joins);
        
        const from = criteria.joins[0];
        const aliasAttrs = this.collections[collection]._attributes[from.alias];
        
        debug(`alias ${from.alias} attrs:`, aliasAttrs);

        var me = this,
            join_query;

        if (!aliasAttrs.edge) { // Standard waterline Join?
            debug('waterline join');
            var q = aqb.for(collection).in(collection);
            var mergeObj = {};
            _.each(criteria.joins, (join) => {
                q = q
                    .for(join.parentKey)
                    .in(join.child)
                    .filter(aqb.eq(`${join.parentKey}.${join.childKey}`, `${join.parent}.${join.parentKey}`));
                mergeObj[join.parentKey] = join.parentKey;
            });
            q = q.return(aqb.MERGE(collection, mergeObj));
            var q_d = aqb.for('d').in(q);
            var q_opts = this.optionsToQuery(collection, criteria, q_d);
            join_query = me.applyFunctions(criteria, q_opts);

        } else { // graph
            debug('edge join');
            const edgeCollection = aliasAttrs.edge;
            let edgeJoin = {};

            // TODO: Use above AQB approach with edges too

            var qb = this.optionsToQuery(collection, criteria).toAQL(),
                ret = ' RETURN { "d" : d';

            _.each(criteria.joins, (join, i) => {
                debug('join each i:', i, 'join:', join);

                // skip waterline implied junction tables
                if (i % 2 === 0) { // even?
                    edgeJoin = join;
                    return;

                } else { // odd?
                    edgeJoin.edgeChild = join.child;
                }

                let _id;
                if (criteria.where) {
                    _id = criteria.where._id; // always _id for edges
                    if (!_id)
                        _id = criteria.where._key;
                }
                
                debug('join criteria _id field:', _id);

                ret = `${ ret }, "${ edgeJoin.alias }" : (FOR ${ edgeJoin.alias } IN ANY ${ aqb.str(_id).toAQL() } ${ edgeCollection } OPTIONS {bfs: true, uniqueVertices: true} FILTER IS_SAME_COLLECTION(" ${ edgeJoin.edgeChild }", ${ edgeJoin.alias }) RETURN ${ edgeJoin.alias })`;
            });
            
            ret += ' }';
            join_query = qb + ret;
        }

        debug('join query:', join_query);
        this.db.query(join_query, (err, cursor) => {
            if (err) return cb(err);

            debug('join() criteria.select:', criteria.select);

            me._filterSelected(cursor, criteria)
                .then((vals) => {
                    debug('query join response:', vals.length,
                        'documents returned for query:',
                        (typeof join_query === 'string' ? join_query : join_query.toAQL()));
                    debug('vals[0]:', vals[0]);
                    return cb(null, _.map(vals, (item) => {
                        var bo = item.d;

                        if (aliasAttrs.edge) {
                            _.each(criteria.joins, (join) => {
                                if (!criteria.select || criteria.select.includes(join.alias)) {
                                    bo[join.alias] = _.map(item[join.alias], (i) => {
                                        return i;
                                    });
                                }
                            });
                        }
                        return bo;
                    }));
                })
                .catch((err) => {
                    console.error('join() error:', err);
                    cb(err, null);
                });

        });
    };

    /*
     * Creates edge between two vertices pointed by from and to
     */
    toArangoRef(val) {
        var ret = val;
        if (typeof ret === 'object') {
            ret = ret._id.split('/', 2);
        } else {
            ret = ret.split('/', 2);
        }
        return ret;
    };

    createEdge(from, to, options, cb) {
        const src = this.toArangoRef(from);
        const dst = this.toArangoRef(to);

        const srcAttr = _.find(this.collections[src[0]].attributes, (i) => {
            return i.collection == dst[0];
        });

        // create edge
        this.graph.edgeCollection(srcAttr.edge,
            (err, collection) => {
                if (err) return cb(err);

                collection.save((options.data ? options.data : {}),
                    src.join('/'),
                    dst.join('/'),
                    (err, edge) => {
                        if (err) return cb(err);
                        cb(null, edge);
                    });
            });
    };

    /*
     * Removes edges between two vertices pointed by from and to
     */
    deleteEdges(from, to, options, cb) {
        const src = this.toArangoRef(from);
        const dst = this.toArangoRef(to);

        const srcAttr = _.find(this.collections[src[0]].attributes, (i) => {
            return i.collection == dst[0];
        });

        // delete edge
        this.db.collection(srcAttr.edge,
            (err, collection) => {
                if (err) return cb(err);

                collection.edges(src.join('/'), (err, edges) => {
                    var dErr = err;
                    if (err) return cb(err);
                    _.each(edges, (i) => {
                        collection.remove(i._id, (err, edge) => {
                            dErr = err;
                        });
                    });
                    if (dErr !== null) {
                        return cb(dErr);
                    }
                    cb(null, edges);
                });
            });
    }

    /**
     * Create a named graph
     *
     * @function
     * @name createGraph
     * @param   {string}   connectionName     Connection name
     * @param   {string}   graphName          Graph name
     * @param   {array}    edgeDefs           Array of edge definitions
     * @param   {function} cb                 Optional Callback (err, res)
     * @returns {Promise}
     *
     * example of edgeDefs:
     * ```
     * [{
     *   collection: 'edges',
     *   from: ['start-vertices'],
     *   to: ['end-vertices']
     * }, ...]
     * ```
     */
    createGraph(db, graphName, edgeDefs, cb) {
        debug('createGraph() graphName:', graphName,
            'edgeDefs:', edgeDefs,
            'cb:', cb);

        const graph = db.graph(graphName);
        
        return graph.create({
                edgeDefinitions: edgeDefs
            })
            .then((res) => {
                if (cb) {
                    cb(null, res);
                }
                return Promise.resolve(res);
            })
            .catch((err) => {
                if (cb) {
                    cb(err);
                }
                return Promise.reject(err);
            });
    };

}