"use strict";

const CONTENTS_URL = "data/adventures.json";

window.addEventListener("load", () => {
	BookUtil.$dispBook = $(`#pagecontent`);
	ExcludeUtil.pInitialise(); // don't await, as this is only used for search
	DataUtil.loadJSON(CONTENTS_URL).then(onJsonLoad);
});

let adventures = [];
let adI = 0;
function onJsonLoad (data) {
	BookUtil.baseDataUrl = "data/adventure/adventure-";
	BookUtil.allPageUrl = "adventures.html";
	BookUtil.homebrewIndex = "adventure";
	BookUtil.homebrewData = "adventureData";
	BookUtil.initLinkGrabbers();
	BookUtil.initScrollTopFloat();

	BookUtil.contentType = "adventure";

	addAdventures(data);

	$(`.book-head-message`).text(`Select an adventure from the list on the left`);
	$(`.book-loading-message`).text(`Select an adventure to begin`);

	window.onhashchange = BookUtil.booksHashChange.bind(BookUtil);
	BrewUtil.pAddBrewData()
		.then(handleBrew)
		.then(() => BrewUtil.pAddLocalBrewData())
		.then(() => {
			if (window.location.hash.length) {
				BookUtil.booksHashChange();
			} else {
				$(`.contents-item`).show();
			}
			window.dispatchEvent(new Event("toolsLoaded"));
		});
}

function handleBrew (homebrew) {
	addAdventures(homebrew);
	return Promise.resolve();
}

function addAdventures (data) {
	if (!data.adventure || !data.adventure.length) return;

	adventures.push(...data.adventure);
	BookUtil.bookIndex = adventures;
}
