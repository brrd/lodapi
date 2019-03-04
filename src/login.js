/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const prompt = require("prompt");
const request = require("request");
const url = require("url");
const urljoin = require("url-join");

// Ask for credentials
// data : {baseUrl}
const askCredentials = data =>
    new Promise(function(resolve, reject) {
        const questions = [{
            name: "login",
            message: "Login:",
            required: true
        }, {
            name: "password",
            message: "Mot de passe:",
            hidden: true
        }];

        const cb = function(err, result) {
            if (err) { reject(err); }
            Object.assign(data, result);
            return resolve(data);
        };

        prompt.message = (prompt.delimiter = "");
        console.log("Identification (Lodel)");
        return prompt.get(questions, cb);
    })
;

// Login
// data = {baseUrl, login, password}
const loginForm = data =>
    new Promise(function(resolve, reject) {
        const postUrl = "/lodel/edition/login.php";
        const postConfig = {
            url: urljoin(data.baseUrl, postUrl),
            forever: true,
            followAllRedirects: true,
            auth: {
                user: "lodel",
                pass: "lodel",
                sendImmediately: false
            },
            form: {
                login: data.login,
                passwd: data.password,
                url_retour: url.parse(data.baseUrl).pathname
            },
            jar: true
        };

        const done = function(err, response, body) {
            if (err) { return reject(err);
            } else if (response.statusCode !== 200) { return reject(new Error("Erreur lors de l'identification"));
            } else {
                data.headers = response.request.headers;
                return resolve(data);
            }
        };

        return request.post(postConfig, done);
    })
;

// Main
// Minimum data is data = { baseUrl }
// mais il y a surement besoin de plus selon la fonction appelée ensuite
module.exports = function(data) {
    if (!((data != null) && (data.baseUrl != null))) { throw new Error("Missing arguments in login"); }
    return askCredentials(data)
        .then(loginForm);
};
