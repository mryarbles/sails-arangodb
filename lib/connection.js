'use strict';

var _DBHelper = require('./DBHelper');

var _DBHelper2 = _interopRequireDefault(_DBHelper);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var Arango = require('arangojs'),
    Q = require('q'),
    _ = require('lodash'),
    debug = require('debug')('sails-arangodb:connection');

debug.log = console.log.bind(console);

/**
 *
 * @module
 * @name connection
 */
module.exports = function () {

  var serverUrl = '';

  var defaults = {
    createCustomIndex: false,
    idProperty: 'id',
    caseSensitive: false
  };

  var server;

  /**
   * Connect to ArangoDB and use the requested database or '_system'
   */
  var getDb = function getDb(connection) {
    debug('getDB() connection:', connection);
    var userpassword = '';
    if (connection.user && connection.password) {
      userpassword = connection.user + ':' + connection.password + '@';
    }

    serverUrl = 'http://' + userpassword + connection.host + ':' + connection.port;
    if (!server) {
      server = new Arango({
        url: serverUrl,
        databaseName: connection.database || '_system'
      });
    }
    return server;
  };

  var getGraph = function getGraph(db, connection) {
    debug('getGraph() connection.graph:', connection.graph);
    return db.graph(connection.graph);
  };

  var getCollection = function getCollection(db, connection) {
    return db.collection(connection.collection);
  };

  var connect = function connect(connection, collections) {
    // if an active connection exists, use
    // it instead of tearing the previous
    // one down
    var d = Q.defer();

    try {
      var db = getDb(connection);
      var graph = getGraph(db, connection);
      var helper = new DbHelper(db, graph, collections, connection);

      helper.registerCollections().then(function (classes, err) {
        d.resolve(helper);
      });
    } catch (err) {
      console.error('An error has occured when trying to connect to ArangoDB:', err);
      d.reject(err);
      throw err;
    }
    return d.promise;
  };

  return {
    create: function create(connection, collections) {
      return connect(connection, collections);
    }
  };
}();