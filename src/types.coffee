cheerio = require("cheerio")
request = require("request")
urljoin = require("url-join")

# data = { headers, baseUrl, idParent }
getAvailableTypes = (data) ->
    return new Promise (resolve, reject) ->
        postUrl = "/lodel/edition/index.php?id=#{ String(data.idParent) }"
        getConfig =
            url: urljoin(data.baseUrl, postUrl)
            followAllRedirects: true
            headers: data.headers

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200
                reject new Error("Erreur lors de la consultation des types")

            data.availableTypes = do (body) ->
                $ = cheerio.load(body)
                types = {}
                $("#addEntity select option").each () ->
                    value = $(@).attr("value")
                    if not value? then return
                    id = value.match(/\d+$/)?[0]
                    if not id? then return
                    name = $(@).text().trim()
                    console.log("#{name}: #{id}")
                    types[name] = id
                return types

            if not data.availableTypes?
                reject new Error("Erreur lors de la consultation des types")
            resolve(data)

        request.get(getConfig, done)

module.exports = (data) ->
    if not (data? and data.headers? and data.baseUrl? and data.idParent?) then throw new Error("Missing arguments in types")
    return getAvailableTypes(data)
