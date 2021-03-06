import DS from 'ember-data';

/**
 * Represents JSON-API style 'links' (for example, 'self').
 * Not currently used for much.
 *
 * @class Link
 * @extends DS.Model
 * @constructor
 */
export default DS.Model.extend({
  related: DS.attr(),
  self: DS.attr()
});
