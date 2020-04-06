/*! @license MIT ©2014-2016 Ruben Verborgh, Ghent University - imec */
/* A Datasource provides base functionality for queryable access to a source of quads. */

var fs = require('fs'),
    _ = require('lodash'),
    UrlData = require('../UrlData'),
    BufferedIterator = require('asynciterator').BufferedIterator,
    EventEmitter = require('events'),
    stringToTerm = require('rdf-string').stringToTerm;

// Creates a new Datasource
class Datasource extends EventEmitter {
  constructor(options, supportedFeatureList) {
    super();

    // Set the options
    options = options || {};
    var urlData = options.urlData || new UrlData();
    var path = (options.path || '').replace(/^\//, '');
    this._datasourcePath = urlData.baseURLPath + encodeURI(path);
    this._blankNodePrefix = urlData.blankNodePath || 'genid:';
    this._skolemizeBlacklist = options.skolemizeBlacklist || {};
    this.title = options.title;
    this.id = options.id;
    this.hide = options.hide;
    this.description = options.description;
    this.path = this._datasourcePath;
    this.url = urlData.baseURLRoot + this._datasourcePath + '#dataset';
    this.license = options.license;
    this.licenseUrl = options.licenseUrl;
    this.copyright = options.copyright;
    this.homepage = options.homepage;
    this._request = options.request || require('request');
    this._blankNodePrefix = options.blankNodePrefix || this._blankNodePrefix;
    this._blankNodePrefixLength = this._blankNodePrefix.length;
    this.dataFactory = options.dataFactory;
    if (options.graph) {
      this._graph = this.dataFactory.namedNode(options.graph);
      this._queryGraphReplacements = Object.create(null);
      this._queryGraphReplacements[''] = 'urn:ldf:emptyGraph';
      this._queryGraphReplacements[options.graph] = '';
    }
    this._supportsQuads = 'quads' in options ? options.quads : true;

    // Whether the datasource can be queried
    this.initialized = false;

    // Expose the supported query features
    if (supportedFeatureList && supportedFeatureList.length) {
      var objectSupportedFeatures = {};
      for (var i = 0; i < supportedFeatureList.length; i++)
        objectSupportedFeatures[supportedFeatureList[i]] = true;
      this.supportedFeatures =  objectSupportedFeatures;
    }
    else
      this.supportedFeatures = {};
    if (!this._supportsQuads)
      delete this.supportedFeatures.quadPattern;
    Object.freeze(this.supportedFeatures);
  }


  // Initialize the datasource asynchronously
  initialize() {
    setImmediate(function (self) {
      var done = _.once(function (error) {
        if (error)
          self.emit('error', error);
        else {
          self.initialized = true;
          self.emit('initialized');
        }
      });
      try { self._initialize(done); }
      catch (error) { done(error); }
    }, this);
  }

  // Prepares the datasource for querying
  _initialize(done) {
    done();
  }

  // Checks whether the data source can evaluate the given query
  supportsQuery(query) {
    // An uninitialized datasource does not support any query
    if (!this.initialized)
      return false;

    // A query is supported if the data source supports all of its features
    var features = query.features, supportedFeatures = this.supportedFeatures, feature;
    if (features) {
      for (feature in features) {
        if (features[feature] && !supportedFeatures[feature])
          return false;
      }
      return true;
    }
    // A query without features is supported if this data source has at least one feature
    else {
      for (feature in supportedFeatures) {
        if (supportedFeatures[feature])
          return true;
      }
      return false;
    }
  }

  // Selects the quads that match the given query, returning a quad stream
  select(query, onError) {
    if (!this.initialized)
      return onError && onError(new Error('The datasource is not initialized yet'));
    if (!this.supportsQuery(query))
      return onError && onError(new Error('The datasource does not support the given query'));
    query = _.clone(query);

    // Translate blank nodes IRIs in the query to blank nodes
    var blankNodePrefix = this._blankNodePrefix, blankNodePrefixLength = this._blankNodePrefixLength;
    if (query.subject && query.subject.value.indexOf(blankNodePrefix) === 0)
      query.subject = this.dataFactory.blankNode(query.subject.value.substr(blankNodePrefixLength));
    if (query.object  && query.object.value.indexOf(blankNodePrefix) === 0)
      query.object  = this.dataFactory.blankNode(query.object.value.substr(blankNodePrefixLength));
    if (query.graph   && query.graph.value.indexOf(blankNodePrefix) === 0)
      query.graph   = this.dataFactory.blankNode(query.graph.value.substr(blankNodePrefixLength));

    // If a custom default graph was set, query it as the default graph
    if (this._graph && query.graph && query.graph.value in this._queryGraphReplacements)
      query.graph = stringToTerm(this._queryGraphReplacements[query.graph.value], this.dataFactory);

    // Transform the received quads
    var destination = new BufferedIterator(), outputQuads, graph = this._graph, self = this;
    outputQuads = destination.map(function (quad) {
      // Translate blank nodes in the result to blank node IRIs.
      if (quad.subject && quad.subject.termType === 'BlankNode' && !self._skolemizeBlacklist[quad.subject.value])
        quad.subject = self.dataFactory.namedNode(blankNodePrefix + quad.subject.value);
      if (quad.object  && quad.object.termType  === 'BlankNode' && !self._skolemizeBlacklist[quad.object.value])
        quad.object  = self.dataFactory.namedNode(blankNodePrefix + quad.object.value);
      if (quad.graph   && quad.graph.termType !== 'DefaultGraph') {
        if (quad.graph.termType === 'BlankNode' && !self._skolemizeBlacklist[quad.graph.value])
          quad.graph = self.dataFactory.namedNode(blankNodePrefix + quad.graph.value);
      }
      // If a custom default graph was set, move default graph triples there.
      quad.graph = quad.graph && quad.graph.termType !== 'DefaultGraph' ? quad.graph : (graph || quad.graph);
      return quad;
    });
    outputQuads.copyProperties(destination, ['metadata']);
    onError && outputQuads.on('error', onError);

    // Execute the query
    try { this._executeQuery(query, destination); }
    catch (error) { outputQuads.emit('error', error); }
    return outputQuads;
  }

  // Writes the results of the query to the given destination
  _executeQuery(query, destination) {
    throw new Error('_executeQuery has not been implemented');
  }

  // Retrieves a stream through HTTP or the local file system
  _fetch(options) {
    var self = this, stream,
        url = options.url, protocolMatch = /^(?:([a-z]+):)?/.exec(url);
    switch (protocolMatch[1] || 'file') {
    // Fetch a representation through HTTP(S)
    case 'http':
    case 'https':
      stream = this._request(options);
      stream.on('response', function (response) {
        if (response.statusCode >= 300) {
          setImmediate(function () {
            stream.emit('error', new Error(url + ' returned ' + response.statusCode));
          });
        }
      });
      break;
    // Read a file from the local filesystem
    case 'file':
      stream = fs.createReadStream(url.substr(protocolMatch[0].length), { encoding: 'utf8' });
      break;
    default:
      stream = new EventEmitter();
      setImmediate(function () {
        stream.emit('error', new Error('Unknown protocol: ' + protocolMatch[1]));
      });
    }

    // If the stream has no other error handlers attached (besides this one),
    // emit the stream error as a datasource error
    stream.on('error', function (error) {
      if (stream.listenerCount('error') === 1)
        self.emit('error', error);
    });
    return stream;
  }

  // Closes the data source, freeing possible resources used
  close(callback) {
    callback && callback();
  }
}


module.exports = Datasource;
