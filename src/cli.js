/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// TODO: pourquoi pas un outil en cli interactif avec https://github.com/dthree/vorpal

const isUrl = require("is-url");
const lodapi = require("./main.js");
const pkg = require("../package.json");
const prettyMs = require("pretty-ms");
const program = require("commander");

program.version(`v${pkg.version}`)
    .description(pkg.description);

// Common functions
const kill = function(msg) {
    console.error(`Erreur dans la commande: ${msg}`);
    return process.exit(1);
};

const callback = function(err, data) {
    if (err) { return console.error(err);
    } else { return console.log(`Terminé en ${prettyMs(data.time)}`); }
};

const splitUrl = function(url) {
    const i = url.lastIndexOf("/");
    const split = [url.slice(0,i), url.slice(i+1)];
    if ((split[1] == null) || (split[1].match(/^\d+$/) == null)) { kill("l'url ne comporte pas d'identifiant numérique"); }
    return split;
};

// Commands
program.command("upload <filepath> <publication>")
    .description("charger un document dans une publication")
    .option("-T, --type-id <type>", "l'identifiant du type numérique du document")
    .option("-p, --pdf-path <path>", "chemin vers le PDF fac-similé associé")
    .action(function(filePath, publication, options) {
        if (!isUrl(publication)) { kill("l'argument publication doit être une url valide"); }
        if ((options.typeId == null)) { kill("l'argument --type-id est obligatoire"); }
        // TODO: vérifier que le doc existe
        const [baseUrl, id] = Array.from(splitUrl(publication));
        const config = {
            baseUrl,
            docPath: filePath,
            idParent: id,
            idType: options.typeId,
            pdfPath: options.pdfPath
        };
        console.log(`Chargement du doc '${filePath}' vers '${publication}'`);
        return lodapi.uploadDoc(config, callback);
});

program.command("upload-all <dirpath> <publication>")
    .description("charger tous les documents d'un dossier dans une publication")
    .option("-T, --type-id <type>", "l'identifiant du type numérique des documents à charger")
    .option("-P, --pdf", "associer également les pdf dont le nom correspond à celui des documents")
    .action(function(dirPath, publication, options) {
        if (!isUrl(publication)) { kill("l'argument publication doit être une url valide"); }
        if ((options.typeId == null)) { kill("l'argument --type-id est obligatoire"); }
        // TODO: vérifier que le dir existe
        const [baseUrl, id] = Array.from(splitUrl(publication));
        const config = {
            baseUrl,
            dirPath,
            idParent: id,
            idType: options.typeId,
            pdf: options.pdf
        };
        console.log(`Chargement des docs du dossier '${dirPath}' vers '${publication}'`);
        return lodapi.uploadAll(config, callback);
});

program.command("upload-pdf <filepath> <url>")
    .description("lier un pdf à un document")
    .action(function(filePath, url, options) {
        if (!isUrl(url)) { kill("l'argument url doit être une url valide"); }
        // TODO: vérifier que le pdf existe
        const [baseUrl, id] = Array.from(splitUrl(url));
        const config = {
            baseUrl,
            pdfPath: filePath,
            id
        };
        console.log(`Chargement du pdf '${filePath}' vers '${url}'`);
        return lodapi.uploadPdf(config, callback);
});

program.command("publication <parent>")
    .description("créer une nouvelle publication dans une publication parente")
    .option("-n, --name <titre>", "le titre de la nouvelle publication")
    .option("-T, --type-id <type>", "l'identifiant du type numérique de la nouvelle publication")
    .action(function(parent, options) {
        if (!isUrl(parent)) { kill("l'argument parent doit être une url valide"); }
        if ((options.typeId == null)) { kill("l'argument --type-id est obligatoire"); }
        const [baseUrl, id] = Array.from(splitUrl(parent));
        const config = {
            baseUrl,
            idParent: id,
            idType: options.typeId,
            title: options.name
        };
        console.log("Création de la publication");
        return lodapi.publication(config, callback);
});

program.command("types <parent>")
    .description("retourne les types disponibles pour l'entité spécifiée")
    .action(function(parent) {
        const [baseUrl, id] = Array.from(splitUrl(parent));
        const config = {
            baseUrl,
            idParent: id
        };
        return lodapi.types(config, callback);
});

program.parse(process.argv);

if (program.args.length === 0) { program.help(); }
