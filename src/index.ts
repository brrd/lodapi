import * as cheerio from "cheerio";
import { createReadStream, stat } from "fs";
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

interface PublicationOptions {
  idParent: number, 
  idType: number, 
  title?: string
}

interface EntityType {
  name: string,
  id: number
}

interface Doc {
  filepath: string,
  idParent: number,
  idType: number
}

interface OtxTask {
  taskId: number,
  status?: string | undefined,
  docId?: number
}

const htpasswd = {
  user: "lodel",
  pass: "lodel",
  sendImmediately: false
};

const undefinedHeadersReject = () => Promise.reject("Session headers is undefined. Please make sure auth() was called first.");

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

  createPublication({ idParent, idType, title = "New publication" }: PublicationOptions) {
    if (this.headers == null) return undefinedHeadersReject();
    
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
        "data[titre]": title,
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

  getAvailableTypes(idParent: number) {
    if (this.headers == null) return undefinedHeadersReject();

    const postUrl = `/lodel/edition/index.php?id=${String(idParent)}`;
    const getConfig = {
      url: urljoin(this.baseUrl, postUrl),
      followAllRedirects: true,
      headers: this.headers
    };

    return new Promise(function (resolve, reject) {
      const done = (err: Error, response: request.Response, body: any) => {
        if (!err && response.statusCode !== 200) {
          err = new Error(`Error while getting types: unexpected status code ${response.statusCode}`);
        }
        if (err) return reject(err);

        const availableTypes = ((body) => {
          const $ = cheerio.load(body);
          const types: EntityType[] = [];
          $("#addEntity select option").each(function (this: Cheerio) {
            const value = $(this).attr("value");
            if (value == null) return;
            const id = (value.match(/\d+$/) || [])[0];
            if (id == null) return;
            const name = $(this).text().trim();
            return types.push({name, id: Number(id)});
          });
          return types;
        })(body);

        if (availableTypes == null) {
          reject(new Error("Could not get types"));
        }
        return resolve(availableTypes);
      };
      return request.get(getConfig, done);
    })
  }

  uploadDoc({ filepath, idParent, idType }: Doc) {
    if (this.headers == null) return undefinedHeadersReject();

    // 1. Submit upload form and get OTX task id
    const submitUpload = () => {
      const postUrl = `/lodel/edition/oochargement.php?idparent=${String(idParent)}&idtype=${String(idType)}`;
      const postConfig = {
        url: urljoin(this.baseUrl, postUrl),
        followAllRedirects: true,
        headers: this.headers,
        formData: {
          idparent: idParent,
          idtype: idType,
          fileorigin: "upload",
          mode: "strict",
          file1: createReadStream(filepath)
        }
      };

      return new Promise<OtxTask>(function (resolve, reject) {
        const done = (err: Error, response: request.Response, body: any) => {
          if (!err && response.statusCode !== 200) {
            err = new Error(`Error while uploading doc: unexpected status code ${response.statusCode}`);
          }
          if (err) return reject(err);

          // Get OTX task id after upload
          const getTaskId = (body: any) => {
            if (typeof body !== "string") return null;
            const re = /window\.parent\.o\.changeStep\((\d+),\s+"(\d+)"\);/;
            const match = body.match(re);
            // OTX error
            if ((match == null) || (match[1] !== "3") || (match[2] == null)) {
              return null;
            }
            return Number(match[2]);
          };

          const taskId = getTaskId(body);
          if (taskId == null) {
            return reject(new Error("Could not get taskId."));
          }
          resolve({ taskId });
        };
        return request.post(postConfig, done);
      });
    }

    // 2. Get OTX task status
    const getStatus = ({ taskId }: OtxTask) => {
      const postUrl = `/lodel/edition/checkimport.php?idtask=${String(taskId)}&reload=0`;
      const getConfig = {
        url: urljoin(this.baseUrl, postUrl),
        followAllRedirects: false,
        headers: this.headers
      };

      return new Promise<OtxTask>(function (resolve, reject) {
        const done = (err: Error, response: request.Response, body: any) => {
          if (!err && response.statusCode !== 200) {
            err = new Error(`Could not get OTX log for task ${String(taskId)}: unexpected status code ${response.statusCode}`);
          }
          if (err) return reject(err);

          const status = ((body) => {
            const $ = cheerio.load(body);
            const status = $("#status").text();
            if (!status) return null;
            return status.replace(/(\n|\s)+/g, " ");
          })(body);

          if (status == null) {
            return reject(new Error(`Could not get OTX log for task ${String(taskId)}: status is null`));
          }
          return resolve({ taskId, status });
        };
        return request.get(getConfig, done);
      });
    }

    // 3. Validate OTX task
    const validateTask = ({ taskId, status }: OtxTask) => {
      const postUrl = `/lodel/edition/index.php?do=import&idtask=${String(taskId)}&finish=oui&visualiserdocument=oui&reload=`;
      const postConfig = {
        url: urljoin(this.baseUrl, postUrl),
        followAllRedirects: true,
        headers: this.headers
      };
      
      return new Promise<OtxTask>(function (resolve, reject) {
        const done = (err: Error, response: request.Response, body: any) => {
          if (!err && response.statusCode !== 200) {
            err = new Error(`Could not validate task ${String(taskId)}: unexpected status code ${response.statusCode}`);
          }
          if (err) return reject(err);

          const getDocId = (href: string) => {
            const match = href.match(/\d+$/);
            if (match == null) return null;
            return Number(match[0]);
          };

          const href = response.request.uri.href;
          const docId = getDocId(href);
          if (docId == null) {
            return reject(new Error(`Error while uploading '${filepath}': could not get id after upload`));
          }
          return resolve({ taskId, status, docId });
        };
        return request.post(postConfig, done);
      })
    }

    // Main
    return submitUpload()
      .then(getStatus)
      .then(validateTask);
  }

  uploadPdf()
}

module.exports = LodelSession;
