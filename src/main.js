/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const login = require("./login.js");

// Une fonction pour construire les méthodes de lodapi
const getMethod = function(moduleName) {
    const action = require(`./${moduleName}.js`);
    return function(data, callback) {
        // Timer
        if (callback == null) { callback = console.log; }
        let time = 0; // Init this var in the current scope
        const startTimer = function(data) {
            time = Date.now();
            return Promise.resolve(data);
        };
        const stopTimer = function(data) {
            data.time = Date.now() - time;
            return Promise.resolve(data);
        };
        // Callback
        const runCallback = function(data) {
            if (typeof callback === "function") { return callback(null, data); }
        };
        // Okay, let's go!
        return login(data)
            .then(startTimer)
            .then(action)
            .then(stopTimer)
            .then(runCallback)
            .catch(callback);
    };
};

// Liste des méthodes de lodapi à exposer
module.exports = {
    uploadDoc: getMethod("upload-doc"),
    uploadAll: getMethod("upload-all"),
    publication: getMethod("publication"),
    uploadPdf: getMethod("upload-pdf"),
    types: getMethod("types")
};
