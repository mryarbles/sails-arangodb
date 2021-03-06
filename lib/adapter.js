'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); /*jshint node: true, esversion:6 */

exports.default = function () {

  // Expose adapter definition
  return new Adapter();
};

var _connection = require('./connection');

var _connection2 = _interopRequireDefault(_connection);

var _processor = require('./processor');

var _processor2 = _interopRequireDefault(_processor);

var _lodash = require('lodash');

var _ = _interopRequireWildcard(_lodash);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Q = require('q');
var u = require('util');
var aqb = require('aqb');
var debug = require('debug')('sails-arangodb:adapter');

debug.log = console.log.bind(console);

debug('loaded');

// You may also want to store additional, private data
// per-connection (esp. if your data store uses persistent
// connections).
//
// Keep in mind that models can be configured to use different databases
// within the same app, at the same time.
//
// i.e. if you're writing a MariaDB adapter, you should be aware that one
// model might be configured as `host="localhost"` and another might be
// using
// `host="foo.com"` at the same time. Same thing goes for user, database,
// password, or any other config.
//
// You don't have to support this feature right off the bat in your
// adapter, but it ought to get done eventually.
//


var Adapter = function () {

  // Set to true if this adapter supports (or requires) things like data
  // types, validations, keys, etc.
  // If true, the schema for models using this adapter will be
  // automatically synced when the server starts.
  // Not terribly relevant if your data store is not SQL/schemaful.
  //
  // If setting syncable, you should consider the migrate option,
  // which allows you to set how the sync will be performed.
  // It can be overridden globally in an app (config/adapters.js)
  // and on a per-model basis.
  //
  // IMPORTANT:
  // `migrate` is not a production data migration solution!
  // In production, always use `migrate: safe`
  //
  // drop => Drop schema and data, then recreate it
  // alter => Drop/add columns as necessary.
  // safe => Don't change anything (good for production DBs)
  //


  function Adapter() {
    _classCallCheck(this, Adapter);

    console.log('=======================');
    console.log('sails-arangodb adapter constructor');
    console.log('=======================');

    this.identity = 'arangodb';

    this.syncable = false;

    // Primary key format is string (_key|_id)
    this.pkFormat = 'string';

    // You'll want to maintain a reference to each connection
    // that gets registered with this adapter.
    this.connections = {};
  }

  /**
   * get the db connection
   * @function
   * @name getConnection
   * @param {object} config       configuration
   * @param {array}  collections list of collections
   */


  _createClass(Adapter, [{
    key: 'getConnection',
    value: function getConnection(config, collections) {
      debug('getConn() get connection');
      return _connection2.default.create(config, collections);
    }

    /**
     * This method runs when a model is initially registered at
     * server-start-time. This is the only required method.
     * @function
     * @name registerConnection
     * @param {object}   connection DB Connection
     * @param {array}    collection Array of collections
     * @param {function} cb         callback
     */

  }, {
    key: 'registerConnection',
    value: function registerConnection(connection, collections, cb) {
      debug('registerConnection() connection:', connection);

      if (!connection.identity) return cb(new Error('Connection is missing an identity.'));
      if (this.connections[connection.identity]) return cb(new Error('Connection is already registered.'));
      // Add in logic here to initialize connection
      // e.g. connections[connection.identity] = new Database(connection,
      // collections);

      this.getConnection(connection, collections).then(function (helper) {
        this.connections[connection.identity] = helper;
        cb();
      });
    }

    /**
     * Fired when a model is unregistered, typically when the server is
     * killed. Useful for tearing-down remaining open connections, etc.
     * @function
     * @name teardown
     * @param {object} conn Connection
     * @param {function} cb callback
     */
    // Teardown a Connection

  }, {
    key: 'teardown',
    value: function teardown(conn, cb) {
      debug('teardown()');

      if (typeof conn == 'function') {
        cb = conn;
        conn = null;
      }
      if (!conn) {
        this.connections = {};
        return cb();
      }
      if (!this.connections[conn]) return cb();
      delete this.connections[conn];
      cb();
    }

    // Return attributes

  }, {
    key: 'describe',
    value: function describe(connection, collection, cb) {
      debug('describe()');
      // Add in logic here to describe a collection (e.g. DESCRIBE TABLE
      // logic)

      this.connections[connection].collection.getProperties(collection, function (res, err) {
        cb(err, res);
      });
    }

    /**
     *
     * REQUIRED method if integrating with a schemaful (SQL-ish) database.
     *
     */

  }, {
    key: 'define',
    value: function define(connection, collection, definition, cb) {
      debug('define()');
      // Add in logic here to create a collection (e.g. CREATE TABLE
      // logic)
      var deferred = Q.defer();
      this.connections[connection].createCollection(collection, function (db) {
        deferred.resolve(db);
      });
      return deferred.promise;
    }

    /**
     *
     * REQUIRED method if integrating with a schemaful (SQL-ish) database.
     *
     */

  }, {
    key: 'drop',
    value: function drop(connection, collection, relations, cb) {
      // Add in logic here to delete a collection (e.g. DROP TABLE logic)
      this.connections[connection].drop(collection, relations, cb);
    }

    /**
     *
     * REQUIRED method if users expect to call Model.find(),
     * Model.findOne(), or related.
     *
     * You should implement this method to respond with an array of
     * instances. Waterline core will take care of supporting all the other
     * different find methods/usages.
     *
     */
    //Gets the underlying arango instance used by adapter

  }, {
    key: 'getDB',
    value: function getDB(connectionName, collectionName, cb) {
      debug('getDB()');
      return this.connections[connectionName].getDB(cb);
    }

    /**
     * Implements find method
     * @function
     * @name find
     * @param   {string} connectionName Name of the connection
     * @param   {string} collectionName Name of the collection
     * @param   {object} searchCriteria Search criterial (passed from waterline)
     * @param   {function} cb           callback (err, results)
     */

  }, {
    key: 'find',
    value: function find(connectionName, collectionName, searchCriteria, cb) {
      debug('adaptor find() connectionName:', connectionName, 'collectionName:', collectionName, 'searchCriteria:', searchCriteria);

      this.connections[connectionName].find(collectionName, searchCriteria, function (err, r) {
        if (err) {
          return cb(err);
        }
        debug('find results before cast:', r);
        var processor = new _processor2.default(this.connections[connectionName].collections);
        var cast_r = processor.cast(collectionName, { _result: r });
        debug('find results after cast:', cast_r);
        return cb(null, cast_r);
      });
    }

    //Executes the query using Arango's query method

  }, {
    key: 'query',
    value: function query(connectionName, collectionName, options, cb) {
      return this.connections[connectionName].query(collectionName, options, cb);
    }

    /**
     * Create a named graph - dynamically instead of via the defined schema
     * @function
     * @name  createGraph
     * @param   {string} connectionName Name of the connection
     * @param   {string} collectionName Name of the collection
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

  }, {
    key: 'createGraph',
    value: function createGraph(connectionName, collectionName, graphName, edgeDefs, cb) {
      debug('createGraph()');

      var db = this.connections[connectionName].db;

      return this.connections[connectionName].createGraph(db, graphName, edgeDefs, cb);
    }

    /**
     * Get neighbours of a document's start _id via either a named graph
     * or a list of edges.
     * @function
     * @name  neighbors
     * @param   {string} connectionName Name of the connection
     * @param   {string} collectionName Name of the collection
     * @param   {string} startId Document _id to start graph neighbors search from
     * @param   {string|array} graphNameOrEdges Graph name or alternatively an
     *                                          array of edge collection names
     *                                          (anonymous graph)
     * @returns {Promise}
     */

  }, {
    key: 'neighbors',
    value: function neighbors(connectionName, collectionName, startId, graphNameOrEdges, cb) {
      debug('neighbors()');

      var db = this.connections[connectionName].db;
      var col = db.collection(collectionName);

      var target = '' + graphNameOrEdges;
      if (_.isArray(graphNameOrEdges)) {
        target = graphNameOrEdges.join(',');
      }

      var q = '\nFOR n IN ANY \'' + startId + '\'\n' + (_.isArray(graphNameOrEdges) ? target : 'GRAPH \'' + target + '\'') + '\nOPTIONS {bfs: true, uniqueVertices: \'global\'}\nRETURN n\n';

      debug('-------------------');
      debug(startId);
      debug(graphNameOrEdges);
      debug(q);
      debug('-------------------');

      return db.query(q).then(function (res) {
        var results = res._result;
        if (cb) {
          cb(null, results);
        }
        return Promise.resolve(results);
      }).catch(function (err) {
        if (cb) {
          cb(err);
        }
        return Promise.reject(err);
      });
    }

    /**
     * Create an edge
     *
     * This method will be bound to WaterlineORM objects, E.g:
     * `User.createEdge`
     * But it's not using the User in any way...
     *
     * @function
     * @name createEdge
     * @param   {string}   connectionName     Connection name
     * @param   {string}   collectionName     Collection name
     * @param   {string}   edgeCollectionName Edge collection name
     * @param   {string}   id1                From id (must be _id)
     * @param   {string}   id2                To id (must be _id)
     * @param   {object}   attributes         Attributes to be added to the edge
     * @param   {function} cb                 Optional Callback (err, res)
     * @returns {Promise}
     */

  }, {
    key: 'createEdge',
    value: function createEdge(connectionName, collectionName, edgeCollectionName, id1, id2, attributes, cb) {
      debug('createEdge() connectionName:', connectionName, 'collectionName:', collectionName, 'edgeCollectionName:', edgeCollectionName, 'id1:', id1, 'id2:', id2, 'attributes:', attributes, 'cb:', cb);

      var db = this.connections[connectionName].db;

      if (cb === undefined && typeof attributes === 'function') {
        cb = attributes;
        attributes = {};
      }

      var data = _.merge(attributes, {
        _from: id1,
        _to: id2
      });

      var edges = db.edgeCollection(edgeCollectionName);
      return edges.save(data).then(function (res) {
        if (cb) {
          cb(null, res);
        }
        return Promise.resolve(res);
      }).catch(function (err) {
        if (cb) {
          cb(err);
        }
        return Promise.reject(err);
      });
    }
  }, {
    key: 'getDatabase',
    value: function getDatabase(connectionName) {
      return this.connections[connectionName].db;
    }

    /**
     * Delete an edge
     *
     * @function
     * @name deleteEdge
     * @param   {string}   connectionName     Connection name
     * @param   {string}   collectionName     Collection name
     * @param   {string}   edgeCollectionName Edge collection name
     * @param   {string}   id                 Edge id (must be _id)
     * @param   {function} cb                 Optional Callback (err, res)
     * @returns {Promise}
    */

  }, {
    key: 'deleteEdge',
    value: function deleteEdge(connectionName, collectionName, edgeCollectionName, id, cb) {
      debug('deleteEdge()');

      var db = this.getDatabase(connectionName);

      var edges = db.edgeCollection(edgeCollectionName);

      return edges.remove(id).then(function (res) {
        if (cb) {
          cb(null, res);
        }
        return Promise.resolve(res);
      }).catch(function (err) {
        if (cb) {
          cb(err);
        }
        return Promise.reject(err);
      });
    }

    /**
     * Implements create method
     * @function
     * @name create
     * @param   {string}   connectionName Connection Name
     * @param   {string}   collectionName Collection Name
     * @param   {object}   data           Document data to create
     * @param   {function} cb             Callback (err, data)
     */

  }, {
    key: 'create',
    value: function create(connectionName, collectionName, data, cb) {
      debug('create() collectionName:', collectionName, 'data:', data);
      var col = this.getDatabase(connectionName).collection(collectionName);
      return col.save(data, true, function (err, doc) {
        if (err) {
          debug('create err:', err);
          return cb(err);
        }

        var processor = new _processor2.default(this.connections[connectionName].collections);
        debug('create err:', err, 'returning doc.new:', doc.new);
        cb(null, processor.cast(collectionName, { _result: doc.new }));
      });
    }

    // Although you may pass .update() an object or an array of objects,
    // it will always return an array of objects.
    // Any string arguments passed must be the ID of the record.
    // If you specify a primary key (e.g. 7 or 50c9b254b07e040200000028)
    // instead of a criteria object, any .where() filters will be ignored.
    /**
     * Implements update method
     * @function
     * @name update
     * @param   {string}   connectionName Connection Name
     * @param   {string}   collectionName Collection Name
     * @param   {object}   searchCriteria Search Criteria
     * @param   {object}   values         Document data to update
     * @param   {function} cb             Callback (err, data)
     */

  }, {
    key: 'update',
    value: function update(connectionName, collectionName, searchCriteria, values, cb) {
      debug('update() collection:', collectionName, 'values:', values);
      var col = this.connections[connectionName].update(collectionName, searchCriteria, values, function (err, docs) {
        if (err) {
          debug('update err:', err);
          return cb(err);
        }

        var processor = new _processor2.default(this.connections[connectionName].collections);
        debug('update err:', err, 'returning docs:', docs);
        cb(null, processor.cast(collectionName, { _result: docs }));
      });
    }
  }, {
    key: 'destroy',
    value: function destroy(connectionName, collectionName, options, cb) {
      var _this = this;

      debug('destroy() options:', options);
      return this.connections[connectionName].destroy(collectionName, options, function (err, docs) {
        if (err) {
          debug('destroy err:', err);
          return cb(err);
        }

        var processor = new _processor2.default(_this.connections[connectionName].collections);
        debug('destroy err:', err, 'returning docs:', docs);
        cb(null, processor.cast(collectionName, { _result: docs }));
      });
    }

    // @TODO: Look into ArangoJS for similar & better functions

  }, {
    key: 'limitFormatter',
    value: function limitFormatter(searchCriteria) {
      debug('_limitFormatter()');
      var r = '';
      if (searchCriteria.LIMIT) {
        r = 'LIMIT ';
        if (searchCriteria.SKIP) {
          r += searchCriteria.SKIP;
          delete searchCriteria.SKIP;
        }
        r += searchCriteria.LIMIT;
        delete searchCriteria.LIMIT;
      }
      return r;
    }
  }, {
    key: 'updateStringify',
    value: function updateStringify(values) {
      debug('_updateStringify()');
      var r = JSON.stringify(values);

      // remove leading and trailing {}'s
      return r.replace(/(^{|}$)/g, '');
    }

    // @TODO: Prevent injection

  }, {
    key: 'queryParamWrapper',
    value: function queryParamWrapper(param) {
      debug('_queryParamWrapper() param:', param);
      if (typeof param === 'string') {
        return "'" + param + "'";
      } else if ((typeof param === 'undefined' ? 'undefined' : _typeof(param)) === 'object') {
        var s = void 0,
            ii = void 0;
        if (Object.prototype.toString.call(param) === '[object Array]') {
          s = '[';
          for (ii = 0; ii < param.length; ii++) {
            if (ii) s += ',';
            s += this._queryParamWrapper(param[ii]);
          }
          s += ']';
        } else {
          s = '{';
          for (ii in param) {
            s += ii + ':';
            s += this._queryParamWrapper(param[ii]);
          }
          s += '}';
        }
        return s;
      }
      return param;
    }
  }, {
    key: 'quote',
    value: function quote(connection, collection, val) {
      debug('quote()');
      return this.connections[connection].quote(val);
    }

    /**
     * Implements join method for .populate()
     * @function
     * @name join
     * @param   {string}   connection Connection Name
     * @param   {string}   collection Collection Name
     * @param   {object}   criteria   Document data to create
     * @param   {function} cb         Callback (err, data)
     */

  }, {
    key: 'join',
    value: function join(connection, collection, criteria, cb) {
      debug('join() criteria:', criteria.joins[0].criteria);
      this.connections[connection].join(collection, criteria, function (err, r) {
        if (err) {
          return cb(err);
        }
        var processor = new _processor2.default(this.connections[connection].collections);
        var cast_r = processor.cast(collection, { _result: r });
        return cb(null, cast_r);
      });
    }
  }]);

  return Adapter;
}();

/**
 * sails-arangodb
 *
 * Most of the methods below are optional.
 *
 * If you don't need / can't get to every method, just implement what you have
 * time for. The other methods will only fail if you try to call them!
 *
 * For many adapters, this file is all you need. For very complex adapters, you
 * may need more flexiblity. In any case, it's probably a good idea to start
 * with one file and refactor only if necessary. If you do go that route, it's
 * conventional in Node to create a `./lib` directory for your private
 * submodules and load them at the top of the file with other dependencies. e.g.
 * var update = `require('./lib/update')`;
 * @module
 * @name adapter
 */


;