# Lodapi

> API for [Lodel](https://github.com/OpenEdition/lodel/)

## Installation

```
npm i lodapi
```

## Usage

```javascript
const LodelSession = require("lodapi");

// Instanciate the class
const session = new LodelSession("https://url-to-lodel-website.com");

// First of all we need to anthenticate
session.auth({ login: "user", password: "pwd" })
  .then(() => {
    // Then use API here
    // (...)
  })
  .catch(console.error);
```


## LodelSession methods

### `auth({login, password})`

Authenticate in Lodel. See "Usage" on top.

### `createPublication({ idParent, idType, title})`

Create a new publication with type `idType` in parent `idParent`. `title` parameter is optional (default = "New publication").

### `getAvailableTypes(idParent)`

List possible types for children of `idParent`.

### `uploadDoc({ filepath, idParent, idType })`

Upload a document (using OTX) located at `filepath` in publication `idParent` with type `idType`.

### `uploadPdf({ filepath, docId })`

**WARNING: this feature is still experimental and can potentially cause data loss.**

Upload a PDF located a `filepath` as `docId` alterfichier.

### `getEntry(id)`

Get information about entry:

```javascript
{
  id: number,
  idType: number;
  relatedEntities: number[]
}
```

## MIT License

Copyright (c) 2019 Thomas Brouard

