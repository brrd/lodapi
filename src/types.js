/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const cheerio = require("cheerio");
const request = require("request");
const urljoin = require("url-join");

// data = { headers, baseUrl, idParent }
const getAvailableTypes = data =>
    new Promise(function(resolve, reject) {
        const postUrl = `/lodel/edition/index.php?id=${ String(data.idParent) }`;
        const getConfig = {
            url: urljoin(data.baseUrl, postUrl),
            followAllRedirects: true,
            headers: data.headers
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            } else if (response.statusCode !== 200) {
                reject(new Error("Erreur lors de la consultation des types"));
            }

            data.availableTypes = (function(body) {
                const $ = cheerio.load(body);
                const types = {};
                $("#addEntity select option").each(function() {
                    const value = $(this).attr("value");
                    if ((value == null)) { return; }
                    const id = __guard__(value.match(/\d+$/), x => x[0]);
                    if ((id == null)) { return; }
                    const name = $(this).text().trim();
                    console.log(`${name}: ${id}`);
                    return types[name] = id;
                });
                return types;
            })(body);

            if ((data.availableTypes == null)) {
                reject(new Error("Erreur lors de la consultation des types"));
            }
            return resolve(data);
        };

        return request.get(getConfig, done);
    })
;

module.exports = function(data) {
    if (!((data != null) && (data.headers != null) && (data.baseUrl != null) && (data.idParent != null))) { throw new Error("Missing arguments in types"); }
    return getAvailableTypes(data);
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}