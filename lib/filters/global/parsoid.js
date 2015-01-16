'use strict';

/*
 * Simple wrapper for Parsoid
 */

var uuid   = require('node-uuid');
var rbUtil = require('../../rbUtil.js');

function pagebundle(parsoidHost, restbase, domain, key, rev) {
    var uri = parsoidHost + '/v2/' + domain + '/pagebundle/' + key + '/' + rev;
    return restbase.get({ uri: uri });
}

function saveParsoidResult(restbase, domain, bucket, key, format, tid) {
    return function (parsoidResp) {
        // handle the response from Parsoid
        if (parsoidResp.status === 200) {
            if (parsoidResp.body.html) {
                restbase.put({
                    uri: '/v1/' + domain + '/' + bucket + '.html/' + key + '/' + tid,
                    headers: parsoidResp.body.html.headers,
                    body: parsoidResp.body.html.body,
                });
            }
            if (parsoidResp.body['data-parsoid']) {
                restbase.put({
                    uri: '/v1/' + domain + '/' + bucket + '.data-parsoid/' + key + '/' + tid,
                    headers: parsoidResp.body['data-parsoid'].headers,
                    body: parsoidResp.body['data-parsoid'].body,
                });
            }
            // And return the response to the client
            if (parsoidResp.body[format]) {
                return {
                    status: 200,
                    headers: {
                        etag: tid,
                        'content-type': parsoidResp.body[format].headers['content-type'],
                    },
                    body: parsoidResp.body[format].body,
                };
            }
        }
        return parsoidResp;
    };
}

function generateAndSave(restbase, domain, bucket, key, format, revision, tid) {
    // Try to generate HTML on the fly by calling Parsoid
    return restbase.get({
        uri: '/v1/' + domain + '/_svc/parsoid/' + key + '/' + revision
    }).then(saveParsoidResult(restbase, domain, bucket, key, format, tid));
}

function getFormatRevision(format) {

    return function (restbase, req) {
        var domain = req.params.domain;
        var bucket = 'pages';
        var key = req.params.key;
        var revision = req.params.revision;

        if (req.headers && /no-cache/.test(req.headers['cache-control'])) {
            var tid = uuid.v1();
            return generateAndSave(restbase, domain, bucket, key, format, revision, tid);
        } else {
            return restbase.get(req).then(function(res) {
                var tid = (res.headers || {}).etag;
                if (res.status === 404 && /^[0-9]+$/.test(revision)) {
                  return generateAndSave(restbase, domain, bucket, key, format, revision, tid);
                } else {
                  return res;
                }
            });
        }
    };
}

var getWikitextRevision = getFormatRevision('wikitext');
var getHtmlRevision = getFormatRevision('html');
var getDataParsoidRevision = getFormatRevision('data-parsoid');

function transform(parsoidHost, from, to) {
    return function (restbase, req) {

        // Parsoid currently spells 'wikitext' as 'wt'
        var parsoidTo = (to === 'wikitext') ? 'wt' : to;

        // fake title to avoid Parsoid error: <400/No title or wikitext was provided>
        var parsoidExtra = (from === 'html') ? '/_' : '';

        return restbase.post({
            uri: parsoidHost + '/v2/' + req.params.domain + '/' + parsoidTo + parsoidExtra,
            headers: { 'content-type': 'application/json' },
            body: req.body
        });
    };
}

function transformRevision(parsoidHost, from, to) {
    return function (restbase, req) {

        var domain = req.params.domain;
        var key    = req.params.key;
        var rev    = req.params.revision;

        var fromStorage = {
            revid: rev
        };

        function get(format) {
            return restbase.get({ uri: '/v1/' + domain + '/pages/' + key + '/' + format + '/' + rev })
            .then(function (res) {
                if (res.body &&
                    res.body.headers && res.body.headers['content-type'] &&
                    res.body.body) {
                    fromStorage[format] = {
                        headers: {
                            'content-type': res.body.headers['content-type']
                        },
                        body: res.body.body
                    };
                }
            });
        }

        return Promise.all([ get('html'), get('wikitext'), get('data-parsoid') ])
        .then(function () {
            var body2 = {
                original: fromStorage
            };
            body2[from] = req.body;
            return restbase.post({
                uri: '/v1/' + domain + '/transform/' + from + '/to/' + to,
                headers: { 'content-type': 'application/json' },
                body: body2
            });
        });

    };
}

module.exports = function (conf) {
    if (!conf.parsoidHost) {
        conf.parsoidHost = 'http://parsoid-lb.eqiad.wikimedia.org';
    }
    return {
        paths: {
            '/v1/{domain}/_svc/parsoid/{key}/{rev}': {
                get: {
                    request_handler: function(restbase, req) {
                        var domain = req.params.domain;
                        var key = req.params.key;
                        var rev = req.params.rev;
                        return pagebundle(conf.parsoidHost, restbase, domain, key, rev);
                    }
                }
            },
            '/v1/{domain}/pages/{key}/wikitext/{revision}': {
                get: { request_handler: getWikitextRevision }
            },
            '/v1/{domain}/pages/{key}/html/{revision}': {
                get: { request_handler: getHtmlRevision }
            },
            '/v1/{domain}/pages/{key}/data-parsoid/{revision}': {
                get: { request_handler: getDataParsoidRevision }
            },
            '/v1/{domain}/transform/html/to/html': {
                post: { request_handler: transform(conf.parsoidHost, 'html', 'html') }
            },
            '/v1/{domain}/transform/html/to/wikitext': {
                post: { request_handler: transform(conf.parsoidHost, 'html', 'wikitext') }
            },
            '/v1/{domain}/transform/wikitext/to/html': {
                post: { request_handler: transform(conf.parsoidHost, 'wikitext', 'html') }
            },
            '/v1/{domain}/transform/html/to/html/{title}/{revision}': {
                post: { request_handler: transformRevision(conf.parsoidHost, 'html', 'html') }
            },
            '/v1/{domain}/transform/html/to/wikitext/{title}/{revision}': {
                post: { request_handler: transformRevision(conf.parsoidHost, 'html', 'wikitext') }
            },
            '/v1/{domain}/transform/wikitext/to/html/{title}/{revision}': {
                post: { request_handler: transformRevision(conf.parsoidHost, 'wikitext', 'html') }
            }
        }
    };
};