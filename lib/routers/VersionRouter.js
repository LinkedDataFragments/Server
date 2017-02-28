/*! @license MIT ©2014-2016 Ruben Verborgh, Ghent University - imec */
/* A VersionRouter routes version queries */

// Creates a new VersionRouter.
function VersionRouter(config) {
  if (!(this instanceof VersionRouter))
    return new VersionRouter(config);
}

// Extracts a page parameter from the request and adds it to the query
VersionRouter.prototype.extractQueryParams = function (request, query) {
  var versionType = request.url && request.url.query && request.url.query.versionType || 'VersionMaterialized',
      version = parseInt(request.url && request.url.query && request.url.query.version, 10),
      versionStart = parseInt(request.url && request.url.query && request.url.query.versionStart || 0, 10),
      versionEnd = parseInt(request.url && request.url.query && request.url.query.versionEnd || -1, 10),
      features = query.features || (query.features = {});

  query.versionType = versionType;
  if (query.versionType === 'VersionMaterialized') {
    query.version = version;
    features.version = true;
  }
  else if (query.versionType === 'DeltaMaterialized') {
    query.versionStart = versionStart;
    query.versionEnd = versionEnd;
    features.version = true;
  }
  else if (query.versionType === 'Version')
    features.version = true;
  else {
    query.versionType = 'VersionMaterialized';
    features.version = true;
  }
};

module.exports = VersionRouter;