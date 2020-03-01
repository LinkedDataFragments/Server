/*! @license MIT ©2016 Miel Vander Sande, Ghent University - imec */
/* A MementoControllerExtension extends Triple Pattern Fragments responses with Memento headers. */

var Controller = require('@ldf/core').controllers.Controller,
    TimegateController = require('./TimegateController'),
    url = require('url'),
    _ = require('lodash');

// Creates a new MementoControllerExtension
class MementoControllerExtension extends Controller {
  constructor(settings) {
    var timegates = settings.timegates || {};
    this._invertedTimegateMap = TimegateController.parseInvertedTimegateMap(timegates.mementos,
      settings.datasources, settings.urlData);
    this._timegateBaseUrl = timegates.baseURL || '/timegate/';
  }

  // Add Memento Link headers
  _handleRequest(request, response, next, settings) {
    var datasource = settings.query.datasource,
        memento = this._invertedTimegateMap[settings.datasource.id],
        requestQuery = request.url.match(/\?.*|$/)[0];

    // Add link to original if it is a memento
    if (memento && memento.interval && memento.interval.length === 2) {
      var timegatePath = this._timegateBaseUrl + memento.memento,
          timegateUrl = url.format(_.defaults({ pathname: timegatePath }, request.parsedUrl)),
          originalUrl = memento.original + requestQuery,
          datetime = new Date(memento.interval[0]).toUTCString();

      response.setHeader('Link', '<' + originalUrl + '>;rel=original, <' + timegateUrl + '>;rel=timegate');
      response.setHeader('Memento-Datetime', datetime);
    }
    // Add timegate link if resource is not a memento
    else {
      var timegateSettings = settings.datasource.timegate, timegate;
      // If a timegate URL is given, use it
      if (typeof timegateSettings === 'string')
        timegate = timegateSettings + requestQuery;
      // If the timegate configuration is true, use local timegate
      else if (timegateSettings === true)
        timegate = url.format(_.defaults({ pathname: this._timegateBaseUrl + datasource }, request.parsedUrl));
      if (timegate)
        response.setHeader('Link', '<' + timegate + '>;rel=timegate');
    }
    next();
  }
}

module.exports = MementoControllerExtension;
