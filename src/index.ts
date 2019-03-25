import { IncomingMessage } from "http";
import *  as request from "request";
import { parse } from "url";
import urljoin = require("url-join");

interface SessionOptions {
	baseUrl: string
}

interface Credentials { 
	login: string, 
	password: string 
}

class LodelSession {
	baseUrl: string;

	constructor({baseUrl}: SessionOptions) {
		this.baseUrl = baseUrl;
	}

	auth({login, password}: Credentials) {
		const baseUrl = this.baseUrl;
		const postUrl = "/lodel/edition/login.php";

		const postConfig = {
			url: urljoin(baseUrl, postUrl),
			forever: true,
			followAllRedirects: true,
			auth: {
				user: "lodel",
				pass: "lodel",
				sendImmediately: false
			},
			form: {
				login: login,
				passwd: password,
				url_retour: parse(baseUrl).pathname
			},
			jar: true
		};

		return new Promise((resolve, reject) => {
      const done = (err: Error, response: IncomingMessage, body: any) => {
				if (err) return reject(err);
				if (response.statusCode !== 200) return reject(new Error("Error during authentication"));
				const headers = response.headers;
				return resolve(headers);
			}
			return request.post(postConfig, done);
		});
	}
}

module.exports = LodelSession;
