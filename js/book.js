"use strict";

const JSON_URL = "data/books.json";

window.addEventListener("load", async () => {
	BookUtil.$dispBook = $(`#pagecontent`);
	await BrewUtil2.pInit();
	ExcludeUtil.pInitialise().then(null); // don't await, as this is only used for search
	DataUtil.loadJSON(JSON_URL).then(onJsonLoad);
});

async function onJsonLoad (data) {
	BookUtil.baseDataUrl = "data/book/book-";
	BookUtil.allPageUrl = "books.html";
	BookUtil.propHomebrewData = "bookData";
	BookUtil.initLinkGrabbers();
	BookUtil.initScrollTopFloat();

	BookUtil.contentType = "book";

	BookUtil.bookIndex = data?.book || [];

	$(`.book-head-message`).text(`Select a book from the list on the left`);
	$(`.book-loading-message`).text(`Select a book to begin`);

	const brew = await BrewUtil2.pGetBrewProcessed();
	BookUtil.bookIndexBrew = brew?.book || [];

	window.onhashchange = BookUtil.booksHashChange.bind(BookUtil);
	if (window.location.hash.length) {
		BookUtil.booksHashChange();
	} else {
		$(`.contents-item`).show();
	}
	window.dispatchEvent(new Event("toolsLoaded"));
}
