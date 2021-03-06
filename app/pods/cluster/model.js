import DS from 'ember-data';
import config from '../../config/environment';

/**
 * Represents a Riak cluster as a whole.
 *
 * @class Cluster
 * @extends DS.Model
 * @constructor
 * @uses BucketType
 */
var Cluster = DS.Model.extend({
  /**
   * Bucket types created on the cluster
   * @property bucketTypes
   * @type Array<BucketType>
   */
  bucketTypes: DS.hasMany('bucket-type'),

  /**
   * Riak nodes assigned to the cluster
   * @property nodes
   * @type Array<BucketType>
   */
  nodes: DS.hasMany('node', {async: true}),

  /**
   * Search indexes created on the cluster
   * @property searchIndexes
   * @type Array<BucketType>
   */
  searchIndexes: DS.hasMany('search-index', {async: true}),

  /**
   * Search schemas created on the cluster
   * @property searchSchemas
   * @type Array<BucketType>
   */
  searchSchemas: DS.hasMany('search-schema', {async: true}),

  /**
   * Is this cluster in Dev Mode? Set in the Explorer config file.
   * Dev mode allows expensive operations like list keys, delete bucket, etc.
   * @property developmentMode
   * @type Boolean
   * @default false
   */
  developmentMode: DS.attr('boolean', {defaultValue: false}),

  /**
   * The Riak Type: either Open Source (oss), Enterprise Edition (ee), or "unavailable"
   * @property riakType
   * @type String
   */
  riakType: DS.attr('string', {defaultValue: 'oss'}),

  /**
   * Riak Version
   * @property riakVersion
   * @type String
   */
  riakVersion: DS.attr('string'),

  /**
   * Returns a list of currently activated bucket types.
   *
   * @method activeBucketTypes
   * @return {Array<BucketType>}
   */
  activeBucketTypes: function() {
    return this.get('bucketTypes').filterBy('isActive');
  }.property('bucketTypes'),

  /**
   * Returns the name of the cluster
   * (As specified in the `riak_explorer.conf` file)
   * Note: Currently unrelated to the source/datacenter name used by MDC Repl
   * @method clusterId
   * @type String
   */
  clusterId: function() {
    return this.get('id');
  }.property('id'),

  /**
   * Boolean check to see if the cluster has a Riak version number associated with it
   *
   * @method hasVersion
   * @returns Boolean
   */
  hasVersion: function() {
    return (this.get('riakVersion') && this.get('riakVersion') !== "unavailable");
  }.property('riakVersion'),

  /**
   * Boolean check to see if the cluster has a Riak type associated with it
   *
   * @method hasType
   * @returns Boolean
   */
  hasType: function() {
    return (this.get('riakType') && this.get('riakType') !== "unavailable");
  }.property('riakType'),

  /**
   * Returns a list of un-activated bucket types.
   *
   * @method inactiveBucketTypes
   * @return {Array<BucketType>}
   */
  inactiveBucketTypes: function() {
    return this.get('bucketTypes').filterBy('isInactive');
  }.property('bucketTypes'),

  /**
   * Boolean test on if the riakType is the open source edition
   *
   * @method isOpenSourceEdition
   * @return Boolean
   */
  isOpenSourceEdition: function() {
    return this.get('riakType') === 'oss';
  }.property('riakType'),

  /**
   * Boolean test on if the riakType is the enterprise edition
   *
   * @method isEnterpriseEdition
   * @return Boolean
   */
  isEnterpriseEdition: function() {
    return this.get('riakType') === 'ee';
  }.property('riakType'),

  /**
   * Returns true if this cluster is in production mode (development_mode=off)
   * @method productionMode
   * @type Boolean
   */
  productionMode: function() {
    return !this.get('developmentMode');
  }.property('developmentMode'),

  /**
   * Returns the URL which Explorer uses to forward requests to the cluster.
   * Used to link to Search schemas, on the Cluster view.
   * Having the config and url here is hacky, but no good alternatives.
   * @method proxyUrl
   * @return {String} URL
   */
  proxyUrl: function() {
    return config.baseURL + 'riak/clusters/' + this.get('id');
  }.property('id')
});

export default Cluster;
