prompt = require("prompt")
request = require("request")
url = require("url")
urljoin = require("url-join")

# Ask for credentials
# data : {baseUrl}
askCredentials = (data) ->
    return new Promise (resolve, reject) ->
        questions = [{
            name: "login"
            message: "Login:"
            required: true
        }, {
            name: "password"
            message: "Mot de passe:"
            hidden: true
        }]

        cb = (err, result) ->
            if err then reject(err)
            Object.assign(data, result)
            resolve(data)

        prompt.message = prompt.delimiter = ""
        console.log("Identification (Lodel)")
        prompt.get(questions, cb)

# Login
# data = {baseUrl, login, password}
loginForm = (data) ->
    return new Promise (resolve, reject) ->
        postUrl = "/lodel/edition/login.php"
        postConfig =
            url: urljoin(data.baseUrl, postUrl)
            forever: true
            followAllRedirects: true
            auth:
                user: "lodel"
                pass: "lodel"
                sendImmediately: false
            form:
                login: data.login
                passwd: data.password
                url_retour: url.parse(data.baseUrl).pathname
            jar: true

        done = (err, response, body) ->
            if err then reject(err)
            else if response.statusCode isnt 200 then reject new Error("Erreur lors de l'identification")
            else
                data.headers = response.request.headers
                resolve(data)

        request.post(postConfig, done)

# Main
# Minimum data is data = { baseUrl }
# mais il y a surement besoin de plus selon la fonction appelée ensuite
module.exports = (data) ->
    if not (data? and data.baseUrl?) then throw new Error("Missing arguments in login")
    return askCredentials(data)
        .then(loginForm)
