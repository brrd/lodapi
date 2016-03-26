cheerio = require("cheerio")
fs = require("fs")
path = require("path")
request = require("request")
uploadPdf = require("./upload-pdf.js")
urljoin = require("url-join")

# Upload a doc
# data = { headers, baseUrl, docPath, idParent, idType }
uploadFileForm = (data) ->
    return new Promise (resolve, reject) ->
        postUrl = "/lodel/edition/oochargement.php?idparent=#{ String(data.idParent) }&idtype=#{ String(data.idType) }"
        postConfig =
            url: urljoin(data.baseUrl, postUrl)
            followAllRedirects: true
            headers: data.headers
            formData:
                idparent: data.idParent
                idtype: data.idType
                fileorigin: "upload"
                mode: "strict"
                file1: fs.createReadStream(data.docPath)

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200
                reject new Error("Erreur lors du chargement du document '#{data.docPath}'")

            # Récupérer l'id de la tâche depuis le body renvoyé après l'upload
            getTaskId = (body) ->
                re = /window\.parent\.o\.changeStep\((\d+),\s+"(\d+)"\);/
                match = body?.match(re)
                # OTX error
                if not match? or match[1] isnt "3" or not match[2]?
                    return null
                else
                    taskId = match[2]
                    return taskId

            taskId = getTaskId(body)
            if not taskId?
                reject new Error("L'identifiant de la tâche n'a pas pu être récupéré")

            data.taskId = taskId
            resolve(data)

        request.post(postConfig, done)

# data = { headers, baseUrl, idParent, taskId }
getStatus = (data) ->
    return new Promise (resolve, reject) ->
        postUrl = "/lodel/edition/checkimport.php?idtask=#{ String(data.taskId) }&reload=0"
        getConfig =
            url: urljoin(data.baseUrl, postUrl)
            followAllRedirects: false
            headers: data.headers

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200
                reject new Error("Erreur lors de la récupération du log OTX (#{data.taskId})")

            data.status = do (body) ->
                $ = cheerio.load(body)
                status = $("#status").text()
                return status?.replace(/(\n|\s)+/g, " ")

            if not data.status?
                reject new Error("Impossible de récupérer le log OTX (#{data.taskId})")
            resolve(data)

        request.get(getConfig, done)

# data = { headers, baseUrl, docPath, idParent, idType, taskId }
validateTask = (data) ->
    return new Promise (resolve, reject) ->
        postUrl = "/lodel/edition/index.php?do=import&idtask=#{ String(data.taskId) }&finish=oui&visualiserdocument=oui&reload="
        postConfig =
            url: urljoin(data.baseUrl, postUrl)
            followAllRedirects: true
            headers: data.headers

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200
                reject new Error("Erreur lors de la validation de la tâche " + data.taskId)

            # Récupérer l'identifiant du document depuis l'URL de retour
            getDocId = (href) ->
                match = href.match(/\d+$/)
                id = if match? then match[0] else null
                return id

            id = getDocId(response.request.uri.href)
            if not id?
                reject new Error("Une erreur est survenue durant le chargement du document '#{ data.docPath } : impossible de récupérer son id'")
            data.docId = id
            resolve(data)

        request(postConfig, done) # TODO: preciser post, car c'est indiqué nulle part. A tester tranquillement

# PDF
# data.pdfPath
# TODO: message à logger
addPdf = (data) ->
    return new Promise (resolve, reject) ->
        if not data.pdfPath? then resolve(data)
        # Get PDF absolute path
        if path.isAbsolute(data.pdfPath)
            pdfAbsPath = data.pdfPath
        else
            dirPath = path.dirname(data.docPath)
            pdfAbsPath = path.join(dirPath, pdfAbsPath)
        # Check for pdf existence
        fs.stat pdfAbsPath, (err, stat) ->
            if err?
                pdfBasename = path.basename(pdfAbsPath)
                console.log("#{pdfBasename}: PDF introuvable")
                resolve(data) # On ne lance pas pour autant d'erreur ici
            data.id = data.docId # TODO: IL FAUT NORMALISER ÇA ENTRE LES METHODES POUR AVOIR UNE API CONSITENTE ET ÉVITER CE GENRE DE MANIP DEGUEU ET DANGEREUSE !
            uploadPdf(data).then(resolve, reject)

# TODO: Ceci devrait être l'objet d'une option qui correspond au niveau de log (none|normal|debug) + il faudrait préfixer chaque log avec le nom de l'opération et du fichier
logStatus = (data) ->
    # Stop spinner
    filename = path.basename(data.docPath)
    if data?.multispinner?.spinners?[filename] then data.multispinner.success(filename)
    # Log
    # FIXME: incompatible avec le spinner. Il faudrait plutot mettre ça dans un log affiché à la fin.
    # console.log("Le fichier #{data.docPath} a été chargé avec l'identifiant #{data.docId} et le message : '#{data.status}'")
    return Promise.resolve(data)

module.exports = (data) ->
    if not (data? and data.headers? and data.baseUrl? and data.docPath? and data.idParent? and data.idType?) then throw new Error("Missing arguments in upload-doc")
    return uploadFileForm(data)
        .then(getStatus)
        .then(validateTask)
        .then(addPdf)
        .then(logStatus)
        .catch (err)->
            console.error err
            filename = path.basename(data.docPath)
            if data?.multispinner?.spinners?[filename] then data.multispinner.error(filename)
