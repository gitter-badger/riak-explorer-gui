import Ember from 'ember';
import config from '../config/environment';
import objectToArray from '../utils/riak-util';

/**
 * An Ember service responsible for AJAX communication with the Explorer API.
 *
 * @class ExplorerService
 * @extends Ember.Service
 * @constructor
 * @uses Bucket
 * @uses BucketType
 * @uses BucketProps
 * @uses Cluster
 * @uses RiakObject
 * @uses ObjectMetadata
 */
export default Ember.Service.extend({
  /**
   * User-configurable URL prefix for the Explorer GUI.
   * (Also the URL prefix for the Explorer API).
   * Currently, the options are: '/' or '/admin/'.
   *
   * @property apiURL
   * @type String
   * @default '/'
   */
  apiURL: config.baseURL,

  name: 'explorer',

  availableIn: ['controllers', 'routes'],

  /**
   * Default chunk size for requests that can potentially have large amounts of records
   * i.e. buckets and keys
   *
   * @property pageSize
   * @type Integer
   * @default 500
   */
  pageSize: 500,

  /**
   * The 'deleted' cache is a way for the Ember GUI to keep track of which
   * objects have been deleted via user actions.
   *
   * Currently, deleting an object does not remove
   * its key from the Explorer API key list cache.
   * So, when a user presses 'Delete' on an object, they are returned to the
   * cached Key List for that bucket. But since the deleted object's key was
   * not removed from the cache, the key shows up.
   * To account for this and to provide a better user experience, this cache
   * was implemented.
   *
   * This cache tracks object deletions keyed by cluster/bucket type/bucket.
   *
   * @todo If/when the Explorer API caching code supports the removal of a key
   *     on object delete, this logic will be obsolete.
   *
   * @property deleted
   * @type Hash
   */
  deleted: {
    clusters: {}
  },

  /**
   * Re-populates the Bucket List cached by the Explorer API.
   * Currently, this is done via a Streaming List Buckets HTTP call to Riak,
   * and only available in Development Mode.
   * @todo Implement other methods of populating the bucket cache
   *    (for example, a user-supplied text file, or a Search query).
   *
   * @see http://docs.basho.com/riak/latest/dev/references/http/list-buckets/
   *
   * @method bucketCacheRefresh
   * @param {String} clusterId
   * @param {String} bucketTypeId
   * @return Ember.RSVP.Promise
   */
  bucketCacheRefresh(clusterId, bucketTypeId) {
    // For the moment, 'riak_kv' is the only implemented source of
    // cache refresh
    var url = `${this.apiURL}explore/clusters/${clusterId}/bucket_types/${bucketTypeId}/refresh_buckets/source/riak_kv`;

    return this.cacheRefresh(url);
  },

  /**
   * Refreshes a key list cache or bucket list cache on the Explorer API side.
   * Usually invoked when the user presses the 'Refresh List' button on the UI.
   * @see bucketCacheRefresh
   * @see keyCacheRefresh
   *
   * @method cacheRefresh
   * @param {String} url
   * @return Ember.RSVP.Promise
   */
  cacheRefresh(url) {
    return new Ember.RSVP.Promise(function(resolve, reject) {
      Ember.$.ajax({
        type: "POST",
        url: url
      }).then(
        function(data, textStatus, jqXHR) {
          resolve(jqXHR.status);
        },
        function(jqXHR, textStatus) {
          if (jqXHR.status === 202 && textStatus === 'parsererror') {
            // Server responds with 202 Accepted, and empty body
            resolve(jqXHR.status);
          }
          reject(textStatus);
        }
      );
    });
  },

  /**
   * Returns a Contents hash containing map data type fields sorted by
   * field type (Counters, Flags, Registers, Sets, nested Maps).
   * The sorting is done to make the editing and display UI code easier.
   * @see http://docs.basho.com/riak/latest/dev/using/data-types/
   * @see RiakObjectMap
   *
   * @method collectMapFields
   * @param rootMap {RiakObjectMap} Top-level Map in which these fields will live
   * @param parentMap {RiakObjectMap|RiakObjectEmbeddedMap} Standalone or
   *           nested map containing these fields. When a map is nested just
   *           one level deep, the parentMap is same as rootMap. For fields
   *           nested several levels deep, the parent map will be an embedded
   *           map field.
   * @param payload {Object} Value of the JSON payload of an HTTP GET
   *                   to the map object
   * @param store {DS.Store} Ember Data store, used to instantiate field models
   * @return {Object} A hash of fields indexed by CRDT type and field name.
   */
  collectMapFields(rootMap, parentMap, payload, store) {
    var contents = {
      counters: {},
      flags: {},
      registers: {},
      sets: {},
      maps: {}
    };
    var field;

    for (var fieldName in payload) {
      if (fieldName.endsWith('_counter')) {
        field = store.createRecord('riak-object.map-field', {
          fieldType: 'counter',
          name: fieldName,
          rootMap: rootMap,
          parentMap: parentMap,
          value: payload[fieldName]
        });
        contents.counters[fieldName] = field;
      }
      if (fieldName.endsWith('_flag')) {
        field = store.createRecord('riak-object.map-field', {
          fieldType: 'flag',
          name: fieldName,
          rootMap: rootMap,
          parentMap: parentMap,
          value: payload[fieldName]
        });
        contents.flags[fieldName] = field;
      }
      if (fieldName.endsWith('_register')) {
        field = store.createRecord('riak-object.map-field', {
          fieldType: 'register',
          name: fieldName,
          rootMap: rootMap,
          parentMap: parentMap,
          value: payload[fieldName]
        });
        contents.registers[fieldName] = field;
      }
      if (fieldName.endsWith('_set')) {
        field = store.createRecord('riak-object.map-field', {
          fieldType: 'set',
          name: fieldName,
          rootMap: rootMap,
          parentMap: parentMap,
          value: payload[fieldName]
        });
        contents.sets[fieldName] = field;
      }
      if (fieldName.endsWith('_map')) {
        field = store.createRecord('riak-object.embedded-map', {
          fieldType: 'map',
          name: fieldName,
          rootMap: rootMap,
          parentMap: parentMap
        });
        // This `field` becomes the `parentMap` for the nested fields.
        // `rootMap` stays the same
        let mapFields = this.collectMapFields(rootMap, field,
          payload[fieldName], store);
        field.value = mapFields;
        contents.maps[fieldName] = field;
      }
    }
    return contents;
  },

  /**
   * Creates and returns a BucketList instance, given the results of a
   * 'fetch cached Bucket List' call to the Explorer API.
   * @see ExplorerService.getBucketTypeWithBucketList
   *
   * @method createBucketList
   * @param data {Hash}
   * @param cluster {Cluster}
   * @param bucketType {BucketType}
   * @param store {DS.Store}
   * @return {BucketList}
   */
  createBucketList(data, cluster, bucketType, store, startItemIndex) {
    if (!data) {
      // No data, create an empty Bucket list
      return store.createRecord('bucket-list', {
        cluster: cluster,
        bucketType: bucketType,
        buckets: []
      });
    }
    // Turn a list of bucket names into a list of actual bucket instances
    var bucketList = data.buckets.buckets.map(function(bucketName) {
      return store.createRecord('bucket', {
        name: bucketName,
        cluster: cluster,
        bucketType: bucketType
      });
    });
    return store.createRecord('bucket-list', {
      cluster: cluster,
      bucketType: bucketType,
      buckets: bucketList,
      total: data.buckets.total,
      count: data.buckets.count,
      created: data.buckets.created,
      isLoaded: true,
      firstItemIndex: startItemIndex,
      pageSize: this.pageSize
    });
  },

  /**
   * Creates and returns a KeyList instance, given the results of a
   * 'fetch cached Key List' call to the Explorer API.
   * @see ExplorerService.getBucketWithKeyList
   *
   * @method createKeyList
   * @param data {Hash}
   * @param bucket {Bucket}
   * @param store {DS.Store}
   * @return {KeyList}
   */
  createKeyList(data, bucket, store, startItemIndex) {
    var explorer = this;
    if (!data) {
      // No data, return an empty KeyList
      return store.createRecord('key-list', {
        bucket: bucket,
        cluster: bucket.get('cluster'),
        keys: []
      });
    }
    // The model name depends on the "object type" - plain Object, CRDT, etc
    var modelName = bucket.get('objectModelName');

    // Cycle through the list of keys and create actual RiakObject instances
    var keyList = data.keys.keys.map(function(key) {
      var obj = store.createRecord(modelName, {
        key: key,
        bucket: bucket,
        bucketType: bucket.get('bucketType'),
        cluster: bucket.get('cluster'),
        isLoaded: false
      });
      if (explorer.wasObjectDeleted(obj)) {
        obj.set('markedDeleted', true);
      }
      return obj;
    });

    return store.createRecord('key-list', {
      bucket: bucket,
      cluster: bucket.get('cluster'),
      created: data.keys.created,
      count: data.keys.count,
      keys: keyList,
      total: data.keys.total,
      firstItemIndex: startItemIndex,
      pageSize: this.pageSize
    });
  },

  /**
   * Creates a Schema instance if it does not exist,
   *  and the returns instance.
   *
   * @method createSchema
   * @param name {String}
   * @param cluster {Cluster}
   * @param store {DS.Store}
   * @return {Schema}
   */
  createSchema(name, cluster, store) {
    let schema = cluster.get('searchSchemas').findBy('name', name);

    if (!schema) {
      schema = store.createRecord('search-schema', {
        id: `${cluster.get('id')}/${name}`,
        cluster: cluster,
        name: name
      });
    }

    return schema;
  },

  /**
   * Parses and returns the contents/value of a Riak Object, depending on
   * whether it's a CRDT or a plain object.
   *
   * @method createObjectContents
   * @param {Bucket} bucket
   * @param {RiakObject} newObject
   * @param {Object} payload
   * @param {DS.Store} store
   * @return {Object}
   */
  createObjectContents(bucket, newObject, payload, store) {
    var contents;
    if (bucket.get('props').get('isMap')) {
      contents = this.collectMapFields(newObject, newObject, payload.value, store);
    } else {
      contents = payload;
    }
    return contents;
  },

  /**
   * Creates and returns a RiakObject instance from the parsed results
   * of an HTTP Fetch Object ajax call.
   * @see getRiakObject
   *
   * @method createObjectFromAjax
   * @param key {String} Riak object key
   * @param bucket {Bucket}
   * @param rawHeader {String} jQuery AJAX calls return headers as a string :(
   * @param payload {Object}
   * @param store {DS.Store}
   * @param url {String} The URL to download the "raw" object payload
   *          (via an Explorer proxy request direct to Riak)
   * @return {RiakObject|RiakObjectCounter|RiakObjectMap|RiakObjectSet}
   */
  createObjectFromAjax(key, bucket, rawHeader, payload, store, url) {
    let metadata = this.createObjectMetadata(rawHeader, store);
    let modelName = bucket.get('objectModelName');
    let newObject = store.createRecord(modelName, {
      key: key,
      bucket: bucket,
      bucketType: bucket.get('bucketType'),
      cluster: bucket.get('cluster'),
      metadata: metadata,
      isLoaded: true,
      rawUrl: url
    });
    let contents = this.createObjectContents(bucket, newObject, payload, store);
    newObject.set('contents', contents);
    return newObject;
  },

  /**
   * Creates and returns an ObjectMetadata instance by parsing the raw
   * header string returned by AJAX calls, if available.
   *
   * @method createObjectMetadata
   * @param rawHeader {String}
   * @param store {DS.Store}
   * @return {ObjectMetadata}
   */
  createObjectMetadata(rawHeader, store) {
    if (!rawHeader) {
      return store.createRecord('object-metadata');
    }
    return store.createRecord('object-metadata', {
      headers: this.parseHeaderString(rawHeader)
    });
  },

  /**
   * Composes the JSON action object for the specified operation type for use
   * with the Riak Data Type HTTP API.
   * Invoked when the user edits and saves a Data Type object.
   * @see http://docs.basho.com/riak/latest/dev/using/data-types/
   *
   * @method dataTypeActionFor
   * @param object {RiakObject|RiakObjectMapField|RiakObjectEmbeddedMap}
   *            Data Type object to be edited
   * @param operationType {String} CRDT operation type
   *            (increment counter, add an element to set, update map)
   * @param item {String|RiakObjectMapField} Set element or map field
   * @return {String} JSON string payload used by Riak's Data Type HTTP API
   * @example Sample return value, for updating a counter:
   *     '{"increment": 1}'
   */
  dataTypeActionFor(object, operationType, item) {
    let bucket = object.get('bucket');
    let operation;
    if (bucket.get('props').get('isCounter')) {
      operation = this.dataTypeUpdateCounter(object, operationType);
    } else if (bucket.get('props').get('isSet')) {
      operation = this.dataTypeUpdateSet(operationType, item);
    } else if (bucket.get('props').get('isMap')) {
      operation = this.dataTypeUpdateNestedField(object, operationType, item);
    }
    if (!operation) {
      throw new Ember.Error(`Invalid data type or unsupported operation: ${operationType}`);
    }
    return JSON.stringify(operation);
  },

  /**
   * Returns the operation for updating a Counter data type.
   * (Will be converted to a JSON string payload, upstream.)
   *
   * @method dataTypeUpdateCounter
   * @param object {RiakObjectCounter|RiakObjectMapField}
   * @param operationType {String} increment or decrement
   * @return {Object} Update counter operation
   */
  dataTypeUpdateCounter(object, operationType) {
    if (operationType === 'increment') {
      return {increment: object.get('incrementBy')};
    } else if (operationType === 'decrement') {
      return {decrement: object.get('decrementBy')};
    }
  },

  /**
   * Wraps field update operations for potentially nested maps.
   *
   * @method dataTypeUpdateMap
   * @param field {RiakObjectMapField|RiakObjectEmbeddedMap}
   * @param subOperation {Object} Accumulator object for nested operations
   * @return {Object} Update map operation (to be converted to JSON and sent)
   */
  dataTypeUpdateMap(field, subOperation) {
    let parentField = field.get('parentMap');
    if (parentField.get('isTopLevel')) {
      return subOperation;
    } else {
      let operation = {update: {}};
      operation.update[parentField.get('name')] = subOperation;
      return this.dataTypeUpdateMap(parentField, operation);
    }
  },

  /**
   * Returns the operation for updating a Set data type.
   * (Will be converted to a JSON string payload, upstream.)
   *
   * @method dataTypeUpdateNestedField
   * @param object {RiakObjectMap|RiakObjectMapField|RiakObjectEmbeddedMap}
   * @param operationType {String}
   * @param item {String|RiakObjectMapField} Set element or map field
   * @return {Object} Update nested map field operation
   * @example
   *   Remove top-level field, object: Map, item: field
   *   '{ "remove": "<field name to be removed>" }'
   *   Remove field in a nested map, object: EmbeddedMap, item: field
   *   '{
     *      "update": {
     *          "<lvlOne_map>": {
     *              "remove": "<field name to be removed>"
     *          }
     *      }
     *    }'
   *   Remove field two levels deep, object: EmbeddedMap, item: field
   *   '{
     *      "update": {
     *          "<lvlOne_map>": {
     *              "update": {
     *                  "<lvlTwo_map>": {
     *                      "remove": "<field name to be removed>"
     *                  }
     *              }
     *          }
     *      }
     *    }'
   */
  dataTypeUpdateNestedField(object, operationType, item) {
    let fieldName = object.get('name');
    let fieldOperation = {
      update: {}
    };
    switch (operationType) {
      case 'removeField':
        // { "remove": "<field name to be removed>" }
        fieldOperation = {remove: item.get('name')};
        object = item;  // In this case, the item is the nested field
        break;
      case 'addField':
      case 'editField':
        // Add a Register, Flag or Counter field, with given value.
        // (Note: editing a register is the same update op as adding one)
        // {
        //     "update": {
        //         "page_visits_counter": 1
        //     }
        // }
        fieldName = item.get('name');
        object = item;  // In this case, the item is the nested field
        fieldOperation.update[fieldName] = item.get('value');
        break;
      case 'addElement':
      case 'removeElement':
        // {
        //     "update": {
        //         "interests_set": {
        //            "<add|remove>": "interest123"
        //         }
        //     }
        // }
        fieldOperation.update[fieldName] =
          this.dataTypeUpdateSet(operationType, item);
        break;
      case 'increment':
      case 'decrement':
        fieldOperation.update[fieldName] =
          this.dataTypeUpdateCounter(object, operationType);
        break;
      default:
        throw new Ember.Error(`Unsupported Update Map operation: ${operationType}`);
    }
    // Now wrap the update field operation in appropriate levels of
    // update map operations
    return this.dataTypeUpdateMap(object, fieldOperation);
  },

  /**
   * Returns the operation for updating a Set data type.
   * (Will be converted to a JSON string payload, upstream.)
   *
   * @method dataTypeUpdateSet
   * @param operationType {String}
   * @param element {String}
   * @return {Object} Update set operation
   */
  dataTypeUpdateSet(operationType, element) {
    if (operationType === 'removeElement') {
      return {remove: element};
    } else if (operationType === 'addElement') {
      return {add: element};
    }
  },

  /**
   * Performs a limited 'Delete Bucket' command via the Explorer API.
   * (This is done as a convenience operation for Devs, since Riak doesn't
   * currently support a whole-bucket delete.)
   * To be more precise, the Explorer backend iterates through all the keys
   * in its Key List cache for that bucket, and issues Delete Object commands
   * for those keys.
   *
   * Limitations:
   * - This is only available in Development Mode
   * - Explorer can only delete objects whose keys are in its cache.
   *
   * This means that the key list cache must already be populated.
   * However, since the 'Delete Bucket' button is only displayed once a
   * non-empty Key List cache is retrieved from the server, this is fine.
   *
   * @method deleteBucket
   * @param {Bucket} bucket
   * @return {Ember.RSVP.Promise} Result of the Delete Bucket AJAX request
   */
  deleteBucket(bucket) {
    var cluster = bucket.get('clusterId');
    var bucketType = bucket.get('bucketTypeId');
    var bucketId = bucket.get('bucketId');

    var url = `${this.apiURL}explore/clusters/${cluster}/bucket_types/${bucketType}/buckets/${bucketId}`;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      Ember.$.ajax({
        type: "DELETE",
        url: url,
        success: function(data, textStatus, jqXHR) {
          resolve(jqXHR.status);
        },
        error: function(jqXHR, textStatus) {
          if (jqXHR.status === 202 && textStatus === 'parsererror') {
            resolve(jqXHR.status);
          } else {
            reject(textStatus);
          }
        }
      });
    });
  },

  /**
   * Fetch the cache of Buckets and Keys deleted via the Explorer UI.
   * Initialize objects whenever missing.
   * See the `@property deleted` comments above, for explanation.
   *
   * @method deletedCacheFor
   * @param {String} clusterId
   * @param {String} bucketTypeId
   * @return {Hash}
   */
  deletedCacheFor(clusterId, bucketTypeId) {
    if (!this.deleted.clusters[clusterId]) {
      this.deleted.clusters[clusterId] = {types: {}};
    }
    if (!this.deleted.clusters[clusterId].types[bucketTypeId]) {
      this.deleted.clusters[clusterId].types[bucketTypeId] = {buckets: {}};
    }
    return this.deleted.clusters[clusterId].types[bucketTypeId];
  },

  /**
   * Performs a Delete Object operation, via a proxied Riak HTTP API request.
   * Also records its key in the `ExplorerService.deleted` cache
   *
   * @see http://docs.basho.com/riak/latest/ops/advanced/deletion/
   * @see http://docs.basho.com/riak/latest/dev/references/http/delete-object/
   *
   * @method deleteObject
   * @param object {RiakObject} RiakObject instance or subclasses (Maps, Sets, etc)
   * @return {Ember.RSVP.Promise} Result of the AJAX request.
   */
  deleteObject(object) {
    var cluster = object.get('clusterId');
    var bucketType = object.get('bucketTypeId');
    var bucket = object.get('bucketId');
    var key = object.get('key');
    var clusterUrl = this.getClusterProxyUrl(cluster);

    var url = `${clusterUrl}/types/${bucketType}/buckets/${bucket}/keys/${key}`;

    object.set('markedDeleted', true);

    var request = new Ember.RSVP.Promise(function(resolve, reject) {
      Ember.$.ajax({
        type: "DELETE",
        url: url,
        headers: {'X-Riak-Vclock': object.get('metadata').get('causalContext')}
      }).then(
        function(data, textStatus, jqXHR) {
          resolve(jqXHR.status);
        },
        function(jqXHR, textStatus) {
          reject(textStatus);
        }
      );
    });

    return request.catch(function(error) {
      console.log('Error deleting riak object: %O', error);
    });
  },

  /**
   * Creates and returns a Bucket instance by fetching the necessary data:
   * the bucket properties, as well as a Bucket Type instance (which also
   * fetches a Cluster instance).
   * @see BucketProps
   *
   * @method getBucket
   * @param {String} clusterId
   * @param {String} bucketTypeId
   * @param {String} bucketId
   * @param {DS.Store} store
   * @return {Bucket}
   */
  getBucket(clusterId, bucketTypeId, bucketId, store) {
    var self = this;
    return self.getBucketType(clusterId, bucketTypeId, store)
      .then(function(bucketType) {
        return self.getBucketProps(clusterId, bucketTypeId, bucketId, store)
          .then(function(bucketProps) {
            return store.createRecord('bucket', {
              name: bucketId,
              bucketType: bucketType,
              cluster: bucketType.get('cluster'),
              props: bucketProps
            });
          });
      });
  },

  /**
   * Performs a 'Fetch cached Bucket List' API call to Explorer.
   * If the call encounters a 404 Not Found (meaning, the bucket list cache
   * is empty), it proactively kicks off a Bucket Cache Refresh operation.
   * @see ExplorerService.bucketCacheRefresh
   *
   * @method getBucketList
   * @param {Cluster} cluster
   * @param {BucketType} bucketType
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<BucketList>} Result of the AJAX request
   */
  getBucketList(cluster, bucketType, store, start = 1, rows = this.pageSize) {
    var explorer = this;
    var clusterId = cluster.get('clusterId');
    var bucketTypeId = bucketType.get('bucketTypeId');

    var url = `${this.apiURL}explore/clusters/${clusterId}/bucket_types/${bucketTypeId}/buckets?start=${start}&rows=${rows}`;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      var xhrConfig = {
        url: url,
        dataType: 'json',
        type: 'GET',
        success: function(data) {
          bucketType.set('isBucketListLoaded', true);
          resolve(explorer.createBucketList(data, cluster, bucketType, store, start));
        },
        error: function(jqXHR, textStatus) {
          // Fail (likely a 404, cache not yet created)
          if (jqXHR.status === 404) {
            // Return an empty (Loading..) list. Controller will poll to
            // refresh it, later
            let data = null;
            let emptyList = explorer.createBucketList(data, cluster,
              bucketType, store);
            if (cluster.get('developmentMode')) {
              bucketType.set('isBucketListLoaded', false);
              emptyList.set('statusMessage', 'Cache not found. Refreshing from a streaming list buckets call...');
              // Kick off a Cache Refresh
              explorer.bucketCacheRefresh(clusterId, bucketTypeId);
            } else {
              bucketType.set('isBucketListLoaded', true);
              // In Production mode, no cache refresh will happen
              emptyList.set('cachePresent', false);
            }
            Ember.run(null, resolve, emptyList);
          } else {
            Ember.run(null, reject, textStatus);
          }
        }
      };

      Ember.$.ajax(xhrConfig);
    });
  },

  /**
   * Performs a proxied 'Fetch Bucket Properties' HTTP API call to Riak.
   * @see http://docs.basho.com/riak/latest/dev/references/http/get-bucket-props/
   *
   * @method getBucketProps
   * @param {String} clusterId
   * @param {String} bucketTypeId
   @ @param {String} bucketId
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<BucketProps>}
   */
  getBucketProps(clusterId, bucketTypeId, bucketId, store) {
    var clusterUrl = this.getClusterProxyUrl(clusterId);
    var propsUrl = `${clusterUrl}/types/${bucketTypeId}/buckets/${bucketId}/props`;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      var ajaxHash = {
        url: propsUrl,
        dataType: 'json',
        type: 'GET'
      };
      ajaxHash.success = function(data) {
        resolve(store.createRecord('bucket-props', data));
      };
      ajaxHash.error = function(jqXHR) {
        Ember.run(null, reject, jqXHR);
      };
      Ember.$.ajax(ajaxHash);
    });
  },

  /**
   * Fetches (via AJAX), creates and returns a Bucket Type instance.
   * (As well as required objects, such as the parent Cluster instance).
   *
   * Implementation note: Initially, the ability to fetch a single bucket type
   * record via the Explorer API wasn't available. This method fetches a
   * Cluster instance with all its bucket types, and selects the needed
   * individual bucket type.
   *
   * @method getBucketType
   * @param {String} clusterId
   * @param {String} bucketTypeId
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<BucketType>}
   */
  getBucketType(clusterId, bucketTypeId, store) {
    var self = this;
    return self.getCluster(clusterId, store)
      .then(function(cluster) {
        return cluster.get('bucketTypes')
          .findBy('originalId', bucketTypeId);
      });
  },

  /**
   * Fetches, creates and returns a Bucket Type instance as well as the
   * BucketList that goes along with it.
   *
   * @method getBucketTypeWithBucketList
   * @param {BucketType} bucketType
   * @param {Cluster} cluster
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<BucketType>}
   */
  getBucketTypeWithBucketList(bucketType, cluster, store, start, row) {
    return this
      .getBucketList(cluster, bucketType, store, start, row)
      .then(function(bucketList) {
        bucketType.set('bucketList', bucketList);
        return bucketType;
      });
  },

  /**
   * Returns all the Bucket Types that belong to the specified cluster.
   * This method tries to work with the Ember Data store adapter to take
   * advantage of the identity store and caching.
   * @see ExplorerResourceAdapter for more details
   *
   * @method getBucketTypesForCluster
   * @param {Cluster} cluster
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<Array<BucketType>>|Array<BucketType>}
   */
  getBucketTypesForCluster(cluster, store) {
    if (Ember.isEmpty(cluster.get('bucketTypes'))) {
      // If this page was accessed directly
      //  (via a bookmark and not from a link), bucket types are likely
      //  to be not loaded yet. Load them.
      return store.query('bucket-type',
        {clusterId: cluster.get('clusterId')})
        .then(function(bucketTypes) {
          cluster.set('bucketTypes', bucketTypes);
          return bucketTypes;
        });
    } else {
      return cluster.get('bucketTypes');
    }
  },

  /**
   * Initializes a given bucket with its Key List (by fetching it via AJAX),
   * and returns that bucket instance.
   *
   * @method getBucketWithKeyList
   * @param {Bucket} bucket
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<Bucket>}
   */
  getBucketWithKeyList(bucket, store, start, rows) {
    return this.getKeyList(bucket, store, start, rows)
      .then(function(keyList) {
        bucket.set('keyList', keyList);
        return bucket;
      });
  },

  /**
   * Creates and returns a Cluster object and initializes it with dependent
   * data (including all its Bucket Types and Search Indexes).
   *
   * @method getCluster
   * @param {String} clusterId
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<Cluster>}
   */
  getCluster(clusterId, store) {
    var self = this;

    return store.findRecord('cluster', clusterId)
      .then(function(cluster) {
        return Ember.RSVP.allSettled([
          cluster,
          self.getBucketTypesForCluster(cluster, store),
          self.getIndexesForCluster(cluster, store),
          self.getNodesForCluster(cluster, store)
        ]);
      })
      .then(function(PromiseArray) {
        let cluster = PromiseArray[0].value;

        // Create search-schemas from index references
        //  and set the schema/index association
        cluster.get('searchIndexes').forEach(function(index) {
          let schema = self.createSchema(index.get('schemaRef'), cluster, store);

          index.set('schema', schema);
        });

        return cluster;
      });
  },

  /**
   * Helper method, returns an explorer Cluster proxy URL
   * (which the Explorer API routes to a random node in the cluster).
   *
   * @method getClusterProxyUrl
   * @param {String} clusterId
   * @return {String} url
   */
  getClusterProxyUrl(clusterId) {
    return `${this.apiURL}riak/clusters/${clusterId}`;
  },

  /**
   * Returns a list of Search Indexes that have been created on this cluster.
   * @see http://docs.basho.com/riak/latest/dev/references/http/search-index-info/
   *
   * @method getIndexesForCluster
   * @param {DS.Model} cluster
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<Array<SearchIndex>>|Array<SearchIndex>}
   */
  getIndexesForCluster(cluster, store) {
    if (Ember.isEmpty(cluster.get('searchIndexes'))) {
      // If this page was accessed directly
      //  (via a bookmark and not from a link), bucket types are likely
      //  to be not loaded yet. Load them.
      return store.query('search-index', {clusterId: cluster.get('id')})
        .then(function(indexes) {
          cluster.set('searchIndexes', indexes);

          return indexes;
        });
    } else {
      return cluster.get('searchIndexes');
    }
  },

  /**
   * Fetches and creates a cached Key List for a given bucket.
   *
   * @method getKeyList
   * @param {Bucket} bucket
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise} result of the AJAX call
   */
  getKeyList(bucket, store, start = 1, rows = this.pageSize) {
    var clusterId = bucket.get('clusterId');
    var cluster = bucket.get('cluster');
    var bucketTypeId = bucket.get('bucketTypeId');
    var bucketId = bucket.get('bucketId');
    var explorer = this;

    var url = `${this.apiURL}explore/clusters/${clusterId}/bucket_types/${bucketTypeId}/buckets/${bucketId}/keys?start=${start}&rows=${rows}`;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      let xhrConfig = {
        url: url,
        dataType: 'json',
        type: 'GET',
        success: function(data) {
          bucket.set('isKeyListLoaded', true);
          resolve(explorer.createKeyList(data, bucket, store, start));
        },
        error: function(jqXHR, textStatus) {
          if (jqXHR.status === 404) {
            let data = null;
            let emptyList = explorer.createKeyList(data, bucket, store);
            if (cluster.get('developmentMode')) {
              bucket.set('isKeyListLoaded', false);
              emptyList.set('statusMessage', 'Cache not found. Refreshing from a streaming list keys call...');
              // Empty cache (need to kick off a refresh)
              // (only in development mode)
              explorer.keyCacheRefresh(clusterId, bucketTypeId, bucketId);
            } else {
              bucket.set('isKeyListLoaded', true);
              emptyList.set('cachePresent', false);
            }
            // Results in returning an empty (Loading..) key list
            Ember.run(null, resolve, emptyList);
          } else {
            // Some other error
            Ember.run(null, reject, textStatus);
          }
        }
      };

      Ember.$.ajax(xhrConfig);
    });
  },

  getNodeConfig(node) {
    let url = `${this.apiURL}explore/nodes/${node.get('id')}/config`;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      let request = Ember.$.ajax({
        url: url,
        type: 'GET'
      });

      request.done(function(data) {
        if (data.config.advanced_config) {
          node.set('advancedConfig', data.config.advanced_config);
        }

        if (data.config.config) {
          node.set('config', data.config.config);
        }

        resolve(data);
      });

      request.fail(function(data) {
        reject(data);
      });
    });
  },

  /**
   * Returns the results of a Riak node HTTP ping result.
   *
   * @method getNodePing
   * @param {String} nodeId
   * @return {Ember.RSVP.Promise} result of the AJAX call
   */
  getNodePing(nodeId) {
    let url = `${this.apiURL}riak/nodes/${nodeId}/ping`;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      let request = Ember.$.ajax({
        url: url,
        type: 'GET'
      });

      request.done(function(data) {
        resolve(data);
      });

      request.fail(function(data) {
        reject(data);
      });
    });
  },

  /**
   * Returns all reachable nodes for a given cluster id
   *
   * @method getNodesForCluster
   * @param {DS.Model} cluster
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<Array<RiakNode>>|Array<RiakNode>}
   */
  getNodesForCluster(cluster, store) {
    if (Ember.isEmpty(cluster.get('nodes'))) {
      return store.query('node', {clusterId: cluster.get('id')})
        .then(function(nodes) {
          cluster.set('nodes', nodes);

          return nodes;
        });
    } else {
      return cluster.get('nodes');
    }
  },

  /**
   * Gets and sets the node stats property. Returns the node model object.
   *
   * @method getNodeStats
   * @param {DS.Model} Node
   * @return {Ember.RSVP.Promise<Node>}
   */
  getNodeStats(node) {
    let url = `${this.apiURL}riak/nodes/${node.get('id')}/stats`;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      let request = Ember.$.ajax({
        url: url,
        type: 'GET'
      });

      request.done(function(data) {
        node.set('stats', data);

        resolve(node);
      });

      request.fail(function(data) {
        reject(data);
      });
    });
  },

  /**
   * Fetches and returns a Riak Object for the specified location
   * (bucket type, bucket and key).
   * @see http://docs.basho.com/riak/latest/dev/references/http/fetch-object/
   *
   * @method getRiakObject
   * @param {Bucket} bucket
   * @param {String} key
   * @param {DS.Store} store
   * @return {Ember.RSVP.Promise<RiakObject>} RiakObject or its subclasses (CRDTs)
   */
  getRiakObject(bucket, key, store) {
    var explorer = this;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      var processData;
      var headerString;
      var contents;
      var ajaxHash = {
        type: "GET",
        cache: false,
        headers: {'Accept': '*/*, multipart/mixed'}
      };
      var clusterUrl = explorer.getClusterProxyUrl(bucket.get('clusterId'));
      var bucketType = bucket.get('bucketTypeId');
      var bucketId = bucket.get('bucketId');
      var url = `${clusterUrl}/types/${bucketType}/buckets/${bucketId}`;

      if (bucket.get('props').get('isCRDT')) {
        url = `${url}/datatypes/${key}`;
        processData = true;  // Parse the payload as JSON
        ajaxHash.dataType = 'json';
        ajaxHash.success = function(data, textStatus, jqXHR) {
          headerString = jqXHR.getAllResponseHeaders();
          contents = data;  // Parsed json
          resolve(explorer.createObjectFromAjax(key, bucket, headerString,
            contents, store, url));
        };
      } else {
        // Regular Riak object
        url = `${url}/keys/${key}`;
        processData = false;
        ajaxHash.success = function(data, textStatus, jqXHR) {
          headerString = jqXHR.getAllResponseHeaders();
          contents = jqXHR.responseText;  // Unparsed payload
          resolve(explorer.createObjectFromAjax(key, bucket, headerString,
            contents, store, url));
        };
      }
      ajaxHash.processData = processData;
      ajaxHash.url = url;

      ajaxHash.error = function(jqXHR, textStatus) {
        if (jqXHR.status === 200 && textStatus === 'parsererror') {
          // jQuery tries to parse JSON objects, and throws
          // parse errors when they're invalid. Suppress this.
          headerString = jqXHR.getAllResponseHeaders();
          resolve(explorer.createObjectFromAjax(key, bucket, headerString,
            jqXHR.responseText, store, url));
        }
        if (jqXHR.status === 300) {
          // Handle 300 Multiple Choices case for siblings
          headerString = jqXHR.getAllResponseHeaders();
          resolve(explorer.createObjectFromAjax(key, bucket, headerString,
            jqXHR.responseText, store, url));
        } else {
          reject(jqXHR);
        }
      };
      Ember.$.ajax(ajaxHash);
    });
  },

  /**
   * Re-populates the Key List cached by the Explorer API.
   * Currently, this is done via a Streaming List Keys HTTP call to Riak,
   * and only available in Development Mode.
   * @todo Implement other methods of populating the key cache
   *    (for example, a user-supplied text file, or a Search query).
   *
   * @see http://docs.basho.com/riak/latest/dev/references/http/list-keys/
   *
   * @method keyCacheRefresh
   * @param {String} clusterId
   * @param {String} bucketTypeId
   * @param {String} bucketId
   * @return {Ember.RSVP.Promise} Result of the AJAX call
   */
  keyCacheRefresh(clusterId, bucketTypeId, bucketId) {
    // For the moment, 'riak_kv' is the only implemented source of
    // cache refresh
    var url = `${this.apiURL}explore/clusters/${clusterId}/bucket_types/${bucketTypeId}/buckets/${bucketId}/refresh_keys/source/riak_kv`;
    return this.cacheRefresh(url);
  },

  /**
   * Marks a key as deleted in the client-side ExplorerService.deleted cache.
   *
   * @method markDeletedKey
   * @param {RiakObject} object
   */
  markDeletedKey(object) {
    var clusterId = object.get('clusterId');
    var bucketTypeId = object.get('bucketTypeId');
    var bucketId = object.get('bucketId');
    var key = object.get('key');

    var bucketTypeDelCache = this.deletedCacheFor(clusterId, bucketTypeId);

    if (!bucketTypeDelCache.buckets[bucketId]) {
      bucketTypeDelCache.buckets[bucketId] = {
        keysDeleted: {},
        bucketDeleted: false
      };
    }

    bucketTypeDelCache.buckets[bucketId].keysDeleted[key] = true;
  },

  /**
   * Parses the raw AJAX headers string and returns it as a usable hash.
   *
   * XmlHttpRequest's getAllResponseHeaders() method returns a string of response
   * headers according to the format described here:
   * http://www.w3.org/TR/XMLHttpRequest/#the-getallresponseheaders-method
   *
   * Which we then have to parse. Like savages.
   *
   * @method parseHeaderString
   * @param {String} headerString
   * @return {Hash} headers
   */
  parseHeaderString(headerString) {
    var other_headers = {};
    var indexes = [];
    var custom = [];

    var headerLines = headerString.split("\r\n");

    for (var i = 0; i < headerLines.length; i++) {
      var headerLine = headerLines[i];

      // Can't use split() here because it does the wrong thing
      // if the header value has the string ": " in it.
      var index = headerLine.indexOf(': ');
      if (index > 0) {
        var key = headerLine.substring(0, index).toLowerCase();
        var val = headerLine.substring(index + 2);
        var header = {
          key: key,
          value: val
        };

        if (key.startsWith('x-riak-meta')) {
          custom.push(header);
        } else if (key.startsWith('x-riak-index')) {
          indexes.push(header);
        } else {
          other_headers[key] = val;
        }
      }
    }
    return {
      other: other_headers,
      indexes: indexes,
      custom: custom
    };
  },

  /**
   * Pings all nodes in a given cluster and sets the nodes status
   *
   * @method getNodesForCluster
   * @param {DS.Model} cluster
   * @param {DS.Store} store
   */
  pingNodesInCluster(cluster, store) {
    let self = this;

    this.getNodesForCluster(cluster, store).then(function(nodes) {
      nodes.forEach(function(node) {
        let nodeId = node.get('id');

        self.getNodePing(nodeId).then(function onSuccess(data) {
          node.set('available', true);
        }, function onFail(data) {
          node.set('available', false);
        });
      });
    });
  },

  /**
   * Updates a RiakObject via an HTTP Store Object request to the cluster.
   *
   * @method saveObject
   * @param {RiakObject} object
   * @return {Ember.RSVP.Promise} Result of the AJAX request.
   */
  saveObject(object) {
    var clusterUrl = this.getClusterProxyUrl(object.get('clusterId'));
    var bucketType = object.get('bucketTypeId');
    var bucketId = object.get('bucketId');
    var key = object.get('key');

    var url = `${clusterUrl}/types/${bucketType}/buckets/${bucketId}/keys/${key}`;

    var request = new Ember.RSVP.Promise(function(resolve, reject) {
      Ember.$.ajax({
        type: "PUT",
        processData: false,
        contentType: object.get('metadata').get('contentType'),
        url: url,
        headers: object.get('metadata').get('headersForUpdate'),
        data: object.get('contents')
      }).then(
        function(data, textStatus, jqXHR) {
          resolve(jqXHR.status);
        },
        function(jqXHR, textStatus) {
          reject(textStatus);
        }
      );
    });

    return request.catch(function(error) {
      console.log('Error saving riak object: %O', error);
    });
  },

  /**
   * Performs an update AJAX operation to the Riak Data Type HTTP API endpoint
   *
   * @method updateDataType
   * @param {RiakObjectCounter|RiakObjectSet|RiakObjectMap|RiakObjectMapField} object
   * @param {String} operationType
   * @param {String|RiakObjectMapField} item
   */
  updateDataType(object, operationType, item) {
    var bucket = object.get('bucket');
    var clusterUrl = this.getClusterProxyUrl(bucket.get('clusterId'));
    var bucketType = bucket.get('bucketTypeId');
    var bucketId = bucket.get('bucketId');
    var key = object.get('key');

    var url = `${clusterUrl}/types/${bucketType}/buckets/${bucketId}/datatypes/${key}`;
    var self = this;

    return new Ember.RSVP.Promise(function(resolve, reject) {
      var ajaxHash = {
        contentType: 'application/json',
        type: 'POST',
        dataType: 'json',
        url: url,
        data: self.dataTypeActionFor(object, operationType, item),
        success: function(data) {
          resolve(data);
        },
        error: function(jqXHR) {
          if (jqXHR.status === 204) {
            resolve(jqXHR.status);
          } else {
            reject(jqXHR);
          }
        }
      };
      Ember.$.ajax(ajaxHash);
    });
  },

  /**
   * Returns true if a given object was marked as deleted in the client-side
   * ExplorerService.deleted key cache.
   *
   * @method wasObjectDeleted
   * @param {RiakObject} object
   * @return {Boolean}
   */
  wasObjectDeleted(object) {
    var clusterId = object.get('clusterId');
    var bucketTypeId = object.get('bucketTypeId');
    var bucketId = object.get('bucketId');
    var key = object.get('key');
    var bucketTypeDelCache = this.deletedCacheFor(clusterId, bucketTypeId);
    if (!bucketTypeDelCache.buckets[bucketId]) {
      return false;
    }
    return bucketTypeDelCache.buckets[bucketId].keysDeleted[key];
  }
});
