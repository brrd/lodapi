// Exemple d'utilisation de Lodapi pour le dédoublonnage des keywords
// ==================================================================

// On utilise p-limit pour limiter le nombre de requêtes simultannées
const pLimit = require("p-limit");

// Lodapi
const LodelSession = require("lodapi");

// Informations du site
const siteUrl = "https://url-du-site-lodel";
const credentials = { login: "xxx", password: "yyy" };

// Id des types d'entrées pour ce site
const entrytypes = {
	fr: 25,
	en: 30438,
	es: 30442,
	it: 33114,
	pt: 30476
};

// Dans cet exemple, les instructions ont le format suivant :
const keywords = [
	{
		"id": 200, // identifiant de l'entrée dans Lodel
		"texte": "camembert", // texte de l'entrée
		"move": "fr" // cette entrée sera déplacée dans l'index fr
	},
	{
		"id": 201,
		"texte": "hello"
	},
	{
		"id": 202,
		"texte": "Hello",
		"target": 201 // cet entrée sera fusionnée dans l'entrée 201
	},
	{
		"id": 203,
		"texte": "World",
		"newName": "world" // cette entrée sera renommée avec ce nouveau nom
	},
	{
		"id": 204,
		"texte": "#!?",
		"delete": true // cette entrée sera supprimée
	}
];

// Renommer les entrées
function renameIndex(json) {
	const concurrency = 1;
	const limit = pLimit(concurrency);

	const session = new LodelSession(siteUrl);
	session.auth(credentials).then(() => {
		console.info(session.headers);
		const proms = json.map((entry) => {
			const getName = (str) => {
				if (str && str.length !== 0 && !/^\s*$/.test(str)) return str;
			};
			const newName = getName(entry["newName"]);
			if (!newName) return;
			if (!entry.id) throw Error("Missing entry id");
			return limit(() => session.editEntryName(entry.id, newName));
		});
		return Promise.all(proms);
	})
		.then((msg) => session.logger.info(`[main] ${msg}`))
		.catch(console.error);
}

// Fusion des entrées
function mergeIndex(json) {
	const concurrency = 1;
	const limit = pLimit(concurrency);

	const merges = getMerges(json);
	const session = new LodelSession(siteUrl);
	session.auth(credentials).then(() => {
		const proms = [];
		Object.keys(merges).map(function (idBase, index) {
			const idEntries = merges[idBase];
			const p = limit(() => session.mergeEntries(idBase, idEntries));
			proms.push(p);
		});
		return Promise.all(proms);
	})
		.then((msg) => session.logger.info(`[main] ${msg}`))
		.catch(console.error);
}

// Déplacement des entrées dans un autre index
function moveIndex(json, entrytypes) {
	const concurrency = 1;
	const limit = pLimit(concurrency);

	const session = new LodelSession(siteUrl);
	session.auth(credentials).then(() => {
		const proms = json.filter((entry) => typeof entry.move === "string" && entry.move !== "")
			.map((entry) => {
				const lang = entry.move.toLowerCase();
				const entrytype = entrytypes[lang];
				const p = limit(() => session.editEntryType(entry.id, entrytype));
				return p;
			});
		return Promise.all(proms);
	})
		.then((msg) => session.logger.info(`[main] ${msg}`))
		.catch(console.error);
}

// Supprimer les entrées
function deleteEntries(entries) {
	const concurrency = 1;
	const limit = pLimit(concurrency);

	const toDelete = entries.reduce((arr, entry) => {
		if (entry.delete === true) {
			arr.push(entry.id);
		}
		return arr;
	}, []);

	const session = new LodelSession(siteUrl);
	session.auth(credentials).then(() => {
		const proms = toDelete.map((id) => limit(() => session.deleteEntry(id)));
		return Promise.all(proms);
	})
		.then((msg) => session.logger.info(`[main] ${msg}`))
		.catch(console.error);
}

// Exécution
renameIndex(keywords);
mergeIndex(keywords);
moveIndex(keywords, entrytypes);
deleteEntries(keywords);