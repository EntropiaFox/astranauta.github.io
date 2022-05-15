"use strict";

const fs = require("fs");
const ut = require("./util");
require("../js/utils");
require("../js/render.js");

function cleanFolder (folder) {
	console.log(`Cleaning directory ${folder}...`);
	const files = ut.listFiles({dir: folder});
	files
		.filter(file => file.endsWith(".json"))
		.forEach(file => {
			console.log(`\tCleaning ${file}...`);
			fs.writeFileSync(file, CleanUtil.getCleanJson(ut.readJson(file), {isFast: false}), "utf-8");
		});
}

cleanFolder(`./data`);
console.log("Cleaning complete.");
