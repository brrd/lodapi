# TODO: pourquoi pas un outil en cli interactif avec https://github.com/dthree/vorpal

isUrl = require("is-url")
lodapi = require("./main.js")
pkg = require("../package.json")
prettyMs = require("pretty-ms")
program = require("commander")

program.version("v" + pkg.version)
    .description(pkg.description)

# Common functions
kill = (msg) ->
    console.error("Erreur dans la commande: " + msg)
    process.exit(1)

callback = (err, data) ->
    if err then console.error(err)
    else console.log("Terminé en #{prettyMs(data.time)}")

splitUrl = (url) ->
    i = url.lastIndexOf("/")
    split = [url.slice(0,i), url.slice(i+1)]
    if not split[1]? or not split[1].match(/^\d+$/)? then kill("l'url ne comporte pas d'identifiant numérique")
    return split

# Commands
program.command("upload <filepath> <publication>")
    .description("charger un document dans une publication")
    .option("-T, --type-id <type>", "l'identifiant du type numérique du document")
    .option("-p, --pdf-path <path>", "chemin vers le PDF fac-similé associé")
    .action (filePath, publication, options) ->
        if not isUrl(publication) then kill("l'argument publication doit être une url valide")
        if not options.typeId? then kill("l'argument --type-id est obligatoire")
        # TODO: vérifier que le doc existe
        [baseUrl, id] = splitUrl(publication)
        config =
            baseUrl: baseUrl
            docPath: filePath
            idParent: id
            idType: options.typeId
            pdfPath: options.pdfPath
        console.log("Chargement du doc '#{filePath}' vers '#{publication}'")
        lodapi.uploadDoc(config, callback)

program.command("upload-all <dirpath> <publication>")
    .description("charger tous les documents d'un dossier dans une publication")
    .option("-T, --type-id <type>", "l'identifiant du type numérique des documents à charger")
    .option("-P, --pdf", "associer également les pdf dont le nom correspond à celui des documents")
    .action (dirPath, publication, options) ->
        if not isUrl(publication) then kill("l'argument publication doit être une url valide")
        if not options.typeId? then kill("l'argument --type-id est obligatoire")
        # TODO: vérifier que le dir existe
        [baseUrl, id] = splitUrl(publication)
        config =
            baseUrl: baseUrl
            dirPath: dirPath
            idParent: id
            idType: options.typeId
            pdf: options.pdf
        console.log("Chargement des docs du dossier '#{dirPath}' vers '#{publication}'")
        lodapi.uploadAll(config, callback)

program.command("upload-pdf <filepath> <url>")
    .description("lier un pdf à un document")
    .action (filePath, url, options) ->
        if not isUrl(url) then kill("l'argument url doit être une url valide")
        # TODO: vérifier que le pdf existe
        [baseUrl, id] = splitUrl(url)
        config =
            baseUrl: baseUrl
            pdfPath: filePath
            id: id
        console.log("Chargement du pdf '#{filePath}' vers '#{url}'")
        lodapi.uploadPdf(config, callback)

program.command("publication <parent>")
    .description("créer une nouvelle publication dans une publication parente")
    .option("-n, --name <titre>", "le titre de la nouvelle publication")
    .option("-T, --type-id <type>", "l'identifiant du type numérique de la nouvelle publication")
    .action (parent, options) ->
        if not isUrl(parent) then kill("l'argument parent doit être une url valide")
        if not options.typeId? then kill("l'argument --type-id est obligatoire")
        [baseUrl, id] = splitUrl(parent)
        config =
            baseUrl: baseUrl
            idParent: id
            idType: options.typeId
            title: options.name
        console.log("Création de la publication")
        lodapi.publication(config, callback)

program.command("types <parent>")
    .description("retourne les types disponibles pour l'entité spécifiée")
    .action (parent) ->
        [baseUrl, id] = splitUrl(parent)
        config =
            baseUrl: baseUrl
            idParent: id
        lodapi.types(config, callback)

program.parse(process.argv)

if program.args.length is 0 then program.help()
