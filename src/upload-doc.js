/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const request = require("request");
const uploadPdf = require("./upload-pdf.js");
const urljoin = require("url-join");

// Upload a doc
// data = { headers, baseUrl, docPath, idParent, idType }
const uploadFileForm = data =>
    new Promise(function(resolve, reject) {
        const postUrl = `/lodel/edition/oochargement.php?idparent=${ String(data.idParent) }&idtype=${ String(data.idType) }`;
        const postConfig = {
            url: urljoin(data.baseUrl, postUrl),
            followAllRedirects: true,
            headers: data.headers,
            formData: {
                idparent: data.idParent,
                idtype: data.idType,
                fileorigin: "upload",
                mode: "strict",
                file1: fs.createReadStream(data.docPath)
            }
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            } else if (response.statusCode !== 200) {
                reject(new Error(`Erreur lors du chargement du document '${data.docPath}'`));
            }

            // Récupérer l'id de la tâche depuis le body renvoyé après l'upload
            const getTaskId = function(body) {
                const re = /window\.parent\.o\.changeStep\((\d+),\s+"(\d+)"\);/;
                const match = body != null ? body.match(re) : undefined;
                // OTX error
                if ((match == null) || (match[1] !== "3") || (match[2] == null)) {
                    return null;
                } else {
                    const taskId = match[2];
                    return taskId;
                }
            };

            const taskId = getTaskId(body);
            if ((taskId == null)) {
                reject(new Error("L'identifiant de la tâche n'a pas pu être récupéré"));
            }

            data.taskId = taskId;
            return resolve(data);
        };

        return request.post(postConfig, done);
    })
;

// data = { headers, baseUrl, idParent, taskId }
const getStatus = data =>
    new Promise(function(resolve, reject) {
        const postUrl = `/lodel/edition/checkimport.php?idtask=${ String(data.taskId) }&reload=0`;
        const getConfig = {
            url: urljoin(data.baseUrl, postUrl),
            followAllRedirects: false,
            headers: data.headers
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            } else if (response.statusCode !== 200) {
                reject(new Error(`Erreur lors de la récupération du log OTX (${data.taskId})`));
            }

            data.status = (function(body) {
                const $ = cheerio.load(body);
                const status = $("#status").text();
                return (status != null ? status.replace(/(\n|\s)+/g, " ") : undefined);
            })(body);

            if ((data.status == null)) {
                reject(new Error(`Impossible de récupérer le log OTX (${data.taskId})`));
            }
            return resolve(data);
        };

        return request.get(getConfig, done);
    })
;

// data = { headers, baseUrl, docPath, idParent, idType, taskId }
const validateTask = data =>
    new Promise(function(resolve, reject) {
        const postUrl = `/lodel/edition/index.php?do=import&idtask=${ String(data.taskId) }&finish=oui&visualiserdocument=oui&reload=`;
        const postConfig = {
            url: urljoin(data.baseUrl, postUrl),
            followAllRedirects: true,
            headers: data.headers
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            } else if (response.statusCode !== 200) {
                reject(new Error(`Erreur lors de la validation de la tâche ${data.taskId}`));
            }

            // Récupérer l'identifiant du document depuis l'URL de retour
            const getDocId = function(href) {
                const match = href.match(/\d+$/);
                const id = (match != null) ? match[0] : null;
                return id;
            };

            const id = getDocId(response.request.uri.href);
            if ((id == null)) {
                reject(new Error(`Une erreur est survenue durant le chargement du document '${ data.docPath } : impossible de récupérer son id'`));
            }
            data.docId = id;
            return resolve(data);
        };

        return request(postConfig, done);
    }) // TODO: preciser post, car c'est indiqué nulle part. A tester tranquillement
;

// PDF
// data.pdfPath
// TODO: message à logger
const addPdf = data =>
    new Promise(function(resolve, reject) {
        let pdfAbsPath;
        if ((data.pdfPath == null)) {
            data.pdfState = "off";
            resolve(data);
        }
        // Get PDF absolute path
        if (path.isAbsolute(data.pdfPath)) {
            pdfAbsPath = data.pdfPath;
        } else {
            const dirPath = path.dirname(data.docPath);
            pdfAbsPath = path.join(dirPath, pdfAbsPath);
        }
        // Check for pdf existence
        return fs.stat(pdfAbsPath, function(err, stat) {
            if (err != null) {
                const pdfBasename = path.basename(pdfAbsPath);
                data.pdfState = "none";
                return resolve(data); // On ne lance pas pour autant d'erreur ici
            } else {
                data.id = data.docId; // TODO: IL FAUT NORMALISER ÇA ENTRE LES METHODES POUR AVOIR UNE API CONSITENTE ET ÉVITER CE GENRE DE MANIP DEGUEU ET DANGEREUSE !
                return uploadPdf(data).then(resolve, reject);
            }
        });
    })
;

// TODO: Ceci devrait être l'objet d'une option qui correspond au niveau de log (none|normal|debug) + il faudrait préfixer chaque log avec le nom de l'opération et du fichier
const logStatus = function(data) {
    // Stop spinner
    const filename = path.basename(data.docPath);
    if (__guard__(__guard__(data != null ? data.multispinner : undefined, x1 => x1.spinners), x => x[filename])) { data.multispinner.success(filename); }
    // Log
    // FIXME: incompatible avec le spinner. Il faudrait plutot mettre ça dans un log affiché à la fin.
    // console.log("Le fichier #{data.docPath} a été chargé avec l'identifiant #{data.docId} et le message : '#{data.status}'")
    return Promise.resolve(data);
};

module.exports = function(data) {
    if (!((data != null) && (data.headers != null) && (data.baseUrl != null) && (data.docPath != null) && (data.idParent != null) && (data.idType != null))) { throw new Error("Missing arguments in upload-doc"); }
    return uploadFileForm(data)
        .then(getStatus)
        .then(validateTask)
        .then(addPdf)
        .then(logStatus)
        .catch(function(err){
            console.error(err);
            const filename = path.basename(data.docPath);
            if (__guard__(__guard__(data != null ? data.multispinner : undefined, x1 => x1.spinners), x => x[filename])) { return data.multispinner.error(filename); }
    });
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}