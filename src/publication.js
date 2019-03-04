/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const request = require("request");
const urljoin = require("url-join");

const createPublication = data =>
    new Promise(function(resolve, reject) {
        const postUrl = "/lodel/edition/index.php";
        const postConfig = {
            url: urljoin(data.baseUrl, postUrl),
            followAllRedirects: false,
            headers: data.headers,
            form: {
                do: "edit",
                id: 0,
                timestamp: Date.now(),
                idparent: data.idParent,
                idtype: data.idType,
                creationmethod: "form",
                edit: 1,
                "data[titre]": data.title != null ? data.title : "Nouvelle publication",
                "data[datepubli]": "today",
                creationinfo: "xhtml",
                visualiserdocument: true
            }
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            // On évite les redirections (cas des sous-paties redirigées vers le parent). On attend donc une 302
            // TODO: peut etre generalisable aux documents (plus simple ?)
            } else if (response.statusCode !== 302) {
                reject(new Error(`Erreur lors de la création de la publication '${data.title}'`));
            }

            // Récupérer l'identifiant de la publication depuis la réponse
            const getPubliId = function(response) {
                const match = response.headers.location.match(/\d+$/);
                if (match != null) { return match[0]; } else { return null; }
            };

            const publiId = getPubliId((response));
            if ((publiId == null)) {
                reject(new Error(`Impossible de récupérer l'id de la publication '${data.title}'`));
            }
            data.publiId = publiId;
            return resolve(data);
        };

        return request.post(postConfig, done);
    })
;

// data.title = optionnel
module.exports = function(data) {
    if (!((data != null) && (data.headers != null) && (data.baseUrl != null) && (data.idParent != null) && (data.idType != null))) { throw new Error("Missing arguments in publication"); }
    return createPublication(data);
};
