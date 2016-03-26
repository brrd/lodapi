cheerio = require("cheerio")
fs = require("fs")
request = require("request")
urljoin = require("url-join")

# Merci Lodel pour ces formidables formulaires qu'on doit intégralement recompléter pour charger un simple pdf !
# data = { headers, baseUrl, id }
getFormValues = (data) ->
    return new Promise (resolve, reject) ->
        getConfig =
            url: urljoin(data.baseUrl, "/lodel/edition/index.php?do=view&id=#{data.id}")
            followAllRedirects: true
            headers: data.headers

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200
                reject new Error("Erreur lors du chargement du pdf '#{data.pdfPath}'")

            # Récupérer les valeurs du formulaire d'édition
            getForm = (body) ->
                $ = cheerio.load(body)
                form = {}
                $("[name]").each () ->
                    type = $(@).attr("type")
                    if type in ["button", "submit"] then return
                    name = $(@).attr("name")
                    value = $(@).val()
                    if not value? and type is "checkbox" then value = $(@).attr("checked")
                    if not value? then return

                    # Parce que Lodel aime bien faire compliqué (<select> des index)
                    if name.match(/^pool_candidats_/)?
                        $prev = $(@).prev("input")
                        if not $prev?
                            console.error("Attention : impossible de récupérer la valeur #{name}. Des index peuvent avoir disparu dans le document #{data.id}")
                            return
                        prevName = $prev.attr("name")
                        value = if Array.isArray(value) then value.join(",") else value
                        form[prevName] = value
                    else
                        form[name] = value

                return form

            data.form = getForm(body)
            if not data.form?
                reject new Error("Impossible de récupérer les informations du formulaire '#{data.id}'")
            resolve(data)

        request.get(getConfig, done)

# Upload a doc
# data = { headers, baseUrl, pdfPath, id, form }
uploadFileForm = (data) ->
    return new Promise (resolve, reject) ->
        postUrl = "/lodel/edition/index.php?do=view&id=#{ String(data.id) }"
        # Réinjecter les données récupérées précédement dans le formulaire
        formData = Object.assign({}, data.form)
        formData.do = "edit"
        formData.id = data.id
        formData["data[alterfichier][radio]"] = "upload"
        formData["data[alterfichier][upload]"] = fs.createReadStream(data.pdfPath)
        postConfig =
            url: urljoin(data.baseUrl, postUrl)
            followAllRedirects: true
            headers: data.headers
            formData: formData

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200
                reject new Error("Erreur lors du chargement du pdf '#{data.pdfPath}'")
            console.log("PDF chargé: #{data.pdfPath}")
            resolve(data)

        request.post(postConfig, done)

module.exports = (data) ->
    if not (data? and data.headers? and data.baseUrl? and data.pdfPath? and data.id?) then throw new Error("Missing arguments in upload-pdf")
    return getFormValues(data)
        .then(uploadFileForm)
