/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const cheerio = require("cheerio");
const fs = require("fs");
const request = require("request");
const urljoin = require("url-join");

// Merci Lodel pour ces formidables formulaires qu'on doit intégralement recompléter pour charger un simple pdf !
// data = { headers, baseUrl, id, pdfPath }
const getFormValues = data =>
    new Promise(function(resolve, reject) {
        const getConfig = {
            url: urljoin(data.baseUrl, `/lodel/edition/index.php?do=view&id=${data.id}`),
            followAllRedirects: true,
            headers: data.headers
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            } else if (response.statusCode !== 200) {
                reject(new Error(`Erreur lors du chargement du pdf '${data.pdfPath}'`));
            }

            // Récupérer les valeurs du formulaire d'édition
            const getForm = function(body) {
                const $ = cheerio.load(body);
                const form = {};
                $("[name]").each(function() {
                    const type = $(this).attr("type");
                    if (["button", "submit"].includes(type)) { return; }
                    const name = $(this).attr("name");
                    let value = $(this).val();
                    if ((value == null) && (type === "checkbox")) { value = $(this).attr("checked"); }
                    if ((value == null)) { return; }

                    // Parce que Lodel aime bien faire compliqué (<select> des index)
                    if (name.match(/^pool_candidats_/) != null) {
                        const $prev = $(this).prev("input");
                        if (($prev == null)) {
                            console.error(`Attention : impossible de récupérer la valeur ${name}. Des index peuvent avoir disparu dans le document ${data.id}`);
                            return;
                        }
                        const prevName = $prev.attr("name");
                        value = Array.isArray(value) ? value.join(",") : value;
                        return form[prevName] = value;
                    } else {
                        return form[name] = value;
                    }
                });

                return form;
            };

            data.form = getForm(body);
            if ((data.form == null)) {
                reject(new Error(`Impossible de récupérer les informations du formulaire '${data.id}'`));
            }
            return resolve(data);
        };

        return request.get(getConfig, done);
    })
;

// Upload a doc
// data = { headers, baseUrl, pdfPath, id, form }
const uploadFileForm = data =>
    new Promise(function(resolve, reject) {
        const postUrl = `/lodel/edition/index.php?do=view&id=${ String(data.id) }`;
        // Réinjecter les données récupérées précédement dans le formulaire
        const formData = Object.assign({}, data.form);
        formData.do = "edit";
        formData.id = data.id;
        formData["data[alterfichier][radio]"] = "upload";
        formData["data[alterfichier][upload]"] = fs.createReadStream(data.pdfPath);
        const postConfig = {
            url: urljoin(data.baseUrl, postUrl),
            followAllRedirects: true,
            headers: data.headers,
            formData
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            } else if (response.statusCode !== 200) {
                reject(new Error(`Erreur lors du chargement du pdf '${data.pdfPath}'`));
            }
            data.pdfState = "loaded";
            return resolve(data);
        };

        return request.post(postConfig, done);
    })
;

module.exports = function(data) {
    if (!((data != null) && (data.headers != null) && (data.baseUrl != null) && (data.pdfPath != null) && (data.id != null))) { throw new Error("Missing arguments in upload-pdf"); }
    return getFormValues(data)
        .then(uploadFileForm);
};
