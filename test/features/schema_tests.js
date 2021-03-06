'use strict';

// mocha defines to avoid JSHint breakage
/* global it, before */

const parallel = require('mocha.parallel');
const assert = require('../utils/assert.js');
const Server = require('../utils/server.js');
const preq   = require('preq');
const Ajv = require('ajv');
const OpenAPISchemaValidator = require('openapi-schema-validator').default;
const validator = new OpenAPISchemaValidator({ version: 3 });

parallel('Responses should conform to the provided JSON schema of the response', () => {
    const ajv = new Ajv({});
    const server = new Server();
    function getToday() {
        function zeroPad(num) {
            if (num < 10) {
                return `0${num}`;
            }
            return `${num}`;
        }
        const now = new Date();
        return `${now.getUTCFullYear()}/${zeroPad(now.getUTCMonth() + 1)}/${zeroPad(now.getUTCDate())}`;
    }

    before(() => server.start()
    .then(() => preq.get({uri: `${server.config.baseURL()}/?spec`}))
    .then((res) => {
        Object.keys(res.body.components.schemas).forEach((defName) => {
            ajv.addSchema(res.body.components.schemas[defName], `#/components/schemas/${defName}`);
        });
    }));
    after(() => server.stop());

    it('should expose valid OpenAPI spec', () => {
        return preq.get({ uri: `${server.config.baseURL()}/?spec` })
            .then((res) =>  {
                assert.deepEqual({errors: []}, validator.validate(res.body), 'Spec must have no validation errors');
            });
    });

    [
        {
            path: '/feed/featured',
            params: getToday(),
            schema: 'feed'
        },
        {
            domain: 'ru.wikipedia.org',
            path: '/feed/featured',
            params: getToday(),
            schema: 'feed'
        },
        {
            path: '/page/summary',
            params: 'Tank',
            schema: 'summary'
        },
        {
            path: '/feed/announcements',
            schema: 'announcementsResponse'
        },
        {
            path: '/feed/onthisday',
            params: 'all/01/03',
            schema: 'onthisdayResponse'
        },
        {
            path: '/page/related',
            params: 'Tank',
            schema: 'related'
        },
        {
            path: '/page/media',
            params: 'Tank',
            schema: 'media_list_with_metadata'
        },
        {
            path: '/page/media-list',
            params: 'Tank',
            schema: 'media_list'
        },
        {
            path: '/page/references',
            params: 'Tank',
            schema: 'references_response'
        },
        {
            path: '/page/metadata',
            params: 'Tank',
            schema: 'metadata'
        }
    ].forEach((testSpec) => {
        let name = `${testSpec.path} should conform schema`;
        if (testSpec.domain) {
            name += `, ${testSpec.domain}`;
        }
        it(name, () => {
            let path = `${server.config.baseURL(testSpec.domain)}${testSpec.path}`;
            if (testSpec.params) {
                path += `/${testSpec.params}`;
            }
            return preq.get({ uri: path })
            .then((res) => {
                if (!ajv.validate(`#/components/schemas/${testSpec.schema}`, res.body)) {
                    throw new assert.AssertionError({
                        message: ajv.errorsText()
                    });
                }
            });
        });
    });
});

