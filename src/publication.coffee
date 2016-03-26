request = require("request")
urljoin = require("url-join")

createPublication = (data) ->
    return new Promise (resolve, reject) ->
        postUrl = "/lodel/edition/index.php"
        postConfig =
            url: urljoin(data.baseUrl, postUrl)
            followAllRedirects: false
            headers: data.headers
            form:
                do: "edit"
                id: 0
                timestamp: Date.now()
                idparent: data.idParent
                idtype: data.idType
                creationmethod: "form"
                edit: 1
                "data[titre]": data.title ? "Nouvelle publication"
                "data[datepubli]": "today"
                creationinfo: "xhtml"
                visualiserdocument: true

        done = (err, response, body) ->
            if err then reject(err)
            # On évite les redirections (cas des sous-paties redirigées vers le parent). On attend donc une 302
            # TODO: peut etre generalisable aux documents (plus simple ?)
            else if response.statusCode isnt 302
                reject new Error("Erreur lors de la création de la publication '#{data.title}'")

            # Récupérer l'identifiant de la publication depuis la réponse
            getPubliId = (response) ->
                match = response.headers.location.match(/\d+$/)
                if match? then return match[0] else return null

            publiId = getPubliId (response)
            if not publiId?
                reject new Error("Impossible de récupérer l'id de la publication '#{data.title}'")
            data.publiId = publiId
            resolve(data)

        request.post(postConfig, done)

# data.title = optionnel
module.exports = (data) ->
    if not (data? and data.headers? and data.baseUrl? and data.idParent? and data.idType?) then throw new Error("Missing arguments in publication")
    return createPublication(data)
