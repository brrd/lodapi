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

## MIT License

Copyright (c) 2019 Thomas Brouard

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
