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
     * Returns a list of currently activated bucket types.
     *
     * @method activeBucketTypes
     * @return {Array<BucketType>}
     */
    activeBucketTypes: function() {
        return this.get('bucketTypes').filterBy('isActive');
    }.property('bucketTypes'),

    /**
     * Bucket types created on the cluster
     * @property bucketTypes
     * @type Array<BucketType>
     */
    bucketTypes: DS.hasMany('bucket-type'),

    /**
     * Returns the name of the cluster
     * (As specified in the `riak_explorer.conf` file)
     * Note: Currently unrelated to the source/datacenter name used by MDC Repl
     * @property clusterId
     * @type String
     */
    clusterId: function() {
        return this.get('id');
    }.property('id'),

    /**
     * Riak node through which Explorer connects to this riak cluster,
     * in Erlang node id format.
     * @type String
     * @default null
     * @example
     *    'riak@127.0.0.1'
     */
    riakNode: DS.attr('string', {defaultValue: null}),

    /**
     * Is this cluster in Dev Mode? Set in the Explorer config file.
     * Dev mode allows expensive operations like list keys, delete bucket, etc.
     * @property developmentMode
     * @type Boolean
     * @default false
     */
    developmentMode: DS.attr('boolean', {defaultValue: false}),

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
     * List of Search Indexes that have been created on this cluster.
     * @see http://docs.basho.com/riak/latest/dev/using/search/
     * @property indexes
     * @type Array<Hash>
     * @example
     *    [{"name":"customers","n_val":3,"schema":"_yz_default"}]
     */
    indexes: DS.attr(),

    /**
     * List of Riak nodes belonging to the cluster
     * @property nodes
     * @type Array<Hash>
     * @example
     *    [{"id":"riak@127.0.0.1"}]
     */
    nodes: DS.attr(),

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
