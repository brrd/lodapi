import * as cheerio from "cheerio";
import { createReadStream } from "fs";
import { IncomingMessage, IncomingHttpHeaders } from "http";
import PQueue from "p-queue";
import * as request from "request";
import { URL } from "url";
import urljoin = require("url-join");
import { parseForm } from "./utils";
import { createLogger, format, transports } from "winston";
import winston = require("winston");
const { combine, timestamp, printf } = format;

interface RequestOptions {
  description: string,
  exec: string,
  baseUrl?: string,
  method: "post" | "get",
  config?: {},
  expectedStatusCode?: number | boolean,
  isAuth?: boolean,
  priority?: number
}

interface RequestResult {
  response: request.Response,
  body: any
}

interface Credentials {
  login: string,
  password: string
}

interface EntityOptions {
  idParent: number,
  idType: number,
  data: { [key: string]: string },
  entries: { [key: string]: string }
}

interface Entity {
  idParent: number,
  id: number,
  type: string,
  title: string
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
  data: { [key: string]: string }
}

interface Type {
  type: string,
  class: string,
  id: number,
  data?: { [key: string]: string }
}

interface Field {
  title: string,
  name: string,
  type: string,
  style: string,
  tei: string,
  class: string,
  id: number,
  group?: number,
  relation?: boolean
  data?: { [key: string]: string }
}

interface Option {
  name: string,
  type: string,
  title: string,
  id: number,
  group?: number,
  data?: { [key: string]: string }
}

const defaults = {
  concurrency: Infinity,
  timeout: 30000
};

const htpasswd = {
  user: "lodel",
  pass: "lodel",
  sendImmediately: false
};

// Parse form fields into an object
// TODO: factoriser
function getFormData ($:cheerio.CheerioAPI, selector: string) {
  const data: { [key: string]: string } = {};
  $(selector).each(function(this: cheerio.Node) {
    const $el = $(this);
    const name = $el.attr("name");
    if (name == null || name === "altertitle[__lodel_wildcard]") return;
    if ($el.attr("type") === "checkbox") {
      data[name] = $el.prop("checked");
      return;
    }
    const val = $el.val();
    if (val) {
      data[name] = (typeof val === "string" ? val : val[0]);
      return;
    }
    data[name] = "";
  });
  return data;
}

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
  concurrency!: number;
  timeout: number;
  headers: IncomingHttpHeaders | undefined;
  queue!: PQueue;
  logger: winston.Logger;
  isLodelAdmin?: boolean;

  constructor(baseUrl: string, { concurrency = defaults.concurrency, timeout = defaults.timeout } = defaults) {
    this.logger = logger;
    logger.info(`New LodelSession`);
    this.baseUrl = baseUrl;
    this.setConcurrency(concurrency);
    this.timeout = timeout;
  }

  setConcurrency(concurrency: number) {
    this.concurrency = concurrency;
    this.queue = new PQueue({concurrency});
  }

  async auth({ login, password }: Credentials) {
    logger.info(`Auth`);
    const { response, body } = await this.request({
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
          url_retour: new URL(this.baseUrl).pathname
        },
        jar: true
      },
    });

    this.headers = response.request.headers;
    return response;
  }

  request({ description, baseUrl = this.baseUrl, exec, method, config = {}, expectedStatusCode = 200, isAuth = false, priority = 0 }: RequestOptions) {
    if (!isAuth && this.headers == null) return Promise.reject(`[request: ${description}] Session headers is undefined. Please make sure auth() was called first.`);

    const requestConfig = Object.assign({}, {
      url: urljoin(baseUrl, exec),
      followAllRedirects: true,
      headers: this.headers,
      timeout: this.timeout
    }, config);

    const runRequest = () => new Promise<RequestResult>(function (resolve, reject) {
      const callback = (err: Error, response: request.Response, body: any) => {
        if (!err && expectedStatusCode && response.statusCode !== expectedStatusCode) {
          err = Error(`[request: ${description}] Unexpected status code: ${response.statusCode} (URL: ${requestConfig.url})`);
        }
        if (err) {
          logger.error(err);
          return reject(err);
        };
        resolve({ response, body });
      };
      request[method](requestConfig, callback);
    });

    return this.queue.add(runRequest, { priority });
  }

  async checkLodelAdmin(noCache = false) {
    if (noCache === false && this.isLodelAdmin != null) return this.isLodelAdmin;

    const { response, body } = await this.request({
      description: "checkLodelAdmin",
      baseUrl: new URL(this.baseUrl).origin,
      exec: "lodeladmin/index.php",
      method: "get",
      expectedStatusCode: false,
      priority: 1,
      config: {
        followAllRedirects: false,
        followRedirect: false
      }
    });

    this.isLodelAdmin = response.statusCode === 200;
    return this.isLodelAdmin;
  }

  async lodelAdminRequired() {
    const isAdmin = await this.checkLodelAdmin();
    if (isAdmin) return;
    const errMsg = "Lodeladmin access level is required for this action";
    logger.error(errMsg);
    throw new Error(errMsg);
  }

  async getAvailableTypes(idParent: number) {
    const { response, body } = await this.request({
      description: "getAvailableTypes",
      exec: `/lodel/edition/index.php?id=${idParent}`,
      method: "get"
    });

    const availableTypes = ((html) => {
      const $ = cheerio.load(html);
      const types: EntityType[] = [];
      $("#addEntity select option").each(function (this: cheerio.Element) {
        const value = $(this).attr("value");
        if (value == null)
          return;
        const id = (value.match(/\d+$/) || [])[0];
        if (id == null)
          return;
        const name = $(this).text().trim();
        types.push({ name, id: Number(id) });
      });
      return types;
    })(body);
    if (availableTypes == null) {
      const err = Error(`Could not get types of parent ${idParent}`);
      logger.error(err);
      throw err;
    }
    return availableTypes;
  }

  async getChildren(idParent: number) {
    const { response, body } = await this.request({
      description: "getAvailableTypes",
      exec: `/lodel/edition/index.php?id=${idParent}`,
      method: "get"
    });

    const $ = cheerio.load(body);
    const entities: Entity[] = [];
    $("#listEntities li").each(function (this: cheerio.Element) {
      const id = parseInt(($(this).attr("id") || "").replace(/.*_(\d+)$/, "$1"), 10);
      const type = $(this).find(".type_document").text().replace(/\((.*)\)/, "$1");
      const title = $(this).find(".titre_document a").text().trim();
      const entity = { idParent, id, type, title };
      entities.push(entity);
    });
    return entities;
  }

  async createEntity({ idParent, idType, data = {}, entries = {} }: EntityOptions, defaultData = {}) {
    const form: { [key: string]: any } = {
      do: "edit",
      id: 0,
      timestamp: Date.now(),
      idparent: idParent,
      idtype: idType,
      creationmethod: "form",
      edit: 1,
      creationinfo: "xhtml",
      visualiserdocument: true
    };

    const fullData = Object.assign({}, defaultData, data);
    Object.keys(fullData).forEach((key) => {
      form[`data[${key}]`] = fullData[key];
    });
    Object.keys(entries).forEach((key) => {
      form[`entries[${key}]`] = entries[key];
    });

    const { response, body } = await this.request({
      description: "createEntity",
      exec: "/lodel/edition/index.php",
      method: "post",
      expectedStatusCode: false,
      config: {
        followAllRedirects: false,
        form
      }
    });

    const getEntityId = (msg: IncomingMessage) => {
      const location = msg && msg.headers && msg.headers.location;
      if (location == null)
        return null;
      const match = location.match(/\d+$/);
      return match ? match[0] : null;
    };
    const entityId = getEntityId((response));
    if (entityId == null) {
      const lodelError = ((html) => {
        const $ = cheerio.load(html);
        const text = $("#editEntities > .error").text();
        if (!text)
          return null;
        return "(" + text.replace(/(\n|\s)+/g, " ") + ")";
      })(body);
      const err = Error(`Can't get id of created entity ${lodelError}`);
      logger.error(err);
      throw err;
    }
    return parseInt(entityId, 10);
  }

  createPublication(options: EntityOptions) {
    return this.createEntity(options, { titre: "New Publication", datepubli: "today" });
  }

  async uploadDoc({ filepath, idParent, idType }: Doc) {
    // 1. Submit upload form and get OTX task id
    const submitUpload = async () => {
      const { response, body } = await this.request({
        description: "uploadDoc.submitUpload",
        exec: `/lodel/edition/oochargement.php?idparent=${idParent}&idtype=${idType}`,
        method: "post",
        priority: 0,
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

      // Get OTX task id after upload
      const getTaskId = (html: any) => {
        if (typeof html !== "string")
          return null;
        const re = /window\.parent\.o\.changeStep\((\d+),\s+"(\d+)"\);/;
        const match = html.match(re);
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
    }

    // 2. Get OTX task status
    const getStatus = async ({ taskId }: OtxTask) => {
      const { response, body } = await this.request({
        description: "uploadDoc.getStatus",
        exec: `/lodel/edition/checkimport.php?idtask=${taskId}&reload=0`,
        method: "get",
        expectedStatusCode: false,
        priority: 1,
        config: {
          followAllRedirects: false,
        }
      });

      const status = ((html) => {
        const $ = cheerio.load(html);
        const statusText = $("#status").text();
        if (!statusText)
          return null;
        return statusText.replace(/(\n|\s)+/g, " ");
      })(body);
      if (status == null) {
        const err = Error(`Could not get OTX log for task ${taskId}: status is null`);
        logger.error(err);
        throw err;
      }
      return { taskId, status };
    }

    // 3. Validate OTX task
    const validateTask = async ({ taskId, status }: OtxTask) => {
      let redirectCount = 0;
      const { response, body } = await this.request({
        description: "uploadDoc.validateTask",
        exec: `/lodel/edition/index.php?do=import&idtask=${taskId}&finish=oui&visualiserdocument=oui&reload=`,
        method: "post",
        expectedStatusCode: false,
        priority: 3,
        config: {
          // Follow only the first redirect
          followRedirect: (res: request.Response) => redirectCount++ === 0,
        }
      });

      const getDocId = (href: string) => {
        const match = href.match(/\d+$/);
        if (match == null)
          return null;
        return Number(match[0]);
      };
      const docId = getDocId(response.request.uri.href);
      if (docId == null) {
        const err = Error(`Error while uploading '${filepath}': could not get id after upload`);
        logger.error(err);
        throw err;
      }
      return { taskId, status, docId };
    }

    // Main
    let task = await submitUpload();
    task = await getStatus(task);
    return validateTask(task);
  }

  // WARNING: this feature is experimental and can potentially cause data loss
  async uploadPdf({ filepath, docId }: Pdf) {
    // We need to submit again the entire form with its correct values in order to upload the pdf :-(
    const getForm = () => {
      return this.request({
        description: "uploadPdf(1)",
        exec: `/lodel/edition/index.php?do=view&id=${docId}`,
        method: "get",
        priority: 0
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
        priority: 1,
        config: { formData }
      });
    };

    // Main
    const requestResult = await getForm();
    return submitNewForm(requestResult);
  }

  async getIndex(id: number, type: "entries" | "persons"): Promise<Entry> {
    const { response, body } = await this.request({
      description: `getIndex(id:${id})`,
      exec: `/lodel/admin/index.php?do=view&id=${id}&lo=${type}`,
      method: "get"
    });

    const $ = cheerio.load(body);
    const idTypeStr = $("input[name='idtype']").eq(0).attr("value");
    const idType = Number(idTypeStr);
    if (!idType) {
      const err = Error(`Error: idType not found on index ${id}`);
      logger.error(err);
      throw err;
    }
    const relatedEntities: number[] = [];
    $(".listEntities li").each(function (this: cheerio.Element) {
      const href = $(this).find(".action .move + .item a").eq(0).attr("href") || "";
      const match = (href.match(/\d+$/) || [])[0] || "";
      if (match.length > 0) {
        const entityId = Number(match);
        relatedEntities.push(entityId);
      } else {
        const err = Error(`Error: missing related entity id in index ${id}`);
        logger.error(err);
        throw err;
      }
    });
    const data: { [key: string]: string; } = {};
    $("form.entry input[name^='data']").each(function (this: cheerio.Element) {
      const name = $(this).attr("name");
      const value = $(this).attr("value") || "";
      data[name!] = value;
    });
    return { id, idType, relatedEntities, data };
  }

  async editIndex(id: number, type: "entries" | "persons", data?: {}) {
    // Same than uploadPdf() but probably less risky because we don't have weird Lodel <select> in this form
    const getForm = () => {
      return this.request({
        description: `editIndex(id:${id})`,
        exec: `/lodel/admin/index.php?do=view&id=${id}&lo=${type}`,
        method: "get",
        priority: 0
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
        priority: 1,
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

    const requestResult = await getForm();
    const requestResult2 = await submitNewForm(requestResult);
    return findErrors(requestResult2);
  }

  deleteIndex(id: number, type: "entries" | "persons") {
    logger.info(`deleteIndex ${id}`);

    return this.request({
      description: `deleteIndex(id:${id})`,
      exec: `/lodel/admin/index.php?do=delete&id=${id}&lo=${type}`,
      method: "get"
    });
  }

  getEntry(id: number) {
    return this.getIndex(id, "entries");
  }

  async getEntryIdByName(name: string, idType: number) {
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
      $(".listEntities li").each(function(this: cheerio.Element) {
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

    const requestResult = await getEntries();
    return findEntryId(requestResult);
  }

  async editEntryName(id: number, name: string) {
    logger.info(`editEntryName ${id}, ${name}`);

    const getEntryType = async () => {
      const entry = await this.getEntry(id);
      const type = entry.idType;
      if (!type) {
        const err = Error(`Could not find type of entry ${id}`);
        logger.error(err);
        throw err;
      }
      return type;
    };

    try {
      return await this.editIndex(id, "entries", {
        "data[nom]": name
      });
    } catch (reason: any) {
      const msg = reason.toString().trim();
      const uniquenessMsg = "Le champ doit être unique.";
      if (msg.indexOf(uniquenessMsg) === -1)
        throw reason;
      const entryType = await getEntryType();
      const targetId = await this.getEntryIdByName(name, entryType);
      return await this.mergeEntries(targetId, [id]);
    }
  }

  async editEntryType(id: number, type: number) {
    logger.info(`editEntryType ${id}, ${type}`);

    const getEntryName = async () => {
      const entry = await this.getEntry(id);
      const name = entry.data["data[nom]"];
      if (!name) {
        const err = Error(`Could not find name of entry ${id}`);
        logger.error(err);
        throw err;
      }
      return name;
    };

    try {
      return await this.editIndex(id, "entries", {
        "idtype": type
      });
    } catch (reason: any) {
      const msg = reason.toString().trim();
      const uniquenessMsg = "Le champ doit être unique.";
      if (msg.indexOf(uniquenessMsg) === -1)
        throw reason;
      const entryName = await getEntryName();
      const targetId = await this.getEntryIdByName(entryName, type);
      return await this.mergeEntries(targetId, [id]);
    }
  }

  async associateEntries(idEntities: number[], idEntries: number[], idType?: number) {
    logger.info(`associateEntries : idEntities ${idEntities}, idEntries ${idEntries}, idType ${idType}`);

    // Create entries query string
    const entriesQuery = await new Promise<string>((resolve, reject) => {
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
    const entitiesQuery = idEntities.reduce((query: string, idEntity: number, i: number) => `${query}&identities[${i}]=${idEntity}`, "");
    return await this.request({
      description: "associateEntries",
      exec: `/lodel/admin/index.php?do=massassoc&lo=entries&edit=1&associate=1${entitiesQuery}${entriesQuery}`,
      method: "get"
    });
  }

  async dissociateAllEntities(idEntry: number, idType?: number) {
    const dissociate = ({id, idType}: Entry) => {
      return this.request({
        description: "dissociateAllEntities",
        exec: `/lodel/admin/index.php?do=massassoc&idtype=${idType}&lo=entries&edit=1&identries[0]=${id}_${idType}&entitiesset=1`,
        method: "get"
      });
    };

    if (idType) {
      return dissociate({id: idEntry, idType, data: {}});
    }
    const entry = await this.getEntry(idEntry);
    return dissociate(entry);
  }

  deleteEntry(id: number) {
    return this.deleteIndex(id, "entries");
  }

  async mergeEntries(idTargetEntry: number, idEntries: number[]) {
    idEntries = idEntries.filter((id) => id !== idTargetEntry);

    logger.info(`mergeEntries : idTargetEntry ${idTargetEntry}, idEntries ${idEntries}`);

    // First associate each entity related with each idEntries to idTarget
    const associateEntitiesAndDeleteEntries = (targetEntry: Entry) => {
      const {idType} = targetEntry;
      const proms = idEntries.map((id) => {
        if (id === idTargetEntry) return;
        return this.getEntry(id).then((entry) => {
          const relatedEntities = entry.relatedEntities || [];
          return this.associateEntries(relatedEntities, [idTargetEntry], idType);
        })
        .then(() => {
          this.deleteEntry(id);
        });
      });
      return Promise.all(proms);
    }

    const targetEntry = await this.getEntry(idTargetEntry);
    return associateEntitiesAndDeleteEntries(targetEntry);
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
  async resubmitEntity(docId: number) {
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
    const requestResult = await getForm();
    return submitNewForm(requestResult);
  }

  // WARNING: this uses resubmitEntity so this can be unsafe
  async mergePersons(idBase: number, idPersons: number[]) {
    idPersons = idPersons.filter((id) => id !== idBase);

    logger.info(`mergePersons ${idBase}, ${idPersons}`);

    const updatePersonsData = (base: Entry) => {
      const data = base.data;
      const proms = idPersons.map((id) => {
        return this.editIndex(id, "persons", data)
      });
      return Promise.all(proms);
    }

    const getRelatedEntities = async () => {
      const all = idPersons.concat(idBase);
      const proms = all.map((id) => this.getPerson(id));
      const persons = await Promise.all(proms);
      const relatedEntities = persons.reduce((arr: number[], person) => {
        return arr.concat(person.relatedEntities || []);
      }, []);
      const uniques = Array.from(new Set(relatedEntities));
      return uniques;
    }

    const resubmitEntities = (entities: number[]) => {
      const proms = entities.map((id) => this.resubmitEntity(id));
      return Promise.all(proms);
    }

    const basePerson = await this.getPerson(idBase);
    await updatePersonsData(basePerson);
    const entities = await getRelatedEntities();
    return resubmitEntities(entities);
  }

  async restoreBackup(file: string) {
    const checkResult = ({ response, body }: RequestResult) => {
      if (!body.includes("Importation des données réussie")) {
        const err = Error(`Could not find restoreBackup success message (${file})`);
        logger.error(err);
        throw err;
      }
    };

    const requestResult = await this.request({
      description: "restoreBackup",
      exec: `/lodel/admin/index.php?do=import&lo=data&file=${file}`,
      method: "get",
      expectedStatusCode: false // don't check status code, it's working anyway
    });
    return checkResult(requestResult);
  }

  sortEntities(sitename: string, list: number[]) {
    return this.request({
      description: "sortEntities",
      baseUrl: new URL(this.baseUrl).origin,
      exec: "share/ajax/dragndrop.php",
      method: "post",
      config: {
        formData: {
          tabids: list.map((id) => "container_" + id).join(","),
          site: sitename
        }
      }
    });
  }

  async listOptionsIds() {
    const { response, body } = await this.request({
      description: "getFields",
      exec: `/lodel/admin/index.php`,
      method: "get"
    });
    const $ = cheerio.load(body);

    return $("select.barInfo option[value*='lo=useroptiongroups']").map(function() {
      const url = $(this).attr("value") || "";
      const str = (url.match(/id=(\d+)/) || [])[1];
      return Number(str);
    }).get();
  }

  async listClasses(classType: "entities" | "entries" | "persons") {
    const { response, body } = await this.request({
      description: "getClasses",
      exec: `/lodel/admin/index.php?do=list&lo=classes&classtype=${classType}`,
      method: "get"
    });

    const $ = cheerio.load(body);
    const classes: String[] = [];
    $("table.statistics tr:not(:first-child) td:first-of-type").each(function (this: cheerio.Element) {
      const classname = $(this).text();
      classes.push(classname);
    });
    return classes;
  }

  async listTypes(classType: "entities" | "entries" | "persons", classname: string) {
    await this.lodelAdminRequired();

    const loMap = {
      "entities": "types",
      "entries": "entrytypes",
      "persons": "persontypes"
    };

    const { response, body } = await this.request({
      description: "getTypes",
      exec: `/lodel/admin/index.php?do=list&lo=${loMap[classType]}&class=${classname}`,
      method: "get"
    });

    const $ = cheerio.load(body);

    const types: Type[] = [];
    $("table.statistics tr:not(:first-child)").each(function (this: cheerio.Element) {
      const href = $(this).find("a").attr("href") || "";
      const id = (href.match(/&id=(\d+)/) || [])[1];
      types.push({
        type: $(this).find("td:first-of-type").text(),
        class: classname,
        id: Number(id)
      });
    });
    return types;
  }

  async getDetails(lo: "entities" | "entries" | "persons" | "tablefields" | "options", id: number) {
    await this.lodelAdminRequired();

    const loMap = {
      "entities": "types",
      "entries": "entrytypes",
      "persons": "persontypes",
      "tablefields": "tablefields",
      "options": "options"
    };

    const { response, body } = await this.request({
      description: "getTypeDetails",
      exec: `/lodel/admin/index.php?do=view&id=${id}&lo=${loMap[lo]}`,
      method: "get"
    });

    const $ = cheerio.load(body);
    return getFormData($, "#lodel-container form [name]");
  }

  async getFields(classname: string) {
    await this.lodelAdminRequired();

    const { response, body } = await this.request({
      description: "getFields",
      exec: `/lodel/admin/index.php?do=list&lo=tablefieldgroups&class=${classname}`,
      method: "get"
    });

    const $ = cheerio.load(body);

    const hasGroups = $("table .status.group").length > 0;

    const fields: Field[] = [];
    const selector = hasGroups ? "table.statistics tr:not(:nth-child(-n+3))" : "table.statistics tr:not(:first-child)";

    $(selector).each(function (this: cheerio.Element) {
      const href = $(this).find("a").attr("href") || "";
      const id = (href.match(/&id=(\d+)/) || [])[1];
      if (id == null) return;

      let groupId;
      let isFirstTable = true;
      if (hasGroups) {
        const groupHref = $(this).parents("table").find(".actions a").eq(0).attr("href") || "";
        groupId = Number((groupHref.match(/&id=(\d+)/) || [])[1]);
      } else {
        isFirstTable = $(this).parents("table").is(":first-of-type");
      }

      const field: Field = {
        title: $(this).find("th:nth-child(1)").text(),
        name: $(this).find("td:nth-child(2)").text(),
        type: $(this).find("td:nth-child(3)").text(),
        style: $(this).find("td:nth-child(4)").text(),
        tei: $(this).find("td:nth-child(5)").text(),
        class: classname,
        id: Number(id),
        relation: !isFirstTable
      }
      if (groupId) {
        field.group = groupId;
      }
      fields.push(field);
    });
    return fields;
  }

  async listOptions() {
    await this.lodelAdminRequired();

    const { response, body } = await this.request({
      description: "listOptions",
      exec: `/lodel/admin/index.php?do=list&lo=optiongroups`,
      method: "get"
    });

    const $ = cheerio.load(body);

    const options: Option[] = [];
    const selector = "table.statistics tr:not(:nth-child(-n+2))";

    $(selector).each(function (this: cheerio.Element) {
      const href = $(this).find("a").attr("href") || "";
      const id = (href.match(/&id=(\d+)/) || [])[1];
      if (id == null) return;

      let groupId;
      const groupHref = $(this).parents("table").find(".actions a").eq(0).attr("href") || "";
      groupId = Number((groupHref.match(/&id=(\d+)/) || [])[1]);

      const option: Option = {
        name: $(this).find("td:nth-child(1)").text(),
        type: $(this).find("td:nth-child(2)").text(),
        title: $(this).find("td:nth-child(3)").text(),
        id: Number(id),
      }
      if (groupId) {
        option.group = groupId;
      }
      options.push(option);
    });
    return options;
  }
}

module.exports = LodelSession;
