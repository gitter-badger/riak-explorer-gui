import Ember from 'ember';
import SideBarSelect from '../../mixins/sidebar-select';

export default Ember.Route.extend(SideBarSelect, {
  model: function(params) {
    let self = this;

    return this.explorer.getCluster(params.clusterId, this.store)
      .then(function(cluster) {
        return cluster.get('nodes').findBy('id', params.nodeId);
      }).then(function(node) {
        return Ember.RSVP.allSettled([
          node,
          self.explorer.getNodeStats(node),
          self.explorer.getNodeConfig(node)
        ]);
      }).then(function(promiseArray) {
        let node = promiseArray[0].value;

        return node;
      });
  },

  afterModel: function(model, transition) {
    this.setSidebarCluster(model.get('cluster'));
  }
});
