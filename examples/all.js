const LodelSession = require("lodapi");
const authInfo = require("./private/auth.js");

console.log(`Hello ${authInfo.credentials.login}!`);

const options = {
  concurrency: 2,
  timeout: 60000
};

// Replace the following with values from your site
const site = {
  type: {
    billet: 10,
    collection: 12,
    information: 24,
    motsclesfr: 56,
    motsclesen: 54
  },
  entity: {
    collection: 74,
    texte: 84,
  },
  index: {
    entry: 132,
    entries: [200, 240, 279],
    person: 252,
    persons: [303, 327]
  },
  string: {
    entryName: "apprentissage",
    sitename: authInfo.url.replace(/.*\/([a-z-]+)\/?$/, "$1"),
    backupPath: "path/to/dump"
  },
  rootOrder: [71, 72, 73, 74, 75]
};

(async () => {
  const session = new LodelSession(authInfo.url, options);

  try {
    await session.auth(authInfo.credentials);

    let output;

    output = await session.getAvailableTypes(0);
    console.log("getAvailableTypes", output);

    output = await session.getChildren(0);
    console.log("getChildren", output);

    output = await session.createEntity({idParent: 0, idType: site.type.billet, data: { "titre": "Hello world" }});
    console.log("createEntity", output);

    output = await session.createPublication({idParent: 0, idType: site.type.collection, data: { "titre": "Une collection made in Lodapi" }});
    console.log("createPublication", output);

    output = await session.uploadDoc({filepath: "./sample.docx", idParent: site.entity.collection, idType: site.type.information});
    console.log("uploadDoc", output);

    output = await session.uploadPdf({filepath: "./sample.pdf", docId: site.entity.texte});
    console.log("uploadPdf", output);

    output = await session.getIndex(site.index.entry, "entries");
    console.log("getIndex", output);

    output = await session.editIndex(site.index.entry, "entries", { "data[definition]": "Foo bar" });
    console.log("editIndex", output);

    output = await session.getEntryIdByName(site.string.entryName, site.type.motsclesfr);
    console.log("getEntryIdByName", output);

    output = await session.editEntryName(site.index.entry, site.string.entryName + "2");
    console.log("editEntryName", output);

    output = await session.editEntryType(site.index.entry, site.type.motsclesen);
    console.log("editEntryType", output);

    output = await session.associateEntries([site.entity.texte], [site.index.entry]);
    console.log("associateEntries", output);

    output = await session.dissociateAllEntities(site.index.entry);
    console.log("dissociateAllEntities", output);

    output = await session.mergeEntries(site.index.entry, site.index.entries);
    console.log("mergeEntries", output);

    output = await session.editPersonName(site.index.person, "John", "Aaaaaaa");
    console.log("editPersonName", output);

    output = await session.mergePersons(site.index.person, site.index.persons);
    console.log("mergePersons", output);

    output = await session.mergePersons(site.index.person, site.index.persons);
    console.log("mergePersons", output);

    output = await session.sortEntities(site.string.sitename, site.rootOrder);
    console.log("sortEntities", output);

    // output = await session.restoreBackup(site.string.backupPath);
    // console.log("restoreBackup", output);

  } catch (e) {
    console.error(e);
  }
})();
