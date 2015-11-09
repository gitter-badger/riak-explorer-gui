# Riak Explorer GUI

This is the GUI component of the [Riak Explorer](https://github.com/basho-labs/riak_explorer)
project.

If you just want to try it out, download the pre-compiled package from the
[Riak Explorer Installation](https://github.com/basho-labs/riak_explorer#installation)
section of the main project's repo. For development instructions, see below.

## Development Prerequisites

You will need the following things properly installed on your computer.

* [Git](http://git-scm.com/)
* [Node.js](http://nodejs.org/) (with NPM)
* [Bower](http://bower.io/)
* [Ember CLI](http://www.ember-cli.com/)
* [PhantomJS](http://phantomjs.org/)

Also, it will need [Riak KV](http://basho.com/products/riak-kv/) installed
and running, as well as the [Riak Explorer
API](https://github.com/basho-labs/riak_explorer).
See the [Explorer
API Dev Instructions](https://github.com/basho-labs/riak_explorer/blob/master/DEVELOPMENT.md)
for more details.

## Installing Ember pre-requisites

* `git clone <repository-url>` this repository
* `cd` into this new directory
* `npm install`
* `bower install`

## Running / Development

Unfortunately, for the moment we're unable to have this app work with the built-
in Ember dev server (the one you get by running `ember server`). Instead, the
development cycle is as follows:

1. Run `make`. This compiles everything in the Ember
    build pipeline, and copies it into the local `dist/` directory.

2. Copy the contents of the build from the local `dist/` into Riak Explorer API's
    `dist/` directory.

3. Refresh the browser to see changes, as usual. The URL for the Ember app
    is served on the same port as the Explorer API (port `9000`, by default).

For example, if your riak_explorer repo is located at
`/Users/yourusername/code/riak_explorer`, you can do:

```bash
export EXPLORER_PATH=/Users/yourusername/code/riak_explorer

cp -R dist/* $EXPLORER_PATH/priv/ember_riak_explorer/dist
```

Then, during subsequent development, you can just run:

```bash
make recompile && cp -R dist/* $EXPLORER_PATH/priv/ember_riak_explorer/dist
```

(#TODO - consider moving `$EXPLORER_PATH` into the `Makefile`?)

## Notes to Ember.js Developers

This project uses Ember 2.0+, and uses Pods for most of its routes. There are
still a few standalone routes and models, however.

The main interface to Riak is through plain AJAX calls, done in the `explorer`
service, in `app/services/explorer.js`.

Take a look at the [listing of Explorer API
resources](https://github.com/basho-labs/riak_explorer#api). The three types of
API endpoints available are:

  1. The Riak proxy endpoints, `/riak/nodes/` and `/riak/clusters/`. The app
      uses these endpoints to make calls to the plain [Riak HTTP
      API](http://docs.basho.com/riak/latest/dev/references/http/). The proxy
      endpoints are used for several reasons, primarily due to CORS issues
      (on the Riak API side).

  2. Explorer endpoints, at `/explorer/`. Think of it as an enhancement to
      Riak's own HTTP API, to fill in missing functionality. For example,
      the plain Riak API doesn't have a 'list bucket types' functionality --
      that can only be done via `riak-admin` CLI. The Explorer endpoints enable
      this, at `/explore/clusters/$cluster/bucket_types`.

  3. Control endpoints at `/control/`. These provide a REST API to cluster
      operations that are normally available only through the Riak CLI
      (for example, `riak-admin cluster join`).

In general, neither the Riak API nor the Explorer API are Ember Data-friendly.
None of the Riak HTTP API results are in JSON-API format (no unique IDs, etc).
The situation is slightly better on Explorer endpoints (since we can change
those a lot more easily than we can the actual Riak API), we can put at least
*some* of them in JSON-API format. For the rest, we just use plain AJAX calls
(in the `explorer.js` service).

The main challenges to taking fuller advantage of Ember Data (and the built-in
identity map, caching, etc) are:

1. Ember Data assumes flat URLs, with unique IDs. Whereas both Riak and Explorer
    have deeply nested URLs, with what essentially are "compound keys", in RDBMS
    language. Take a look at `ExplorerResourceAdapter`'s `buildURL()` and
    `urlForQuery()` methods (in `app/services/explorer-resources.js`) at how we
    work around this.

2. Similarly, there are no ID-like fields returned -- we have to normalize and
    inject these manually. Look at `ExplorerResourceAdapter.normalizeId`,
    `injectParentIds` and `normalizeProps` to get an idea of what's involved.

### Running Tests

(Default Ember doc copy)

* `ember test`
* `ember test --server`

### Building

(Default Ember doc copy)

* `ember build` (development)
* `ember build --environment production` (production)

## Further Reading / Useful Links

* [ember.js](http://emberjs.com/)
* [ember-cli](http://www.ember-cli.com/)
* Development Browser Extensions
  * [ember inspector for chrome](https://chrome.google.com/webstore/detail/ember-inspector/bmdblncegkenkacieihfhpjfppoconhi)
  * [ember inspector for firefox](https://addons.mozilla.org/en-US/firefox/addon/ember-inspector/)
