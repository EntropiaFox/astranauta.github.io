const fs = require("fs");
const ut = require("../node/util.js");
require("../js/utils.js");
require("../js/render.js");
require("../js/render-dice.js");

async function pLoadData (originalFilename, originalPath) {
	switch (originalFilename) {
		case "races.json": {
			ut.patchLoadJson();

			const rawRaceData = await DataUtil.loadJSON(originalPath);
			const raceData = Renderer.race.mergeSubraces(rawRaceData.race, {isAddBaseRaces: true});

			ut.unpatchLoadJson();

			return {race: raceData};
		}

		default: return ut.readJson(originalPath)
	}
}

function testClasses ({errors}) {
	const classIndex = ut.readJson("./data/class/index.json");
	const classFiles = Object.values(classIndex)
		.map(file => ut.readJson(`./data/class/${file}`));

	const uidsClass = new Set();
	const uidsClassFeature = new Set();
	const uidsSubclassFeature = new Set();

	classFiles.forEach(data => {
		(data.class || []).forEach(cls => {
			const uid = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls);
			uidsClass.add(uid);
		});

		(data.classFeature || []).forEach(cf => {
			const uid = UrlUtil.URL_TO_HASH_BUILDER["classFeature"](cf);
			uidsClassFeature.add(uid);
		});

		(data.subclassFeature || []).forEach(scf => {
			const uid = UrlUtil.URL_TO_HASH_BUILDER["subclassFeature"](scf);
			uidsSubclassFeature.add(uid);
		});
	});

	const foundryData = ut.readJson("./data/class/foundry.json");
	(foundryData.class || []).forEach(cls => {
		const uid = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls);
		if (!uidsClass.has(uid)) errors.push(`\tClass "${uid}" not found!`);
	});
	(foundryData.classFeature || []).forEach(fcf => {
		const uid = UrlUtil.URL_TO_HASH_BUILDER["classFeature"](fcf);
		if (!uidsClassFeature.has(uid)) errors.push(`\tClass feature "${uid}" not found!`);
	});
	(foundryData.subclassFeature || []).forEach(fscf => {
		const uid = UrlUtil.URL_TO_HASH_BUILDER["subclassFeature"](fscf);
		if (!uidsSubclassFeature.has(uid)) errors.push(`\tSubclass feature "${uid}" not found!`);
	});
}

async function pTestDir ({errors, dir}) {
	const FOUNDRY_FILE = "foundry.json";

	const dirList = fs.readdirSync(`./data/${dir}`)
		.filter(it => !it.startsWith("fluff-") && !it.startsWith("roll20") && it !== "index.json");

	if (!dirList.includes(FOUNDRY_FILE)) throw new Error(`No "${FOUNDRY_FILE}" file found in dir "${dir}"!`);

	const foundryPath = `./data/${dir}/${FOUNDRY_FILE}`;
	const foundryData = ut.readJson(foundryPath);
	const originalDatas = await dirList
		.filter(it => it !== FOUNDRY_FILE)
		.pSerialAwaitMap(it => pLoadData(it, `./data/${dir}/${it}`));

	testFile({errors, foundryData, foundryPath, originalDatas});
}

async function pTestRoot ({errors}) {
	const dirList = fs.readdirSync(`./data/`);
	const foundryFiles = dirList.filter(it => it.startsWith("foundry-") && it.endsWith(".json"));

	for (const foundryFile of foundryFiles) {
		const foundryPath = `./data/${foundryFile}`;
		const foundryData = ut.readJson(foundryPath);
		const originalFile = foundryFile.replace(/^foundry-/i, "");
		const originalData = await pLoadData(originalFile, `./data/${originalFile}`);

		testFile({errors, foundryData, foundryPath, originalDatas: [originalData]});
	}
}

function testSpecialRaceFeatures ({foundryData, originalDatas, errors}) {
	const uidsRaceFeature = new Set();

	const HASH_BUILDER = it => UrlUtil.encodeForHash([it.name, it.source, it.raceName, it.raceSource]);

	originalDatas.forEach(originalData => {
		originalData.race.forEach(race => {
			(race.entries || []).forEach(ent => {
				const uid = HASH_BUILDER({source: race.source, ...ent, raceName: race.name, raceSource: race.source});
				uidsRaceFeature.add(uid);
			})
		});
	})

	foundryData.raceFeature.forEach(raceFeature => {
		const uid = HASH_BUILDER(raceFeature);
		if (!uidsRaceFeature.has(uid)) errors.push(`\tRace feature "${uid}" not found!`);
	});
}

function testFile ({foundryPath, foundryData, originalDatas, errors}) {
	Object.entries(foundryData)
		.forEach(([prop, arr]) => {
			if (SPECIAL_PROPS[prop]) return SPECIAL_PROPS[prop]({foundryPath, foundryData, originalDatas, errors});

			if (!(arr instanceof Array)) return;
			if (originalDatas.every(originalData => !originalData[prop] || !(originalData[prop] instanceof Array))) return console.warn(`\tUntested prop "${prop}" in file ${foundryPath}`);

			arr.forEach(it => {
				const match = originalDatas.first(originalData => originalData[prop].find(og => og.name === it.name && og.source === it.source));
				if (!match) {
					const hash = UrlUtil.URL_TO_HASH_BUILDER[prop](it);
					errors.push(`\t"${prop}" ${it.name} (${it.source}) ("${hash}") not found!`)
				}
			});
		});
}

const SPECIAL_PROPS = {
	"raceFeature": testSpecialRaceFeatures,
};

async function main () {
	const errors = [];

	testClasses({errors});
	await pTestDir({dir: "spells", errors});
	await pTestRoot({errors});

	if (!errors.length) console.log("##### Foundry Tests Passed #####");
	else {
		console.error("Foundry data errors:");
		errors.forEach(err => console.error(err));
	}
	return !errors.length;
}

module.exports = main();
