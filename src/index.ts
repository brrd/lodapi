import * as cheerio from "cheerio";
import { createReadStream } from "fs";
import { IncomingMessage, IncomingHttpHeaders } from "http";
import * as request from "request";
import { parse } from "url";
import urljoin = require("url-join");
import { parseForm } from "./utils";
import  { createLogger, format, transports } from "winston";
const { combine, timestamp, printf } = format;

interface RequestOptions {
  description: string,
  exec: string,
  method: "post" | "get",
  config?: {},
  expectedStatusCode?: number,
  isAuth?: boolean
}

interface RequestResult {
  response: request.Response, 
  body: any
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

interface Pdf {
  filepath: string,
  docId: number
}

interface OtxTask {
  taskId: number,
  status?: string | undefined,
  docId?: number
}

interface Entry {
  id: number,
  idType: number;
  relatedEntities?: number[],
  data?: { [key: string]: string }
}

const htpasswd = {
  user: "lodel",
  pass: "lodel",
  sendImmediately: false
};

// Init Logger
const myFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

const logger = createLogger({
  level: 'error',
  format: combine(
    timestamp(),
    myFormat
  ),
  transports: [
    new transports.File({ filename: 'lodapi-error.log' }),
  ]
});

// If we're not in production then **ALSO** log to the `console`
// with the colorized simple format.
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

class LodelSession {
  baseUrl: string;
  headers: IncomingHttpHeaders | undefined;
  logger = logger;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  auth({ login, password }: Credentials) {
    const r = this.request({
      description: "auth",
      exec: "/lodel/edition/login.php",
      method: "post",
      isAuth: true,
      config: {
        forever: true,
        followAllRedirects: true,
        auth: htpasswd,
        form: {
          login: login,
          passwd: password,
          url_retour: parse(this.baseUrl).pathname
        },
        jar: true
      },
    });

    return r.then(({ response, body }: RequestResult) => {
      this.headers = response.request.headers;
      return response;
    });
  }

  request({ description, exec, method, config = {}, expectedStatusCode = 200, isAuth = false }: RequestOptions) {
    if (!isAuth && this.headers == null) return Promise.reject(`[request: ${description}] Session headers is undefined. Please make sure auth() was called first.`);

    const requestConfig = Object.assign({}, {
      url: urljoin(this.baseUrl, exec),
      followAllRedirects: true,
      headers: this.headers
    }, config);

    return new Promise<RequestResult>(function (resolve, reject) {
      const callback = (err: Error, response: request.Response, body: any) => {
        if (!err && response.statusCode !== expectedStatusCode) {
          err = new Error(`[request: ${description}] Unexpected status code: ${response.statusCode}`);
        }
        if (err) return reject(err);
        resolve({ response, body });
      };
      request[method](requestConfig, callback);
    });
  }

  getAvailableTypes(idParent: number) {
    const r = this.request({
      description: "getAvailableTypes",
      exec: `/lodel/edition/index.php?id=${idParent}`,
      method: "get"
    });

    return r.then(({ response, body }: RequestResult) => {
      const availableTypes = ((body) => {
        const $ = cheerio.load(body);
        const types: EntityType[] = [];
        $("#addEntity select option").each(function (this: Cheerio) {
          const value = $(this).attr("value");
          if (value == null) return;
          const id = (value.match(/\d+$/) || [])[0];
          if (id == null) return;
          const name = $(this).text().trim();
          return types.push({ name, id: Number(id) });
        });
        return types;
      })(body);

      if (availableTypes == null) {
        throw Error("Could not get types");
      }
      return availableTypes;
    });
  }

  createPublication({ idParent, idType, title = "New publication" }: PublicationOptions) {
    const r = this.request({
      description: "createPublication",
      exec: "/lodel/edition/index.php",
      method: "post",
      expectedStatusCode: 302, // Avoid redirections
      config: {
        followAllRedirects: false,
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
      }
    });

    return r.then(({ response, body }: RequestResult) => {
      const getPubliId = (response: IncomingMessage) => {
        const location = response && response.headers && response.headers.location;
        if (location == null) return null;
        const match = location.match(/\d+$/);
        return match ? match[0] : null;
      };
      const publiId = getPubliId((response));
      if (publiId == null) {
        throw Error(`Can't get id of publication '${title}'`);
      }
      return publiId;
    });
  }

  uploadDoc({ filepath, idParent, idType }: Doc) {
    // 1. Submit upload form and get OTX task id
    const submitUpload = () => {
      const r = this.request({
        description: "uploadDoc.submitUpload",
        exec: `/lodel/edition/oochargement.php?idparent=${idParent}&idtype=${idType}`,
        method: "post",
        config: {
          formData: {
            idparent: idParent,
            idtype: idType,
            fileorigin: "upload",
            mode: "strict",
            file1: createReadStream(filepath)
          }
        }
      });

      return r.then(({ response, body }: RequestResult) => {
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
          throw Error("Could not get taskId");
        }
        return { taskId };
      });
    }

    // 2. Get OTX task status
    const getStatus = ({ taskId }: OtxTask) => {
      const r = this.request({
        description: "uploadDoc.getStatus",
        exec: `/lodel/edition/checkimport.php?idtask=${taskId}&reload=0`,
        method: "get",
        config: {
          followAllRedirects: false,
        }
      });

      return r.then(({ response, body }: RequestResult) => {
        const status = ((body) => {
          const $ = cheerio.load(body);
          const status = $("#status").text();
          if (!status) return null;
          return status.replace(/(\n|\s)+/g, " ");
        })(body);

        if (status == null) {
          throw Error(`Could not get OTX log for task ${taskId}: status is null`);
        }
        return { taskId, status };
      });
    }

    // 3. Validate OTX task
    const validateTask = ({ taskId, status }: OtxTask) => {
      const r = this.request({
        description: "uploadDoc.validateTask",
        exec: `/lodel/edition/index.php?do=import&idtask=${taskId}&finish=oui&visualiserdocument=oui&reload=`,
        method: "post"
      });

      return r.then(({ response, body }: RequestResult) => {
        const getDocId = (href: string) => {
          const match = href.match(/\d+$/);
          if (match == null) return null;
          return Number(match[0]);
        };

        const href = response.request.uri.href;
        const docId = getDocId(href);
        if (docId == null) {
          throw Error(`Error while uploading '${filepath}': could not get id after upload`);
        }
        return { taskId, status, docId };
      });
    }

    // Main
    return submitUpload()
      .then(getStatus)
      .then(validateTask);
  }

  // WARNING: this feature is experimental and can potentially cause data loss
  uploadPdf({ filepath, docId }: Pdf) {
    // We need to submit again the entire form with its correct values in order to upload the pdf :-(
    const getForm = () => {
      return this.request({
        description: "uploadPdf(1)",
        exec: `/lodel/edition/index.php?do=view&id=${docId}`,
        method: "get"
      });
    };

    const submitNewForm = ({ response, body }: RequestResult) => {
      // Get form values
      const form = parseForm(body);
      const formData = Object.assign({}, form, {
        do: "edit",
        id: docId,
        "data[alterfichier][radio]": "upload",
        "data[alterfichier][upload]": createReadStream(filepath)
      });
      return this.request({
        description: "uploadPdf(2)",
        exec: `/lodel/edition/index.php?do=view&id=${docId}`,
        method: "post",
        config: { formData }
      });
    };
    
    // Main
    return getForm().then(submitNewForm);
  }

  getIndex(id: number, type: "entries" | "persons") {
    const r = this.request({
      description: `getIndex(id:${id})`,
      exec: `/lodel/admin/index.php?do=view&id=${id}&lo=${type}`,
      method: "get"
    });

    return r.then(({ response, body }: RequestResult) => {
      const $ = cheerio.load(body);
      const idTypeStr = $("input[name='idtype']").eq(0).attr("value");
      const idType = Number(idTypeStr);
      if (!idType) {
        throw Error(`Error: idType not found on index ${id}`);
      }

      const relatedEntities: number[] = [];
      $(".listEntities li").each(function (this: Cheerio) {
        const href = $(this).find(".action .move + .item a").eq(0).attr("href");
        const match = (href.match(/\d+$/) || [])[0];
        if (match.length > 0) {
          const id = Number(match);
          relatedEntities.push(id);
        } else {
          throw Error(`Error: missing related entity id in index ${id}`);
        }
      });

      const data: { [key: string]: string } = {};
      $("form.entry input[name^='data']").each(function (this: Cheerio) {
        const name = $(this).attr("name");
        const value = $(this).attr("value");
        data[name] = value;
      });
      return { id, idType, relatedEntities, data };
    });
  }

  editIndex(id: number, type: "entries" | "persons", data?: {}) {
    // Same than uploadPdf() but probably less risky because we don't have weird Lodel <select> in this form
    const getForm = () => {
      return this.request({
        description: `editIndex(id:${id})`,
        exec: `/lodel/admin/index.php?do=view&id=${id}&lo=${type}`,
        method: "get"
      });
    };

    const submitNewForm = ({ response, body }: RequestResult) => {
      const form = parseForm(body, "form.entry");
      const formData = Object.assign({}, form, data);
      return this.request({
        description: "editEntryName(2)",
        exec: `/lodel/admin/index.php`,
        method: "post",
        config: { formData }
      });
    };

    return getForm().then(submitNewForm);
  }

  deleteIndex(id: number, type: "entries" | "persons") {
    return this.request({
      description: `deleteIndex(id:${id})`,
      exec: `/lodel/admin/index.php?do=delete&id=${id}&lo=${type}`,
      method: "get"
    });
  }

  getEntry (id: number) {
    return this.getIndex(id, "entries");
  }

  editEntryName(id: number, name: string) {
    return this.editIndex(id, "entries", {
      "data[nom]": name
    });
  }

  associateEntries(idEntities: number[], idEntries: number[], idType?: number) {
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
      const entitiesQuery = idEntities.reduce((query: string, idEntity: number, i: number) => `${query}&identities[${i}]=${idEntity}`, "");
      return this.request({
        description: "associateEntries",
        exec: `/lodel/admin/index.php?do=massassoc&lo=entries&edit=1&associate=1${entitiesQuery}${entriesQuery}`,
        method: "get"
      });
    });
  }

  dissociateAllEntities(idEntry: number, idType?: number) {
    const dissociate = ({id, idType}: Entry) => {
      return this.request({
        description: "dissociateAllEntities",
        exec: `/lodel/admin/index.php?do=massassoc&idtype=${idType}&lo=entries&edit=1&identries[0]=${id}_${idType}&entitiesset=1`,
        method: "get"
      });
    };

    if (idType) {
      return dissociate({id: idEntry, idType});
    }
    return this.getEntry(idEntry).then(dissociate);
  }

  deleteEntry(id: number) {
    return this.deleteIndex(id, "entries");
  }

  getPerson(id: number) {
    return this.getIndex(id, "persons");
  }

  editPersonName(id: number, name?: string, familyName?: string) {
    const data: { [key: string]: string } = {};
    if (name) {
      data["data[prenom]"] = name;
    }
    if (familyName) {
      data["data[nomfamille]"] = familyName;
    }
    return this.editIndex(id, "persons", data);
  }

  deletePerson(id: number) {
    return this.deleteIndex(id, "persons");
  }

  // WARNING: this one can be dangerous too (same than uploadPdf)!
  // This is a workaround used in mergePersons()
  // When resubmitting an entity form, Lodel recreates the relations between entries and this entity. This is useful to remove duplicate entries : 1) rename all duplicate entries with the same (expected) name, 2) resubmit every associated entity. At the end all the entities will be related to the same entry (= the lowest id)
  // TODO: factorize this method with other which submit additionnal data to the entity form (eg: uploadPdf)
  resubmitEntity(docId: number) {
    const getForm = () => {
      return this.request({
        description: "resubmitEntity(1)",
        exec: `/lodel/edition/index.php?do=view&id=${docId}`,
        method: "get"
      });
    };

    const submitNewForm = ({ response, body }: RequestResult) => {
      const form = parseForm(body);
      const formData = Object.assign({}, form);
      return this.request({
        description: "resubmitEntity(2)",
        exec: `/lodel/edition/index.php?do=view&id=${docId}`,
        method: "post",
        config: { formData }
      });
    };

    // Main
    return getForm().then(submitNewForm);
  }

  // WARNING: this uses resubmitEntity so this can be unsafe
  mergePersons(idBase: number, idPersons: number[]) {
    const updatePersonsData = (base: Entry) => {
      const data = base.data;
      const proms = idPersons.map((id) => {
        return this.editIndex(id, "persons", data)
      });
      return Promise.all(proms);
    }

    const getRelatedEntities = () => {
      const all = idPersons.concat(idBase);
      const proms = all.map((id) => this.getPerson(id));
      return Promise.all(proms).then((persons) => {
        const relatedEntities = persons.reduce((arr: number[], person) => {
          return arr.concat(person.relatedEntities);
        }, []);
        const uniques = Array.from(new Set(relatedEntities));
        return uniques;
      });
    }

    const resubmitEntities = (entities: number[]) => {
      const proms = entities.map((id) => this.resubmitEntity(id));
      return Promise.all(proms);
    }

    return this.getPerson(idBase)
      .then(updatePersonsData)
      .then(getRelatedEntities)
      .then(resubmitEntities);
  }
}

module.exports = LodelSession;
