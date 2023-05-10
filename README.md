# Lodapi

> Node.js API for [Lodel](https://github.com/OpenEdition/lodel/)

Note: The implementation of this toolbox is done according to my personal needs and this library is not intended to offer an exhaustive API. Feel free to contribute if you want to add your own features.

## Installation

```bash
npm i lodapi
```

or clone this repo and run:

```bash
npm install
npm run build
```

## Usage

```javascript
const LodelSession = require("lodapi");

const options = {
  concurrency: 2, // Default: Infinity
  timeout: 10000 // Default: 30000
};

(async () => {
  // Instantiate the class
  const session = new LodelSession("https://url-to-lodel-website.com", options);

  try {
    // Authenticate in Lodel
    await session.auth({ login: "user", password: "pwd" });

    // Then do stuff
    const output = await session.getChildren(0);
    console.log(output);

  } catch (e) {
    console.error(e);
  }
})();
```

## Warning

Methods which submit data using the Lodel entity form can cause data loss depending on which type of field is visible in the form. This is due to some weird fields used by Lodel, especially for adding entities to entries. The safest way to avoid such problems is to hide those fields from the admin panel before using any dangerous method.

## LodelSession methods

### `auth({login: string, password: string})`

Authenticate in Lodel. See "Usage" on top.

### `setConcurrency(concurrency: number)`

Set request `concurrency` setting.

### `checkLodelAdmin(noCache = false)`

Check if the current account has lodeladmin rights. The return boolean value is stored in `session.isLodelAdmin`.

### `createEntity({ idParent: number, idType: number, data: {} }, defaultData: {})`

Create a new entity with type `idType` in parent `idParent`. `data` parameter contains the data sent in the form.

### `createPublication({ idParent: number, idType: number, data: {}})`

Alias to `createEntity()`.

Create a new publication with type `idType` in parent `idParent`. `data` parameter contains the data sent in the form.

### `getAvailableTypes(idParent: number)`

List possible types for children of `idParent`.

### `getChildren(idParent: number)`

List children entities of `idParent`.

### `uploadDoc({ filepath: string, idParent: string, idType: string })`

Upload a document (using OTX) located at `filepath` in publication `idParent` with type `idType`.

### `uploadPdf({ filepath: string, docId: number })`

**WARNING: this feature is still experimental and can potentially cause data loss.**

Upload a PDF located a `filepath` as `docId` alterfichier.

### `getIndex(id: number, type: "entries" | "persons")`

Get information about index `id`:

```javascript
{
  id: number,
  idType: number;
  relatedEntities?: number[],
  data?: { [key: string]: string }
}
```

This method has two aliases: `getEntry(id: number)` and `getPerson(id: number)`.

### `editIndex(id: number, type: "entries" | "persons", data: {})`

Edit index `id` by posting `data` in the related edit form.

### `deleteIndex(id: number, type: "entries" | "persons")`

Delete index `id` with type "entries" or "persons".

This method has two aliases: `deleteEntry(id: number)` and `deletePerson(id: number)`.

### `getEntryIdByName(name: string, idType: number)`

Get the id of an entry from its name.

### `editEntryName(id: number, name: string)`

Set entry `id` name to `name`.

### `editEntryType(id: number, type: number)`

Move entry `id` to index `type` (it has to be within the same class). If an entry with the same name already exists in the target index, then the entry `id` will be merged into it.

### `associateEntries(idEntities: number[], idEntries: number[], idType?: number)`

Connect entities with entries.

If `idType` is declared then it will be used as `idtype` for all entries. Otherwise the script will run `getEntry()` on each individual entry in order to find its type (= additional requests).

### `dissociateAllEntities(idEntry: number, idType?: number)`

Remove association of `idEntry` with all entries.

If `idType` is not declared the script will run `getEntry()` to find it from idEntry (= additional request).

### `deleteEntry(id: number)`

Delete entry `id`.

### `editPersonName(id: number, name?: string, familyName?: string)`

Set person `id` name and/ou family name.

### `resubmitEntity(docId: number)`

Resubmit entity form.

This is a workaround used in mergePersons(). When resubmitting an entity form, Lodel recreates the relations between entries and this entity. This is useful to remove duplicate entries : 1) rename all duplicate entries with the same (expected) name, 2) resubmit every associated entity. At the end all the entities will be related to the same entry (= the lowest id).

**Since this method submits the entity form, it can cause data loss so be careful.**

### `mergePersons(idBase: number, idPersons: number[])`

Merge persons listed in `idPerson` in a person which will have the `idBase` data (the lowest id among all those persons will be kept by Lodel). It comes in very handy when cleaning the duplicates among authors.

**Since this method submits the entity form, it can cause data loss so be careful.**

### `mergeEntries(idTargetEntry: number, idEntries: number[])`

Merge entries listed in `idEntries` in the entry with the id `idTargetEntry`. It comes in very handy when cleaning the duplicates among entries.

### `restoreBackup(file: string)`

Restore a backup. `file` is the path to the backup archive on the host.

**WARNING: initial data will be lost after this.**

### `sortEntities(sitename: string, list: number[])`

Sort entities according to `list` of ids. `sitename`, which is the name of the site in Lodel database, is required.

### `listOptionsIds()`

Return a list of available options ids.

### `listClasses(classType: "entities" | "entries" | "persons")`

List classes defined in editorial model. `getDetail()` can be used to get more information about each individual class.

### `getClassesData(classType: "entities" | "entries" | "persons", deap: boolean)`

Get data about fields of all classes. If `deap` is true, a request is performed for each field to get its full details.

### `listTypes(classType: "entities" | "entries" | "persons", classname: string, deap: boolean)`

**Lodeladmin access level is required.**

List available types for an entity, entry or person class. `getDetail()` can be used to get more information about each individual type. If `deap` is true, a request is performed for each type to get its full details.

### `getDetails(lo: "entities" | "entries" | "persons" | "tablefields" | "options", id: number)`

**Lodeladmin access level is required.**

Get information from the field definition form:

* When `lo` is "entities", "entries" or "persons", get information about a type.
* When `lo` is "tablefields", get information about a field.
* When `lo` is "options", get information about an option field.

### `getFields(classname: string, deap: boolean)`

**Lodeladmin access level is required.**

Get type fields. If `deap` is true, a request is performed for each field to get its full details.

### `listOptions()`

**Lodeladmin access level is required.**

List options defined in editorial model. `getDetail()` can be used to get more information about each individual option.

### `listInternalStyles()`

**Lodeladmin access level is required.**

List internal styles defined in editorial model. `getDetail()` is not needed since this method already returns all the data about internal styles.

## Examples

See `examples/` directory.

## MIT License

Copyright (c) 2022 Thomas Brouard
