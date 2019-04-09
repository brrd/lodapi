# Lodapi

> Node.js API for [Lodel](https://github.com/OpenEdition/lodel/)

Note: The implementation of this toolbox is done according to my personal needs and this library is not intended to offer an exhaustive API. However feel free to create issues or to contribute if you want to add features that meet your own specific needs.

## Installation

```
npm i lodapi
```

or clone this repo and run:

```
npm install
npm run build
```

## Usage

```javascript
const LodelSession = require("lodapi");

// Instanciate the class
const session = new LodelSession("https://url-to-lodel-website.com");

// First of all authenticate
session.auth({ login: "user", password: "pwd" })
  .then(() => {
    // Then use API here
    // (...)
  })
  .catch(console.error);
```

## LodelSession methods

### `auth({login: string, password: string})`

Authenticate in Lodel. See "Usage" on top.

### `createPublication({ idParent: number, idType: number, title?: string})`

Create a new publication with type `idType` in parent `idParent`. `title` parameter is optional (default = "New publication").

### `getAvailableTypes(idParent: number)`

List possible types for children of `idParent`.

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
  relatedEntities: number[]
}
```

This method has two aliases: `getEntry(id: number)` and `getPerson(id: number)`.

### `editIndex(id: number, type: "entries" | "persons", data: {})`

Edit index `id` by posting `data` in the related edit form.

### `deleteIndex(id: number, type: "entries" | "persons")`

Delete index `id` with type "entries" or "persons".

This method has two aliases: `deleteEntry(id: number)` and `deletePerson(id: number)`.

### `editEntryName(id: number, name: string)`

Set entry `id` name to `name`.

### `associateEntries(idEntities: number[], idEntries: number[], idType?: number)`

Connect entities with entries. 

If `idType` is declared then it will be used as `idtype` for all entries. Otherwise the script will run `getEntry()` on each individual entry in order to find its type (= additionnal requests).

### `dissociateAllEntities(idEntry: number, idType?: number)`

Remove association of `idEntry` with all entries.

If `idType` is not declared the script will run `getEntry()` to find it from idEntry (= additionnal request).

### `deleteEntry(id: number)`

Delete entry `id`.

### `editPersonName(id: number, name?: string, familyName?: string)`

Set person `id` name and/ou family name.

## MIT License

Copyright (c) 2019 Thomas Brouard

