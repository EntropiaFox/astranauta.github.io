"use strict";

const JSON_URL = "data/books.json";

window.addEventListener("load", () => {
	BookUtil.$dispBook = $(`#pagecontent`);
	ExcludeUtil.pInitialise(); // don't await, as this is only used for search
	DataUtil.loadJSON(JSON_URL).then(onJsonLoad);
});

let books = [];
let bkI = 0;
function onJsonLoad (data) {
	BookUtil.baseDataUrl = "data/book/book-";
	BookUtil.allPageUrl = "books.html";
	BookUtil.homebrewIndex = "book";
	BookUtil.homebrewData = "bookData";
	BookUtil.initLinkGrabbers();
	BookUtil.initScrollTopFloat();

	BookUtil.contentType = "book";

	addBooks(data);

	$(`.book-head-message`).text(`Select a book from the list on the left`);
	$(`.book-loading-message`).text(`Select a book to begin`);

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
	addBooks(homebrew);
	return Promise.resolve();
}

function addBooks (data) {
	if (!data.book || !data.book.length) return;

	books.push(...data.book);
	BookUtil.bookIndex = books;
}
