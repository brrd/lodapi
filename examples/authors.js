// Exemple d'utilisation de Lodapi pour le dédoublonnage des auteurs
// =================================================================

// On utilise p-limit pour limiter le nombre de requêtes simultannées
const pLimit = require("p-limit");

// Lodapi
const LodelSession = require("lodapi");

// Informations du site
const siteUrl = "https://url-du-site-lodel";
const credentials = { login: "xxx", password: "yyy" };

// Dans cet exemple, les instructions ont le format suivant :
const authors = [
	{
		"id": 100, // identifiant Lodel
		"prenom": "John", // prénom actuel
		"nom": "Doe", // nom actuel
		"newPrenom": "Jean", // nouveau prénom
		"newNom": "Do", // nouveau nom
	},
	{
		"id": 101,
		"prenom": "Pierre",
		"nom": "Dupond"
	},
	{
		"id": 102,
		"prenom": "Pierre",
		"nom": "Dupont",
		"target": 101 // identifiant lodel de l'entité dans laquelle sera fusinné l'auteur
	}
];

// Renommage des auteurs
function renamePersons(authors) {
	const concurrency = 1;
	const limit = pLimit(concurrency);

	const session = new LodelSession(siteUrl);
	session.auth(credentials).then(() => {
		const proms = authors.map((author) => {
			const getName = (str) => {
				if (str && str.length !== 0 && !/^\s*$/.test(str)) return str;
			};
			const prenom = getName(author["newPrenom"]);
			const nomfamille = getName(author["newNom"]);
			if (!prenom && !nomfamille) return;
			if (!author.id) throw Error("Missing author id");
			return limit(() => session.editPersonName(author.id, prenom, nomfamille));
		});
		return Promise.all(proms);
	})
		.then((msg) => session.logger.info(`[main] ${msg}`))
		.catch(console.error);
}

// Dedoublonnage des auteurs
// a. Une fonction pour creer la liste des merges à partir des données de l'objet authors
function getMerges(json) {
	// Cette fonction récursive regarde si l'element target n'est pas lui meme mergé ailleurs, et ainsi de suite
	function followTarget(target) {
		const targeted = json.find((el) => el.id === target);
		if (!targeted) return target; // On retourne target plutot que undefined car cela permet de merger dans un autre index (exemple : déplacer un mot-clé dans les keywords)
		if (targeted.target && targeted.target !== targeted.id) return followTarget(targeted.target);
		return target;
	}

	return json.reduce((obj, el) => {
		const { id, target } = el;
		if (!target || target === id) return obj;
		const actualTarget = followTarget(target);
		if (!actualTarget) return obj;
		if (!obj[actualTarget]) {
			obj[actualTarget] = [];
		}
		obj[actualTarget].push(id);
		return obj;
	}, {});
}

// b. Merger
function mergePersons(authors) {
	const concurrency = 1;
	const limit = pLimit(concurrency);

	const merges = getMerges(authors);
	const session = new LodelSession(siteUrl);
	session.auth(credentials).then(() => {
		const proms = [];
		Object.keys(merges).map(function (idBase, index) {
			const idPersons = merges[idBase];
			const p = limit(() => session.mergePersons(idBase, idPersons));
			proms.push(p);
		});
		return Promise.all(proms);
	})
		.then((msg) => session.logger.info(`[main] ${msg}`))
		.catch(console.error);
}

// Exécution
renamePersons(authors);
mergePersons(authors);