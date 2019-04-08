# Lodapi

> Node.js API for [Lodel](https://github.com/OpenEdition/lodel/)

## Installation

```
npm i lodapi
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

### `getEntry(id: number)`

Get information about entry:

```javascript
{
  id: number,
  idType: number;
  relatedEntities: number[]
}
```

### `associateEntries(idEntities: number[], idEntries: number[], idType?: number)`

Connect entities with entries. 

If `idType` is declared then it will be used as `idtype` for all entries. Otherwise the script will run `getEntry()` on each individual entry in order to find its type (= additionnal requests).

## MIT License

Copyright (c) 2019 Thomas Brouard

