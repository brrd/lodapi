login = require("./login.js")

# Une fonction pour construire les méthodes de lodapi
getMethod = (moduleName) ->
    action = require("./#{moduleName}.js")
    return (data, callback = console.log) ->
        # Timer
        time = 0 # Init this var in the current scope
        startTimer = (data) ->
            time = Date.now()
            return Promise.resolve(data)
        stopTimer = (data) ->
            data.time = Date.now() - time
            return Promise.resolve(data)
        # Callback
        runCallback = (data) ->
            if typeof callback is "function" then callback(null, data)
        # Okay, let's go!
        login(data)
            .then(startTimer)
            .then(action)
            .then(stopTimer)
            .then(runCallback)
            .catch(callback)

# Liste des méthodes de lodapi à exposer
module.exports =
    uploadDoc: getMethod("upload-doc")
    uploadAll: getMethod("upload-all")
    publication: getMethod("publication")
    uploadPdf: getMethod("upload-pdf")
    types: getMethod("types")
