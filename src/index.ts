import * as cheerio from "cheerio";
import { createReadStream } from "fs";
import { IncomingMessage, IncomingHttpHeaders } from "http";
import * as request from "request";
import { parse } from "url";
import urljoin = require("url-join");
import { parseForm } from "./utils";
import  { createLogger, format, transports } from "winston";
import winston = require("winston");
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
  level: 'info',
  format: combine(
    timestamp(),
    myFormat
  ),
  transports: [
    new transports.File({ filename: 'lodapi-error.log', level: 'error' }),
    new transports.File({ filename: 'lodapi-combined.log' })
  ]
});

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
  logger: winston.Logger

  constructor(baseUrl: string) {
    this.logger = logger;
    logger.info(`New LodelSession`);
    this.baseUrl = baseUrl;
  }

  auth({ login, password }: Credentials) {
    logger.info(`Auth`);
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
          err = Error(`[request: ${description}] Unexpected status code: ${response.statusCode}`);
        }
        if (err) {
          logger.error(err);
          return reject(err);
        };
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
        const err = Error(`Could not get types of parent ${idParent}`);
        logger.error(err);
        throw err;
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
        const err = Error(`Can't get id of publication '${title}'`);
        logger.error(err);
        throw err;
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
          const err = Error(`Could not get taskId for upload of doc ${filepath}`);
          logger.error(err);
          throw err;
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
          const err = Error(`Could not get OTX log for task ${taskId}: status is null`);
          logger.error(err);
          throw err;
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
          const err = Error(`Error while uploading '${filepath}': could not get id after upload`);
          logger.error(err);
          throw err;
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
      const form = parseForm(body, "form#edit_ent");
      if (Object.keys(form).length === 0) {
        const err = Error(`uploadPdf: Could not get values from form of doc ${docId}`);
        logger.error(err);
        throw err;
      }

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
        const err = Error(`Error: idType not found on index ${id}`);
        logger.error(err);
        throw err;
      }

      const relatedEntities: number[] = [];
      $(".listEntities li").each(function (this: Cheerio) {
        const href = $(this).find(".action .move + .item a").eq(0).attr("href");
        const match = (href.match(/\d+$/) || [])[0];
        if (match.length > 0) {
          const id = Number(match);
          relatedEntities.push(id);
        } else {
          const err = Error(`Error: missing related entity id in index ${id}`);
          logger.error(err);
          throw err;
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
      if (Object.keys(form).length === 0) {
        const err = Error(`editIndex: Could not get values from form of index ${id}`);
        logger.error(err);
        throw err;
      }

      const formData = Object.assign({}, form, data);
      return this.request({
        description: "editIndex(2)",
        exec: `/lodel/admin/index.php`,
        method: "post",
        config: { formData }
      });
    };

    const findErrors = ({ response, body }: RequestResult) => {
      const $ = cheerio.load(body);
      const errMsg = $("form.entry span.error").text();
      if (errMsg) {
        const err = Error(`editIndex ${id}: ${errMsg}`);
        logger.error(err);
        throw err;
      }
      return Promise.resolve({ response, body });
    };

    return getForm().then(submitNewForm).then(findErrors);
  }

  deleteIndex(id: number, type: "entries" | "persons") {
    logger.info(`deleteIndex ${id}`);

    return this.request({
      description: `deleteIndex(id:${id})`,
      exec: `/lodel/admin/index.php?do=delete&id=${id}&lo=${type}`,
      method: "get"
    });
  }

  getEntry (id: number) {
    return this.getIndex(id, "entries");
  }

  getEntryIdByName(name: string, idType: number) {
    name = name.trim();

    const getEntries = () => {
      return this.request({
        description: `getEntryByName(name:${name})`,
        exec: `/lodel/admin/index.php?do=list&lo=entries&idtype=${idType}&listall=1`,
        method: "get"
      });
    }

    const findEntryId = ({ response, body }: RequestResult) => {
      const $ = cheerio.load(body);
      let id;
      $(".listEntities li").each(function(this: Cheerio) {
        const title = $(this).find("span.titre_document").first().text();
        if (title.trim() === name) {
          const a = $(this).find(".action .item a").first();
          const href = a.attr("href") || "";
          id = (href.match(/\d+$/) || [])[0];
          return false;
        }
      });
      if (!id) {
        const err = Error(`Could not find id from name ${name} (type ${idType})`);
        logger.error(err);
        throw err;
      }
      return id;
    };

    return getEntries().then(findEntryId);
  }

  editEntryName(id: number, name: string) {
    logger.info(`editEntryName ${id}, ${name}`);
    return this.editIndex(id, "entries", {
      "data[nom]": name
    });
  }

  editEntryType(id: number, type: number) {
    logger.info(`editEntryType ${id}, ${type}`);

    const getEntryName = () => {
      return this.getEntry(id).then((entry) => {
        const name = entry.data["data[nom]"];
        if (!name) {
          const err = Error(`Could not find name of entry ${id}`);
          logger.error(err);
          throw err;
        }
        return name;
      });
    }

    return this.editIndex(id, "entries", {
      "idtype": type
    })
    .catch((reason: any) => {      
      const msg = reason.toString().trim();
      const uniquenessMsg = "Le champ doit être unique.";
      if (msg.indexOf(uniquenessMsg) === -1) throw reason;
      // Use mergeEntries when an entry with this name already exists in target index
      return Promise.resolve()
        .then(getEntryName)
        .then((name: string) => this.getEntryIdByName(name, type))
        .then((targetId) => this.mergeEntries(targetId, [id]));
    });
  }

  associateEntries(idEntities: number[], idEntries: number[], idType?: number) {
    logger.info(`associateEntries : idEntities ${idEntities}, idEntries ${idEntries}, idType ${idType}`);

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

  mergeEntries(idTargetEntry: number, idEntries: number[]) {
    idEntries = idEntries.filter((id) => id !== idTargetEntry);

    logger.info(`mergeEntries : idTargetEntry ${idTargetEntry}, idEntries ${idEntries}`);
    
    // First associate each entity related with each idEntries to idTarget
    const associateEntitiesAndDeleteEntries = (targetEntry: Entry) => {
      const {idType} = targetEntry;
      const proms = idEntries.map((id) => {
        this.getEntry(id).then((entry) => {
          const {relatedEntities} = entry;
          return this.associateEntries(relatedEntities, [idTargetEntry], idType);
        })
        .then(() => {
          this.deleteEntry(id);
        });
      });
      return Promise.all(proms);
    }

    return this.getEntry(idTargetEntry)
      .then(associateEntitiesAndDeleteEntries)
  }

  getPerson(id: number) {
    return this.getIndex(id, "persons");
  }

  editPersonName(id: number, name?: string, familyName?: string) {
    logger.info(`editPersonName ${id}, ${name}, ${familyName}`);
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
      const form = parseForm(body, "form#edit_ent");
      if (Object.keys(form).length === 0) {
        const err = Error(`resubmitEntity: Could not get values from form of doc ${docId}`);
        logger.error(err);
        throw err;
      }

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
    idPersons = idPersons.filter((id) => id !== idBase);

    logger.info(`mergePersons ${idBase}, ${idPersons}`);

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
