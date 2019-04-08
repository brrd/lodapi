import * as cheerio from "cheerio";
import { createReadStream, stat } from "fs";
import { IncomingMessage, IncomingHttpHeaders } from "http";
import * as request from "request";
import { parse } from "url";
import urljoin = require("url-join");

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

interface Pdf {
  filepath: string,
  docId: number
}

interface OtxTask {
  taskId: number,
  status?: string | undefined,
  docId?: number
}

interface FormValues { 
  [key: string]: string 
}

interface Entry {
  id: number,
  idType: number;
  relatedEntities: number[]
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

  constructor(baseUrl: string) {
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

  // WARNING: this feature is experimental and can potentially cause data loss
  uploadPdf({ filepath, docId }: Pdf) {
    if (this.headers == null) return undefinedHeadersReject();

    // We need to submit again the entire form with its correct values in order to upload the pdf :-(
    const getFormValues = () => {
      const postUrl = `/lodel/edition/index.php?do=view&id=${String(docId)}`;
      const getConfig = {
        url: urljoin(this.baseUrl, postUrl),
        followAllRedirects: true,
        headers: this.headers
      };

      return new Promise<FormValues>((resolve, reject) => {
        const done = (err: Error, response: request.Response, body: any) => {
          if (!err && response.statusCode !== 200) {
            err = new Error(`Erreur while get form values before uploading pdf '${filepath}': unexpected status code ${response.statusCode}`);
          }
          if (err) return reject(err);

          // Get form values
          const $ = cheerio.load(body);
          const form: FormValues = {};

          $("[name]").each(function (this: Cheerio) {
            const type = $(this).attr("type");
            if (["button", "submit"].includes(type)) return;
            const name = $(this).attr("name");
            let value = $(this).val();
            if (value == null && type === "checkbox") {
              value = $(this).attr("checked");
            }
            if (value == null) return;

            // Handle Lodel <select> specific controls for indexes selection
            if (name.match(/^pool_candidats_/) != null) {
              const $prev = $(this).prev("input");
              if ($prev.length === 0) {
                return new Error(`Can't get ${name} value`);
              }
              const prevName = $prev.attr("name");
              value = Array.isArray(value) ? value.join(",") : value;
              form[prevName] = value;
            } else {
              form[name] = value;
            }
          });

          if (Object.keys(form).length === 0) {
            return reject(new Error(`Could not get values from form '${String(docId)}'`));
          }
          return resolve(form);
        };
        return request.get(getConfig, done);
      });
    };

    const submitForm = (form: FormValues) => {
      const postUrl = `/lodel/edition/index.php?do=view&id=${String(docId)}`;
      // Reinject data in form
      const formData = Object.assign({}, form, {
        do: "edit",
        id: docId,
        "data[alterfichier][radio]": "upload",
        "data[alterfichier][upload]": createReadStream(filepath)
      });
      const postConfig = {
        url: urljoin(this.baseUrl, postUrl),
        followAllRedirects: true,
        headers: this.headers,
        formData
      };

      return new Promise(function (resolve, reject) {
        const done = (err: Error, response: request.Response, body: any) => {
          if (!err && response.statusCode !== 200) {
            err = new Error(`Erreur while uploading pdf '${filepath}': unexpected status code ${response.statusCode}`);
          }
          if (err) return reject(err);
          resolve(response);
        };
        return request.post(postConfig, done);
      });
    };

    // Main
    return getFormValues()
      .then(submitForm);
  }

  getEntry (id: number) {
    if (this.headers == null) return undefinedHeadersReject();

    const postUrl = `/lodel/admin/index.php?do=view&id=${String(id)}&lo=entries`;
    const getConfig = {
      url: urljoin(this.baseUrl, postUrl),
      followAllRedirects: true,
      headers: this.headers
    };

    return new Promise<Entry>(function (resolve, reject) {
      const done = (err: Error, response: request.Response, body: any) => {
        if (!err && response.statusCode !== 200) {
          err = new Error(`Error while getting entry: unexpected status code ${response.statusCode}`);
        }
        if (err) return reject(err);

        const $ = cheerio.load(body);
        const idTypeStr = $("input[name='idtype']").eq(0).attr("value");
        const idType = Number(idTypeStr);
        if (!idType) {
          return reject(new Error(`Error: idType not found on entry ${id}`));
        }

        const relatedEntities: number[] = [];
        let errorFound = false;
        $(".listEntities li").each(function (this: Cheerio) {
          const href = $(this).find(".action .move + .item a").eq(0).attr("href");
          const match = (href.match(/\d+$/) || [])[0];
          if (match.length > 0) {
            const id = Number(match);
            relatedEntities.push(id);
          } else {
            errorFound = true;
            return false;
          }
        });
        if (errorFound) {
          return reject(new Error(`Error: missing related entity id in entry ${id}`));
        }
        resolve({ id, idType, relatedEntities });
      };
      return request.get(getConfig, done);
    });
  }

  associateEntries(idEntities: number[], idEntries: number[], idType?: number) {
    if (this.headers == null) return undefinedHeadersReject();

    // Create entries query string
    const getEntriesQuery = new Promise<string>((resolve, reject) => {
      if (idType) {
        const entriesQuery = idEntries.reduce((query: string, idEntry: number, i: number) => `${query}&identries[${i}]=${idEntry}_${idType}`, "");
        return resolve(entriesQuery);
      }
      
      // Get idTypes for each entry if a global idType was not defined
      const getEntriesPromises = idEntries.map((id) => this.getEntry(id));
      return Promise.all(getEntriesPromises)
        .then((entries) => {
          const entriesQuery = entries.reduce((query: string, entry: Entry, i: number) => {
            const { id, idType } = entry;
            return `${query}&identries[${i}]=${id}_${idType}`;
          }, "");
          resolve(entriesQuery);
        })
        .catch(reject);
    });

    // Post request
    return getEntriesQuery.then((entriesQuery) => {
      // Create entities query string
      const entitiesQuery = idEntities.reduce((query: string, idEntity: number, i: number) => `${query}&identities[${i}]=${idEntity}`, "");

      // Post config
      const postUrl = `/lodel/admin/index.php?do=massassoc&lo=entries&edit=1&associate=1${entitiesQuery}${entriesQuery}`;
      const getConfig = {
        url: urljoin(this.baseUrl, postUrl),
        followAllRedirects: true,
        headers: this.headers
      };

      return new Promise(function (resolve, reject) {
        const done = (err: Error, response: request.Response, body: any) => {
          if (!err && response.statusCode !== 200) {
            err = new Error(`Error while connecting entries: unexpected status code ${response.statusCode}`);
          }
          if (err) return reject(err);
          resolve();
        };
        return request.get(getConfig, done);
      });
    });
  }
}

module.exports = LodelSession;
