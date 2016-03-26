chalk = require("chalk")
fs = require("fs")
path = require("path")
Multispinner = require("multispinner")
path = require("path")
request = require("request")
Table = require("tty-table")
uploadDoc = require("./upload-doc.js")
urljoin = require("url-join")

# Get files list
getDocsList = (data) ->
    return new Promise (resolve, reject) ->
        fs.readdir data.dirPath, (err, items) ->
            if err then reject(err)
            docs = []
            # FIXME: ne pas traiter les fichiers temporaires de Word, qui commencent par ~$
            docs.push(filename) for filename in items when path.extname(filename) is ".doc"
            data.docs = docs
            resolve(data)

# Batch upload
uploadFiles = (data) ->
    getPdfPath = (dirPath, docName) ->
        pdfName = docName.replace(/\.doc$/i, ".pdf")
        if pdfName is docName then return null
        return pdfPath = path.join(data.dirPath, pdfName)

    mapFunc = (filename) ->
        config =
            headers: data.headers
            baseUrl: data.baseUrl
            idParent: data.idParent
            idType: data.idType
            docPath: path.join(data.dirPath, filename)
            multispinner: data.multispinner
        # data.pdf option
        if data.pdf is true then config.pdfPath = getPdfPath(data.dirPath, filename)
        return uploadDoc(config)

    data.multispinner = new Multispinner(data.docs, { clear: true, color: { incomplete: "white" } })
    promises = data.docs.map(mapFunc)
    return Promise.all(promises)

# sort docs after loading
# Comme les docs sont chargés en async, il faut les remettre dans l'ordre à la fin
# datas is an array of data returned by Promise.all
# TODO: ne pas trier quand un seul doc
sortDocs = (datas) ->
    return new Promise (resolve, reject) ->
        # sort datas depending on filename
        # FIXME: fait passer 10 devant 2. Trouver un module de sort file sur NPM (il y en a meme qui trient direct d'apres une cle d'objet)
        datas.sort (a, b) ->
            aBasename = path.basename(a.docPath)
            bBasename = path.basename(b.docPath)
            if (aBasename > bBasename) then return 1
            if (aBasename < bBasename) then return -1
            return 0
        # create a list of ids
        idList = (data.docId for data in datas)
        # get request target
        root = datas[0].baseUrl
        # devel, edt... ou prod
        # TODO: il faudrait parser tout ceci des le debut dans data
        match = root.match(/\/10\/([a-z0-9-]+)\/?$/)
        if match?
            siteName = match[1]
            root = root.replace(/\/[a-z0-9-]+\/?$/, "")
        else
            siteName = root.match(/^https?:\/\/([a-z0-9-]+)\./)?[1]
            if not siteName? then reject new Error("Impossible de parser l'URL du site")
        # request
        # TODO: il faudrait isoler cette partie du code peut-être
        console.log("Tri des document dans l'ordre #{idList.join(",")}")
        postUrl = "share/ajax/dragndrop.php"
        postConfig =
            url: urljoin(root, postUrl)
            followAllRedirects: true
            headers: datas[0].headers
            form:
                site: siteName
                tabids: idList.join(",")

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200
                reject new Error("Erreur lors la mise en ordre des entités de la publication")
            # TODO: ici on renvoit encore datas, ce qui casse le modele de transmission des données. Il faudrait remettre ça à plat tranquillement
            resolve(datas)

        request.post(postConfig, done)

# FIXME: Ici on mélange un peu la ligne de commande avec l'API
outputLog = (datas) ->
    return new Promise (resolve, reject) ->
        # Table header
        header = [
            {
                value : "Document"
                align : "left"
                width: 30
            },
            {
                value : "ID"
                width: 10
            },
            {
                value : "Stylage"
                width: 12
                formatter : (value) ->
                    if value.match(/^IMPORT RÉUSSI/i)? then return chalk.green("OK")
                    else return chalk.red("Erreur")
            },
            {
                value : "PDF"
                width: 10
                formatter : (value) ->
                    if value is "off" then return chalk.grey("-")
                    else if value is "none" then return chalk.yellow("Aucun")
                    else if value is "loaded" then return chalk.green("Chargé")
                    else return chalk.red("Erreur")
            },
        ]

        # Table rows
        getRow = (data) ->
            "Document": path.basename(data.docPath) # TODO: il faudrait faire ça une fois pour toutes
            "ID": data.docId
            "Stylage": data.status
            "PDF": data.pdfState
        rows = (getRow(data) for data in datas)

        # Create table
        tableConfig =
            borderStyle : 1
            paddingBottom : 0
            headerAlign : "center"
            align : "center"
            color : "white"
        tbl = Table(header, rows, tableConfig)

        # Log
        console.log(chalk.bgGreen("Terminé !"))
        console.log("#{datas.length} documents importés vers #{data.baseUrl}/#{data.idParent}")
        console.log(tbl.render())

module.exports = (data) ->
    if not (data? and data.headers? and data.baseUrl? and data.dirPath? and data.idParent? and data.idType?) then throw new Error("Missing arguments in upload-all")
    return getDocsList(data)
        .then(uploadFiles)
        .then(sortDocs)
        .then(outputLog)
