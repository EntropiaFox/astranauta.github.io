"use strict";

class Blacklist {
	static async pInit () {
		const data = await BlacklistUtil.pLoadData();
		const ui = new BlacklistUi({$wrpContent: $(`#blacklist-content`), data});
		await ui.pInit();
		window.dispatchEvent(new Event("toolsLoaded"));
	}
}

window.addEventListener("load", async () => {
	await BrewUtil2.pInit();
	await ExcludeUtil.pInitialise();
	await Blacklist.pInit();
});
