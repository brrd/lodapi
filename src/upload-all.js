/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const chalk = require("chalk");
const fs = require("fs");
let path = require("path");
const Multispinner = require("multispinner");
path = require("path");
const request = require("request");
const Table = require("tty-table");
const uploadDoc = require("./upload-doc.js");
const urljoin = require("url-join");

// Get files list
const getDocsList = data =>
    new Promise(function(resolve, reject) {
        return fs.readdir(data.dirPath, function(err, items) {
            if (err) { reject(err); }
            const docs = [];
            // FIXME: ne pas traiter les fichiers temporaires de Word, qui commencent par ~$
            for (let filename of Array.from(items)) { if (path.extname(filename) === ".doc") { docs.push(filename); } }
            data.docs = docs;
            return resolve(data);
        });
    })
;

// Batch upload
const uploadFiles = function(data) {
    const getPdfPath = function(dirPath, docName) {
        let pdfPath;
        const pdfName = docName.replace(/\.doc$/i, ".pdf");
        if (pdfName === docName) { return null; }
        return pdfPath = path.join(data.dirPath, pdfName);
    };

    const mapFunc = function(filename) {
        const config = {
            headers: data.headers,
            baseUrl: data.baseUrl,
            idParent: data.idParent,
            idType: data.idType,
            docPath: path.join(data.dirPath, filename),
            multispinner: data.multispinner
        };
        // data.pdf option
        if (data.pdf === true) { config.pdfPath = getPdfPath(data.dirPath, filename); }
        return uploadDoc(config);
    };

    data.multispinner = new Multispinner(data.docs, { clear: true, color: { incomplete: "white" } });
    const promises = data.docs.map(mapFunc);
    return Promise.all(promises);
};

// sort docs after loading
// Comme les docs sont chargés en async, il faut les remettre dans l'ordre à la fin
// datas is an array of data returned by Promise.all
// TODO: ne pas trier quand un seul doc
const sortDocs = datas =>
    new Promise(function(resolve, reject) {
        // sort datas depending on filename
        // FIXME: fait passer 10 devant 2. Trouver un module de sort file sur NPM (il y en a meme qui trient direct d'apres une cle d'objet)
        let siteName;
        datas.sort(function(a, b) {
            const aBasename = path.basename(a.docPath);
            const bBasename = path.basename(b.docPath);
            if (aBasename > bBasename) { return 1; }
            if (aBasename < bBasename) { return -1; }
            return 0;
        });
        // create a list of ids
        const idList = (Array.from(datas).map((data) => data.docId));
        // get request target
        let root = datas[0].baseUrl;
        // devel, edt... ou prod
        // TODO: il faudrait parser tout ceci des le debut dans data
        const match = root.match(/\/10\/([a-z0-9-]+)\/?$/);
        if (match != null) {
            siteName = match[1];
            root = root.replace(/\/[a-z0-9-]+\/?$/, "");
        } else {
            siteName = __guard__(root.match(/^https?:\/\/([a-z0-9-]+)\./), x => x[1]);
            if ((siteName == null)) { reject(new Error("Impossible de parser l'URL du site")); }
        }
        // request
        // TODO: il faudrait isoler cette partie du code peut-être
        console.log(`Tri des document dans l'ordre ${idList.join(",")}`);
        const postUrl = "share/ajax/dragndrop.php";
        const postConfig = {
            url: urljoin(root, postUrl),
            followAllRedirects: true,
            headers: datas[0].headers,
            form: {
                site: siteName,
                tabids: idList.join(",")
            }
        };

        const done = function(err, response, body) {
            if (err) { reject(err);
            } else if (response.statusCode !== 200) {
                reject(new Error("Erreur lors la mise en ordre des entités de la publication"));
            }
            // TODO: ici on renvoit encore datas, ce qui casse le modele de transmission des données. Il faudrait remettre ça à plat tranquillement
            return resolve(datas);
        };

        return request.post(postConfig, done);
    })
;

// FIXME: Ici on mélange un peu la ligne de commande avec l'API
const outputLog = datas =>
    new Promise(function(resolve, reject) {
        // Table header
        let data;
        const header = [
            {
                value : "Document",
                align : "left",
                width: 30
            },
            {
                value : "ID",
                width: 10
            },
            {
                value : "Stylage",
                width: 12,
                formatter(value) {
                    if (value.match(/^IMPORT RÉUSSI/i) != null) { return chalk.green("OK");
                    } else { return chalk.red("Erreur"); }
                }
            },
            {
                value : "PDF",
                width: 10,
                formatter(value) {
                    if (value === "off") { return chalk.grey("-");
                    } else if (value === "none") { return chalk.yellow("Aucun");
                    } else if (value === "loaded") { return chalk.green("Chargé");
                    } else { return chalk.red("Erreur"); }
                }
            },
        ];

        // Table rows
        const getRow = data =>
            ({
                "Document": path.basename(data.docPath), // TODO: il faudrait faire ça une fois pour toutes
                "ID": data.docId,
                "Stylage": data.status,
                "PDF": data.pdfState
            })
        ;
        const rows = ((() => {
            const result = [];
            for (data of Array.from(datas)) {                 result.push(getRow(data));
            }
            return result;
        })());

        // Create table
        const tableConfig = {
            borderStyle : 1,
            paddingBottom : 0,
            headerAlign : "center",
            align : "center",
            color : "white"
        };
        const tbl = Table(header, rows, tableConfig);

        // Log
        console.log(chalk.bgGreen("Terminé !"));
        console.log(`${datas.length} documents importés vers ${data.baseUrl}/${data.idParent}`);
        return console.log(tbl.render());
    })
;

module.exports = function(data) {
    if (!((data != null) && (data.headers != null) && (data.baseUrl != null) && (data.dirPath != null) && (data.idParent != null) && (data.idType != null))) { throw new Error("Missing arguments in upload-all"); }
    return getDocsList(data)
        .then(uploadFiles)
        .then(sortDocs)
        .then(outputLog);
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}