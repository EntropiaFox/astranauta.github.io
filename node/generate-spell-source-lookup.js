// TODO this replaces `generate-subclass-lookup.js` in effect
// TODO suck `Renderer.spell.initClasses` and friends into here
// TODO make a system for generating the same data on homebrew docs
// TODO add or figure out system for "static" things?
//   - arcana cleric
//   - half-elf wizard cantrips

const fs = require("fs");
const ut = require("./util.js");
require("../js/utils");

/*

{
    "<source>": {
        "<spellName>": {
            "race": {
                "<source>": ["<base race (subrace)>", "<race>"]
            },
            "background": {
                "<source>": ["<name>"]
            },
            "subclass": {
                "<classSource>": {
                    "<className>": {
                        "<subclassSource>": ["<subclassShortName>"]
                    }
                }
            },
            ... etc. ...
        }
    }
}

*/

class AdditionalSpellSource {
	constructor ({props, file} = {}) {
		this._props = props;
		this._file = file;
	}

	async _pLoadData () {
		return DataUtil.loadJSON(`./data/${this._file}`);
	}

	async pMutLookup (lookup) {
		const data = await this._pLoadData();
		this._props.forEach(prop => {
			data[prop]
				.filter(ent => ent.additionalSpells)
				.forEach(ent => {
					ent.additionalSpells
						.forEach(addSpells => {
							// TODO
						});
				});
		});
	}
}

class AdditionalSpellSourceClassesSubclasses extends AdditionalSpellSource {
	// TODO
}

class AdditionalSpellSourceBackgrounds extends AdditionalSpellSource {
	constructor () {
		super({
			props: ["background"],
			file: "backgrounds.json",
		});
	}
}

class AdditionalSpellSourceCharCreationOptions extends AdditionalSpellSource {
	constructor () {
		super({
			props: ["charoption"],
			file: "charcreationoptions.json",
		});
	}
}

class AdditionalSpellSourceFeats extends AdditionalSpellSource {
	constructor () {
		super({
			props: ["feat"],
			file: "feats.json",
		});
	}
}

class AdditionalSpellSourceOptionalFeatures extends AdditionalSpellSource {
	constructor () {
		super({
			props: ["optionalfeature"],
			file: "optionalfeatures.json",
		});
	}
}

class AdditionalSpellSourceRaces extends AdditionalSpellSource {

}

class AdditionalSpellSourceRewards extends AdditionalSpellSource {
	constructor () {
		super({
			props: ["reward"],
			file: "rewards.json",
		});
	}
}

async function pMain () {
	ut.patchLoadJson();

	const lookup = {};

	const Clss = [
		AdditionalSpellSourceClassesSubclasses,
		AdditionalSpellSourceBackgrounds,
		AdditionalSpellSourceCharCreationOptions,
		AdditionalSpellSourceFeats,
		AdditionalSpellSourceOptionalFeatures,
		AdditionalSpellSourceRaces,
		AdditionalSpellSourceRewards,
	];
	for (const Cls of Clss) {
		const instance = new Cls();
		await instance.pMutLookup(lookup);
	}

	ut.unpatchLoadJson();

	fs.writeFileSync(`./data/generated/gendata-spell-source-lookup.json`, CleanUtil.getCleanJson(lookup, {isMinify: true}));

	console.log("Regenerated spell source lookup.");
}

pMain()
	.then(() => console.log("Done!"))
	.catch(e => { throw e; });
