"use strict";

class PageFilterObjects extends PageFilter {
	constructor () {
		super();

		this._miscFilter = new Filter({header: "Miscellaneous", items: ["SRD"], isMiscFilter: true});
	}

	static mutateForFilters (obj) {
		obj._fMisc = obj.srd ? ["SRD"] : [];
	}

	addToFilters (obj, isExcluded) {
		if (isExcluded) return;

		this._sourceFilter.addItem(obj.source);
	}

	async _pPopulateBoxOptions (opts) {
		opts.filters = [
			this._sourceFilter,
			this._miscFilter,
		];
	}

	toDisplay (values, obj) {
		return this._filterBox.toDisplay(
			values,
			obj.source,
			obj._fMisc,
		);
	}
}
