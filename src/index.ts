import { IncomingMessage, IncomingHttpHeaders } from "http";
import * as request from "request";
import { parse } from "url";
import urljoin = require("url-join");

interface LodelSessionOptions {
	baseUrl: string
}

interface Credentials { 
	login: string, 
	password: string 
}

interface Entity {
	idParent: number | undefined, 
	idType: number | undefined, 
	title: string | undefined
}

const htpasswd = {
	user: "lodel",
	pass: "lodel",
	sendImmediately: false
};

class LodelSession {
	baseUrl: string;
	headers: IncomingHttpHeaders | undefined;

	constructor({baseUrl}: LodelSessionOptions) {
		this.baseUrl = baseUrl;
	}

	auth({login, password}: Credentials) {
		const baseUrl = this.baseUrl;
		const postUrl = "/lodel/edition/login.php";
		const postConfig = {
			url: urljoin(baseUrl, postUrl),
			forever: true,
			followAllRedirects: true,
			auth: htpasswd,
			form: {
				login: login,
				passwd: password,
				url_retour: parse(baseUrl).pathname
			},
			jar: true
		};

		return new Promise((resolve, reject) => {
      const done = (err: Error, response: request.Response, body: any) => {
				if (err) return reject(err);
				if (response.statusCode !== 200) return reject(new Error("Error during authentication"));
				this.headers = response.request.headers;
				return resolve();
			}
			return request.post(postConfig, done);
		});
	}

	createPublication({ idParent, idType, title }: Entity) {
		const postUrl = "/lodel/edition/index.php";
		const postConfig = {
			url: urljoin(this.baseUrl, postUrl),
			followAllRedirects: false,
			headers: this.headers,
			form: {
				do: "edit",
				id: 0,
				timestamp: Date.now(),
				idparent: idParent,
				idtype: idType,
				creationmethod: "form",
				edit: 1,
				"data[titre]": title ? title : "New publication",
				"data[datepubli]": "today",
				creationinfo: "xhtml",
				visualiserdocument: true
			}
		};

		return new Promise(function (resolve, reject) {
			const done = (err: Error, response: request.Response, body: any) => {
				// Avoid redirections
				if (!err && response.statusCode !== 302) {
					err = new Error(`Error while creating publication '${title}': unexpected status code ${response.statusCode}`);
				}
				if (err) return reject(err);
				
				const getPubliId = (response: IncomingMessage) => {
					const location = response && response.headers && response.headers.location;
					if (location == null) return null;
					const match = location.match(/\d+$/);
					return match ? match[0] : null;
				};

				const publiId = getPubliId((response));
				if ((publiId == null)) {
					return reject(new Error(`Can't get id of publication '${title}'`));
				}
				resolve(publiId);
			};
			return request.post(postConfig, done);
		});
	}
}

module.exports = LodelSession;
