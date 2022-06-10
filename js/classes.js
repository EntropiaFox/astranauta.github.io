"use strict";

class ClassesPage extends MixinComponentGlobalState(BaseComponent) {
	static _ascSortSubclasses (scA, scB) {
		return SortUtil.ascSortLower(scA.name, scB.name);
	}

	static _fnSortSubclassFilterItems (a, b) {
		if (a.values.isAlwaysVisible) return 1;
		else if (b.values.isAlwaysVisible) return -1;
		else return SortUtil.listSort(a, b, {sortBy: "shortName"});
	}

	static getBtnTitleSubclass (sc) {
		const titlePartReprint = sc.isReprinted ? " (this subclass has been reprinted in a more recent source)" : "";
		const sourcePart = Renderer.utils.getSourceAndPageText(sc);
		return `${sc.name}; Source: ${sourcePart}${titlePartReprint}`;
	}

	static getBaseShortName (sc) {
		const re = new RegExp(`\\((UA|${sc.source})\\)$`);
		return sc.shortName.trim().replace(re, "").trim();
	}

	constructor () {
		super();
		// Don't include classId in the main state/proxy, as we want special handling for it as the main hash part
		this.__classId = {_: 0};
		this._classId = this._getProxy("classId", this.__classId);

		this._list = null;
		this._ixData = 0;
		this._dataList = [];
		this._lastScrollFeature = null;
		this._outlineData = {};
		this._pageFilter = new PageFilterClasses();

		// region subclass list/filter
		this._listSubclass = null;
		// endregion

		this._fnTableHandleFilterChange = null;
		this._$wrpOutline = null;
		this._fnOutlineHandleFilterChange = null;
		this._$trNoContent = null;

		// region alternate views
		this._subclassComparisonView = null;
		this._classBookView = null;
		// endregion

		// region Active class data filtering
		this._activeClassDataFiltered = null;
		// endregion
	}

	get activeClass () {
		if (this._activeClassDataFiltered) return this._activeClassDataFiltered;
		return this.activeClassRaw;
	}
	get activeClassRaw () { return this._dataList[this._classId._]; }

	get filterBox () { return this._pageFilter.filterBox; }

	async pOnLoad () {
		this._$pgContent = $(`#pagecontent`);

		await BrewUtil2.pInit();
		await ExcludeUtil.pInitialise();
		Omnisearch.addScrollTopFloat();
		const data = await DataUtil.class.loadJSON();

		this._list = ListUtil.initList({listClass: "classes", isUseJquery: true, isBindFindHotkey: true});
		ListUtil.setOptions({primaryLists: [this._list]});
		SortUtil.initBtnSortHandlers($("#filtertools"), this._list);

		await this._pageFilter.pInitFilterBox({
			$iptSearch: $(`#lst__search`),
			$wrpFormTop: $(`#filter-search-group`),
			$btnReset: $(`#reset`),
		});

		this._addData(data);

		const homebrew = await BrewUtil2.pGetBrewProcessed();
		await this._pHandleBrew(homebrew);

		this._pageFilter.trimState();

		ManageBrewUi.bindBtnOpen($(`#manage-brew`));
		await ListUtil.pLoadState();
		RollerUtil.addListRollButton(true);

		window.onhashchange = this._handleHashChange.bind(this);

		this._list.init();

		$(`.initial-message`).text(`Select a class from the list to view it here`);

		// Silently prepare our initial state
		this._setClassFromHash(Hist.initialLoad);
		this._setStateFromHash(Hist.initialLoad);

		await this._pInitAndRunRender();

		ListPage._checkShowAllExcluded(this._dataList, this._$pgContent);
		this._initLinkGrabbers();
		this._initScrollToSubclassSelection();
		UrlUtil.bindLinkExportButton(this.filterBox, $(`#btn-link-export`));
		this._doBindBtnSettingsSidebar();

		Hist.initialLoad = false;

		// Finally, ensure the hash correctly matches the state
		this._setHashFromState(true);

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	async _pHandleBrew (homebrew) {
		const {class: rawClassData, subclass: rawSubclassData} = homebrew;
		const cpy = MiscUtil.copy({class: rawClassData, subclass: rawSubclassData});
		if (cpy.class) for (let i = 0; i < cpy.class.length; ++i) cpy.class[i] = await DataUtil.class.pGetDereferencedClassData(cpy.class[i]);
		if (cpy.subclass) for (let i = 0; i < cpy.subclass.length; ++i) cpy.subclass[i] = await DataUtil.class.pGetDereferencedSubclassData(cpy.subclass[i]);

		const {isAddedAnyClass, isAddedAnySubclass} = this._addData(cpy);

		if (isAddedAnySubclass && !Hist.initialLoad) await this._pDoRender();
	}

	_addData (data) {
		let isAddedAnyClass = false;
		let isAddedAnySubclass = false;
		if (data.class && data.class.length) (isAddedAnyClass = true) && this._addData_addClassData(data);
		if (data.subclass && data.subclass.length) (isAddedAnySubclass = true) && this._addData_addSubclassData(data);

		const walker = MiscUtil.getWalker({
			keyBlacklist: MiscUtil.GENERIC_WALKER_ENTRIES_KEY_BLACKLIST,
			isNoModification: true,
		});

		// region Add to filters, and handle post-subclass-load mutations
		this._dataList.forEach(cls => {
			this._pageFilter.constructor.mutateForFilters(cls);

			// Force data on any classes with unusual sources to behave as though they have normal sources
			if (SourceUtil.isNonstandardSource(cls.source) || BrewUtil2.hasSourceJson(cls.source)) {
				if (cls.fluff) cls.fluff.filter(f => f.source === cls.source).forEach(f => f._isStandardSource = true);
				cls.subclasses.filter(sc => sc.source === cls.source).forEach(sc => sc._isStandardSource = true);
			}

			// Add "reprinted" flags to subclass features of reprinted subclasses, to use when coloring headers
			if (cls.subclasses?.length) {
				cls.subclasses
					.filter(sc => sc.isReprinted && sc.subclassFeatures?.length)
					.forEach(sc => {
						walker.walk(
							sc.subclassFeatures,
							{
								object: (obj) => {
									if (obj.level == null) return;
									obj.isReprinted = true;
								},
							},
						);
					});
			}

			const isExcluded = ExcludeUtil.isExcluded(UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls), "class", cls.source);

			// Build a map of subclass source => subclass name => is excluded
			const subclassExclusions = {};
			(cls.subclasses || []).forEach(sc => {
				if (isExcluded) return;

				(subclassExclusions[sc.source] = subclassExclusions[sc.source] || {})[sc.name] = subclassExclusions[sc.source][sc.name] || this.constructor.isSubclassExcluded_(cls, sc);
			});

			this._pageFilter.addToFilters(cls, isExcluded, {subclassExclusions});
		});
		// endregion

		if (isAddedAnyClass || isAddedAnySubclass) {
			this._list.update();
			this.filterBox.render();
			this._handleFilterChange(false);

			ListUtil.setOptions({
				itemList: this._dataList,
				primaryLists: [this._list],
			});
		}

		return {isAddedAnyClass, isAddedAnySubclass};
	}

	_addData_addClassData (data) {
		data.class.filter(cls => cls.subclasses).forEach(cls => cls.subclasses.sort(ClassesPage._ascSortSubclasses));

		this._dataList.push(...data.class);

		const len = this._dataList.length;
		for (; this._ixData < len; this._ixData++) {
			const it = this._dataList[this._ixData];
			const isExcluded = ExcludeUtil.isExcluded(UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](it), "class", it.source);
			this._list.addItem(this.getListItem(it, this._ixData, isExcluded));
		}
	}

	_addData_addSubclassData (data) {
		let isBlankSourceFilter;
		if (!Hist.initialLoad) {
			isBlankSourceFilter = !this._pageFilter.sourceFilter.getValues()._isActive;
		}

		data.subclass.forEach(sc => {
			if (sc.className === VeCt.STR_GENERIC || sc.classSource === VeCt.STR_GENERIC) return;

			const cls = this._dataList.find(c => c.name.toLowerCase() === sc.className.toLowerCase() && c.source.toLowerCase() === (sc.classSource || SRC_PHB).toLowerCase());
			if (!cls) {
				JqueryUtil.doToast({
					content: `Could not add subclass; could not find class with name: ${cls.class} and source ${sc.source || SRC_PHB}`,
					type: "danger",
				});
				return;
			}

			const isExcludedClass = ExcludeUtil.isExcluded(UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls), "class", cls.source);

			(cls.subclasses = cls.subclasses || []).push(sc);
			// Don't bother checking subclass exclusion for individually-added subclasses, as they should be from homebrew
			this._pageFilter.mutateAndAddToFilters(cls, isExcludedClass);
			cls.subclasses.sort(ClassesPage._ascSortSubclasses);
		});

		// If we load a homebrew source when we have no source filters active, the homebrew source will set itself high
		//   and force itself as the only visible source. Fix it in post.
		if (isBlankSourceFilter) this._pageFilter.sourceFilter.doSetPillsClear();
	}

	_initHashAndStateSync () {
		// Wipe all hooks, as we redo them for each class render
		this._resetHooks("state");
		this._resetHooksAll("state");
		this._resetHooks("classId");
		// Don't reset hooksAll for classId, as we use this to render the class

		this._addHookAll("state", () => this._setHashFromState());
	}

	_setHashFromState (isSuppressHistory) {
		// During the initial load, force-suppress all changes
		if (isSuppressHistory === undefined) isSuppressHistory = Hist.initialLoad;

		const nxtHash = this._getHashState();
		const rawLocation = window.location.hash;
		const location = rawLocation[0] === "#" ? rawLocation.slice(1) : rawLocation;
		if (nxtHash !== location) {
			if (isSuppressHistory) Hist.replaceHistoryHash(nxtHash);
			else window.location.hash = nxtHash;
		}
	}

	_handleHashChange () {
		// Parity with the implementation in hist.js
		if (Hist.isHistorySuppressed) return Hist.setSuppressHistory(false);

		this._setClassFromHash();
		this._setStateFromHash();
	}

	_setClassFromHash (isInitialLoad) {
		const [link] = Hist.getHashParts();

		let ixToLoad;

		if (link === HASH_BLANK) ixToLoad = -1;
		else {
			const listItem = Hist.getActiveListItem(link);

			if (listItem == null) ixToLoad = -1;
			else {
				const toLoad = listItem.ix;
				if (toLoad == null) ixToLoad = -1;
				else ixToLoad = listItem.ix;
			}
		}

		if (!~ixToLoad && this._list.visibleItems.length) ixToLoad = this._list.visibleItems[0].ix;

		if (~ixToLoad) {
			const target = isInitialLoad ? this.__classId : this._classId;
			if (target._ !== ixToLoad) {
				Hist.lastLoadedId = ixToLoad;
				const cls = this._dataList[ixToLoad];
				document.title = `${cls ? cls.name : "Classes"} - 5etools`;
				target._ = ixToLoad;
			}
		} else {
			// This should never occur (failed loads should pick the first list item), but attempt to handle it semi-gracefully
			this._$pgContent.empty().append(ClassesPage._render_$getTrNoContent());
			JqueryUtil.doToast({content: "Could not find the class to load!", type: "error"});
		}
	}

	_setStateFromHash (isInitialLoad) {
		let [_, ...subs] = Hist.getHashParts();
		subs = this.filterBox.setFromSubHashes(subs);

		const target = isInitialLoad ? this.__state : this._state;

		// On changing class (class links have no state parts), clean "feature" state
		if (!subs.length) this.__state.feature = null;

		if (this._getHashState() === subs.join(HASH_PART_SEP)) return;

		const cls = this.activeClass;

		const validScLookup = {};
		cls.subclasses.forEach(sc => validScLookup[UrlUtil.getStateKeySubclass(sc)] = sc);

		// Track any incoming sources we need to filter to enable in order to display the desired subclasses
		const requiredSources = new Set();

		const seenKeys = new Set();
		subs.forEach(sub => {
			const unpacked = UrlUtil.unpackSubHash(sub);
			if (!unpacked.state) return;
			unpacked.state.map(it => {
				let [k, v] = it.split("=");
				k = k.toLowerCase();
				v = UrlUtil.mini.decompress(v);
				if (k.startsWith("sub")) { // subclass selection state keys
					if (validScLookup[k]) {
						if (target[k] !== v) target[k] = v;
						requiredSources.add(validScLookup[k].source);
						seenKeys.add(k);
					}
				} else { // known classes page state keys
					const knownKey = Object.keys(ClassesPage._DEFAULT_STATE).find(it => it.toLowerCase() === k);
					if (knownKey) {
						if (target[knownKey] !== v) target[knownKey] = v;
						seenKeys.add(knownKey);
					}
				} // else discard it
			});
		});

		Object.entries(ClassesPage._DEFAULT_STATE).forEach(([k, v]) => {
			// If we did not have a value for it, and the current state doesn't match the default, reset it
			if (!seenKeys.has(k) && v !== target[k]) target[k] = v;
		});

		if (requiredSources.size) {
			const sourceFilterValues = this._pageFilter.sourceFilter.getValues().Source;
			if (sourceFilterValues._isActive) {
				// If the filter includes "blue" values, set our sources to be included
				if (sourceFilterValues._totals.yes > 0) {
					requiredSources.forEach(source => this._pageFilter.sourceFilter.setValue(source, 1));
				} else { // if there are only "red"s active, disable them for our sources
					requiredSources.forEach(source => {
						if (sourceFilterValues[source] !== 0) this._pageFilter.sourceFilter.setValue(source, 0);
					});
				}
			}
		}

		Object.keys(validScLookup).forEach(k => {
			if (!seenKeys.has(k) && target[k]) target[k] = false;
		});

		// Run the sync in the other direction, a loop that *should* break once the hash/state match perfectly
		if (!isInitialLoad) this._setHashFromState();
	}

	/**
	 * @param [opts] Options object.
	 * @param [opts.class] Class to convert to hash.
	 * @param [opts.state] State to convert to hash.
	 */
	_getHashState (opts) {
		opts = opts || {};

		let fromState = opts.state || MiscUtil.copy(this.__state);
		let cls = opts.class || this.activeClass;

		// region class
		let primaryHash = cls ? UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls) : null;
		if (!primaryHash) {
			const firstItem = this._list.items[0];
			primaryHash = firstItem ? firstItem.values.hash : HASH_BLANK;
		}
		// endregion

		// region state
		const validScKeys = cls.subclasses.map(sc => UrlUtil.getStateKeySubclass(sc));
		const stateParts = Object.entries(fromState)
			.filter(([k, v]) => ClassesPage._DEFAULT_STATE[k] !== v) // ignore any default values
			.filter(([k, v]) => !(ClassesPage._DEFAULT_STATE[k] === undefined && !v)) // ignore any falsey values which don't have defaults
			.filter(([k]) => {
				// Filter out any junky subclasses/those from other classes
				if (!k.startsWith("sub")) return true;
				return validScKeys.includes(k);
			})
			.map(([k, v]) => `${k}=${UrlUtil.mini.compress(v)}`);
		const stateHash = stateParts.length ? UrlUtil.packSubHash("state", stateParts) : "";
		// endregion

		const hashParts = [
			primaryHash,
			stateHash,
		].filter(Boolean);
		return Hist.util.getCleanHash(hashParts.join(HASH_PART_SEP));
	}

	_initLinkGrabbers () {
		const $body = $(document.body);
		$body.on(`mousedown`, `.cls-main__linked-titles > td > * > .rd__h .entry-title-inner`, (evt) => evt.preventDefault());
		$body.on(`click`, `.cls-main__linked-titles > td > * > .rd__h .entry-title-inner`, async (evt) => {
			const $target = $(evt.target);

			if (evt.shiftKey) {
				await MiscUtil.pCopyTextToClipboard($target.text().replace(/\.$/, ""));
				JqueryUtil.showCopiedEffect($target);
			} else {
				const featureId = $target.closest(`tr`).attr("data-scroll-id");

				const curState = MiscUtil.copy(this.__state);
				curState.feature = featureId;
				const href = `${window.location.href.split("#")[0]}#${this._getHashState({state: curState})}`;

				await MiscUtil.pCopyTextToClipboard(href);
				JqueryUtil.showCopiedEffect($target, "Copied link!");
			}
		});
	}

	_initScrollToSubclassSelection () {
		const $wrp = $(`#subclasstabs`);
		$(document.body).on(`click`, `[data-jump-select-a-subclass]`, evt => {
			$wrp[0].scrollIntoView({block: "center", inline: "center"});
		});
	}

	_doBindBtnSettingsSidebar () {
		const menu = ContextUtil.getMenu([
			new ContextUtil.Action(
				"Toggle Spell Points Mode",
				() => {
					this._stateGlobal.isUseSpellPoints = !this._stateGlobal.isUseSpellPoints;
				},
			),
		]);

		$(`#btn-sidebar-settings`).click(evt => ContextUtil.pOpenMenu(evt, menu));
	}

	getListItem (cls, clsI, isExcluded) {
		const hash = UrlUtil.autoEncodeHash(cls);
		const source = Parser.sourceJsonToAbv(cls.source);

		const $lnk = $(`<a href="#${hash}" class="lst--border lst__row-inner">
			<span class="bold col-8 pl-0">${cls.name}</span>
			<span class="col-4 text-center ${Parser.sourceJsonToColor(cls.source)} pr-0" title="${Parser.sourceJsonToFull(cls.source)}" ${BrewUtil2.sourceJsonToStyle(cls.source)}>${source}</span>
		</a>`);

		const $ele = $$`<li class="lst__row ve-flex-col ${isExcluded ? "row--blacklisted" : ""}">${$lnk}</li>`;

		return new ListItem(
			clsI,
			$ele,
			cls.name,
			{
				hash,
				source,
			},
			{
				$lnk,
				entity: cls,
				isExcluded,
			},
		);
	}

	_doGenerateFilteredActiveClassData () {
		const f = this.filterBox.getValues();

		const cpyCls = MiscUtil.copy(this.activeClassRaw);

		const walker = MiscUtil.getWalker({
			keyBlacklist: MiscUtil.GENERIC_WALKER_ENTRIES_KEY_BLACKLIST,
			isAllowDeleteObjects: true,
			isDepthFirst: true,
		});

		const isUseSubclassSources = !this._pageFilter.isClassNaturallyDisplayed(f, cpyCls) && this._pageFilter.isAnySubclassDisplayed(f, cpyCls);

		cpyCls.classFeatures = cpyCls.classFeatures.map((lvlFeatures, ixLvl) => {
			return walker.walk(
				lvlFeatures,
				{
					object: (obj) => {
						if (!obj.source) return obj;
						const fText = obj.isClassFeatureVariant ? {isClassFeatureVariant: true} : null;

						const isDisplay = [obj.source, ...(obj.otherSources || []).map(it => it.source)]
							.some(src => this.filterBox.toDisplayByFilters(
								f,
								{
									filter: this._pageFilter.sourceFilter,
									value: isUseSubclassSources && src === cpyCls.source
										? this._pageFilter.getActiveSource(f)
										: src,
								},
								{
									filter: this._pageFilter.levelFilter,
									value: ixLvl + 1,
								},
								{
									filter: this._pageFilter.optionsFilter,
									value: fText,
								},
							));

						return isDisplay ? obj : null;
					},
					array: (arr) => {
						return arr.filter(it => it != null);
					},
				},
			);
		});

		(cpyCls.subclasses || []).forEach(sc => {
			sc.subclassFeatures = sc.subclassFeatures.map(lvlFeatures => {
				const level = CollectionUtil.bfs(lvlFeatures, {prop: "level"});

				return walker.walk(
					lvlFeatures,
					{
						object: (obj) => {
							if (obj.entries && !obj.entries.length) return null;
							if (!obj.source) return obj;
							const fText = obj.isClassFeatureVariant ? {isClassFeatureVariant: true} : null;

							const isDisplay = [obj.source, ...(obj.otherSources || []).map(it => it.source)]
								.some(src => this.filterBox.toDisplayByFilters(
									f,
									{
										filter: this._pageFilter.sourceFilter,
										value: src,
									},
									{
										filter: this._pageFilter.levelFilter,
										value: level,
									},
									{
										filter: this._pageFilter.optionsFilter,
										value: fText,
									},
								));

							return isDisplay ? obj : null;
						},
						array: (arr) => {
							return arr.filter(it => it != null);
						},
					},
				);
			});
		});

		this._activeClassDataFiltered = cpyCls;
	}

	_handleFilterChange (isFilterValueChange) {
		// If the filter values changes (i.e. we're not handling an initial load), mutate the state, and trigger a
		//   re-render.
		if (isFilterValueChange) {
			this._doGenerateFilteredActiveClassData();
			this._pDoSyncrinizedRender();
			return;
		}

		const f = this.filterBox.getValues();
		this._list.filter(item => this._pageFilter.toDisplay(f, item.data.entity, [], null));

		if (this._fnOutlineHandleFilterChange) this._fnOutlineHandleFilterChange();
		if (this._fnTableHandleFilterChange) this._fnTableHandleFilterChange(f);

		// Force-hide any subclasses which are filtered out
		this._proxyAssign(
			"state",
			"_state",
			"__state",
			this.activeClass.subclasses
				.filter(sc => !this._pageFilter.isSubclassVisible(f, this.activeClass, sc))
				.map(sc => UrlUtil.getStateKeySubclass(sc))
				.filter(stateKey => this._state[stateKey])
				.mergeMap(stateKey => ({[stateKey]: false})),
		);
	}

	async _pInitAndRunRender () {
		this._$wrpOutline = $(`#sticky-nav`);

		// Use hookAll to allow us to reset temp hooks on the property itself
		this._addHookAll("classId", async () => {
			this._doGenerateFilteredActiveClassData();
			await this._pDoSyncrinizedRender();
		});

		this._doGenerateFilteredActiveClassData();
		await this._pDoRender();
	}

	async _pDoSyncrinizedRender () {
		await this._pLock("render");
		try {
			await this._pDoRender();
		} finally {
			this._unlock("render");
		}
	}

	async _pDoRender () {
		// reset all hooks in preparation for rendering
		this._initHashAndStateSync();
		this.filterBox
			.off(FilterBox.EVNT_VALCHANGE)
			.on(FilterBox.EVNT_VALCHANGE, () => this._handleFilterChange(true));

		// region bind list updates
		const hkSetHref = () => {
			// defer this for performance
			setTimeout(() => {
				this._list.items
					.filter(it => it.data.$lnk)
					.forEach(it => {
						const href = `#${this._getHashState({class: it.data.entity})}`;
						it.data.$lnk.attr("href", href);
					});
			}, 5);
		};
		this._addHook("classId", "_", hkSetHref);
		this._addHookAll("state", hkSetHref);
		hkSetHref();
		// endregion

		// region rendering
		this._render_renderClassTable();
		this._render_renderSidebar();
		await this._render_pRenderSubclassTabs();
		this._render_renderClassContent();
		this._render_renderOutline();
		this._render_renderAltViews();
		// endregion

		// region state handling
		const hkScrollToFeature = () => {
			// `state.feature` is set by clicking links in the class feature table
			if (this._state.feature) {
				// track last scrolled, otherwise *any* further hash/state change will cause us to scroll
				if (this._lastScrollFeature === this._state.feature) return;
				this._lastScrollFeature = this._state.feature;

				const $scrollTo = $(`[data-scroll-id="${this._state.feature}"]`);
				if (!$scrollTo[0]) {
					// This should never occur, but just in case, clean up
					this._state.feature = null;
					this._lastScrollFeature = null;
				} else {
					setTimeout(() => $scrollTo[0].scrollIntoView(), 100);
				}
			}
		};
		this._addHookBase("feature", hkScrollToFeature);
		hkScrollToFeature();

		const hkDisplayFluff = () => $(`.cls-main__cls-fluff`).toggleVe(!!this._state.isShowFluff);
		this._addHookBase("isShowFluff", hkDisplayFluff);
		MiscUtil.pDefer(hkDisplayFluff);

		const hkletDoToggleNoneSubclassMessages = (cntDisplayedSubclasses) => $(`[data-subclass-none-message]`).toggleVe(!cntDisplayedSubclasses && !this._state.isHideFeatures);

		const hkDisplayFeatures = () => {
			const cntDisplayedSubclasses = this.activeClass.subclasses.map(sc => Number(this._state[UrlUtil.getStateKeySubclass(sc)] || false)).sum();

			const $dispClassFeatures = $(`[data-feature-type="class"]`);
			const $dispFeaturesSubclassHeader = $(`[data-feature-type="gain-subclass"]`);

			if (this._state.isHideFeatures) {
				if (this._isAnySubclassActive()) {
					this._$wrpOutline.toggleVe(true);
					this._$trNoContent.toggleVe(false);
					$dispClassFeatures.toggleVe(false);
					$dispFeaturesSubclassHeader.toggleVe(true);
				} else {
					this._$wrpOutline.toggleVe(false);
					this._$trNoContent.toggleVe(true);
					$dispClassFeatures.toggleVe(false);
					$dispFeaturesSubclassHeader.toggleVe(false);
				}
			} else {
				this._$wrpOutline.toggleVe(true);
				this._$trNoContent.toggleVe(false);
				$dispClassFeatures.toggleVe(true);
				$dispFeaturesSubclassHeader.toggleVe(true);
			}

			hkletDoToggleNoneSubclassMessages(cntDisplayedSubclasses);
		};
		this._addHookBase("isHideFeatures", hkDisplayFeatures);
		MiscUtil.pDefer(hkDisplayFeatures);

		const cls = this.activeClass;

		// If multiple subclasses are displayed, show name prefixes
		const hkIsShowNamePrefixes = () => {
			const cntDisplayedSubclasses = cls.subclasses.map(sc => Number(this._state[UrlUtil.getStateKeySubclass(sc)] || false)).sum();
			$(`[data-subclass-name-prefix]`).toggleVe(cntDisplayedSubclasses > 1);

			hkletDoToggleNoneSubclassMessages(cntDisplayedSubclasses);
		};
		const hkIsShowNamePrefixesThrottled = MiscUtil.throttle(hkIsShowNamePrefixes, 50);
		MiscUtil.pDefer(() => hkIsShowNamePrefixesThrottled);

		cls.subclasses
			.map(sc => {
				let isFirstRun = true;
				const stateKey = UrlUtil.getStateKeySubclass(sc);

				const hkDisplaySubclass = () => {
					isFirstRun = false;

					const isVisible = this._state[stateKey];
					$(`[data-subclass-id="${stateKey}"]`).toggleVe(!!isVisible);

					if (!isFirstRun) hkIsShowNamePrefixes();
				};
				this._addHookBase(stateKey, hkDisplaySubclass);

				// Check/update main feature display here, as if there are no subclasses active we can hide more
				this._addHookBase(stateKey, hkDisplayFeatures);
				MiscUtil.pDefer(hkDisplaySubclass);
			});
		// endregion

		this._handleFilterChange(false);
	}

	_isAnySubclassActive () { return !!this._getActiveSubclasses().length; }

	_getActiveSubclasses (asStateKeys) {
		const cls = this.activeClass;
		return cls.subclasses
			.filter(sc => this._state[UrlUtil.getStateKeySubclass(sc)])
			.map(sc => asStateKeys ? UrlUtil.getStateKeySubclass(sc) : sc);
	}

	_render_renderClassTable () {
		const $wrpTblClass = $(`#classtable`).empty();
		const cls = this.activeClass;

		Renderer.get().resetHeaderIndex();

		const $tblGroupHeaders = [];
		const $tblHeaders = [];

		if (cls.classTableGroups) {
			cls.classTableGroups.forEach(tableGroup => this._render_renderClassTable_renderTableGroupHeader({$tblGroupHeaders, $tblHeaders, tableGroup}));
		}

		cls.subclasses.forEach(sc => {
			if (!sc.subclassTableGroups) return;
			const stateKey = UrlUtil.getStateKeySubclass(sc);
			sc.subclassTableGroups.forEach(tableGroup => this._render_renderClassTable_renderTableGroupHeader({$tblGroupHeaders, $tblHeaders, tableGroup, stateKey}));
		});

		const metasTblRows = this._render_renderClassTable_getMetasTblRows({
			cls,
		});

		this._fnTableHandleFilterChange = (f) => {
			const cpyCls = MiscUtil.copy(this.activeClassRaw);
			const isUseSubclassSources = !this._pageFilter.isClassNaturallyDisplayed(f, cpyCls) && this._pageFilter.isAnySubclassDisplayed(f, cpyCls);

			metasTblRows.forEach(metaTblRow => {
				metaTblRow.metasFeatureLinks.forEach(metaFeatureLink => {
					if (metaFeatureLink.source) {
						const isHidden = ![metaFeatureLink.source, ...(metaFeatureLink.otherSources || []).map(it => it.source)]
							.some(src => this.filterBox.toDisplayByFilters(
								f,
								{
									filter: this._pageFilter.sourceFilter,
									value: isUseSubclassSources && src === cpyCls.source
										? this._pageFilter.getActiveSource(f)
										: src,
								},
								{
									filter: this._pageFilter.levelFilter,
									value: metaTblRow.level,
								},
							));
						metaFeatureLink.isHidden = isHidden;
						metaFeatureLink.$wrpLink.toggleVe(!isHidden);
					}
				});

				metaTblRow.metasFeatureLinks.forEach(metaFeatureLink => metaFeatureLink.$dispComma.toggleVe(true));
				const lastVisible = metaTblRow.metasFeatureLinks.filter(metaFeatureLink => !metaFeatureLink.isHidden).last();
				if (lastVisible) lastVisible.$dispComma.hideVe();
			});
		};

		$$`<table class="cls-tbl shadow-big w-100 mb-2">
			<tbody>
			<tr><th class="border" colspan="15"></th></tr>
			<tr><th class="cls-tbl__disp-name" colspan="15">${cls.name}</th></tr>
			<tr>
				<th colspan="3"/> <!-- spacer to match the 3 default cols (level, prof, features) -->
				${$tblGroupHeaders}
			</tr>
			<tr>
				<th class="cls-tbl__col-level">Level</th>
				<th class="cls-tbl__col-prof-bonus">Proficiency Bonus</th>
				<th>Features</th>
				${$tblHeaders}
			</tr>
			${metasTblRows.map(it => it.$row)}
			<tr><th class="border" colspan="15"></th></tr>
			</tbody>
		</table>`.appendTo($wrpTblClass);
		$wrpTblClass.showVe();
	}

	_render_renderClassTable_renderTableGroupHeader (
		{
			$tblGroupHeaders,
			$tblHeaders,
			tableGroup,
			stateKey,
		},
	) {
		const colLabels = tableGroup.colLabels;

		// Render titles (top section)
		const $thGroupHeader = tableGroup.title
			? $(`<th class="cls-tbl__col-group" colspan="${colLabels.length}">${tableGroup.title}</th>`)
			// if there's no title, add a spacer
			: $(`<th colspan="${colLabels.length}"/>`);
		$tblGroupHeaders.push($thGroupHeader);

		// Render column headers (bottom section)
		const $tblHeadersGroup = colLabels
			.map(lbl => {
				const $tblHeader = $(`<th class="cls-tbl__col-generic-center"><div class="cls__squash_header"></div></th>`)
					.fastSetHtml(Renderer.get().render(lbl));
				$tblHeaders.push($tblHeader);
				return $tblHeader;
			});

		// region If it's a "spell progression" group, i.e. one that can be switched for a "Spell Points" column, add
		//   appropriate handling.
		let $thGroupHeaderSpellPoints = null;
		let $tblHeaderSpellPoints = null;
		if (tableGroup.rowsSpellProgression) {
			// This is always a "spacer"
			$thGroupHeaderSpellPoints = $(`<th colspan="1" class="cls-tbl__cell-spell-points"></th>`);
			$tblGroupHeaders.push($thGroupHeaderSpellPoints);

			$tblHeaderSpellPoints = $(`<th class="cls-tbl__col-generic-center cls-tbl__cell-spell-points"><div class="cls__squash_header"></div></th>`)
				.fastSetHtml(Renderer.get().render(`{@variantrule Spell Points}`));
			$tblHeaders.push($tblHeaderSpellPoints);

			const $elesDefault = [$thGroupHeader, ...$tblHeadersGroup];
			const $elesSpellPoints = [$thGroupHeaderSpellPoints, $tblHeaderSpellPoints];

			const hkSpellPoints = () => {
				$elesDefault.forEach($it => $it.toggleClass(`cls-tbl__cell-spell-progression--spell-points-enabled`, this._stateGlobal.isUseSpellPoints));
				$elesSpellPoints.forEach($it => $it.toggleClass(`cls-tbl__cell-spell-points--spell-points-enabled`, this._stateGlobal.isUseSpellPoints));
			};
			this._addHookGlobal("isUseSpellPoints", hkSpellPoints);
			hkSpellPoints();
		}
		// endregion

		// If there is a state key, this is a subclass table group, and may therefore need to be hidden
		if (!stateKey) return;
		const $elesSubclass = [
			$thGroupHeader,
			...$tblHeadersGroup,
			$thGroupHeaderSpellPoints,
			$tblHeaderSpellPoints,
		].filter(Boolean);

		const hkShowHide = () => $elesSubclass.forEach($ele => $ele.toggleVe(!!this._state[stateKey]));
		this._addHookBase(stateKey, hkShowHide);
		MiscUtil.pDefer(hkShowHide);
	}

	_render_renderClassTable_getMetasTblRows (
		{
			cls,
		},
	) {
		return cls.classFeatures.map((lvlFeatures, ixLvl) => {
			const pb = Math.ceil((ixLvl + 1) / 4) + 1;

			const lvlFeaturesFilt = lvlFeatures
				.filter(it => it.name && it.type !== "inset"); // don't add inset entry names to class table

			const metasFeatureLinks = lvlFeaturesFilt
				.map((it, ixFeature) => {
					const featureId = `${ixLvl}-${ixFeature}`;

					const $lnk = $(`<a>${it._displayNameTable || it._displayName || it.name}</a>`)
						.click(() => {
							this._lastScrollFeature = null;
							this._state.feature = null;
							this._state.feature = featureId;
						});

					const hkSetHref = () => {
						// defer this for performance
						setTimeout(() => {
							// these will modify this._state.feature when clicked
							const curState = MiscUtil.copy(this.__state);
							curState.feature = featureId;
							const href = `#${this._getHashState({state: curState})}`;
							$lnk.attr("href", href);
						}, 5);
					};
					this._addHookAll("state", hkSetHref);
					hkSetHref();

					// Make a dummy for the last item
					const $dispComma = ixFeature === lvlFeaturesFilt.length - 1 ? $(`<span/>`) : $(`<span class="mr-1">,</span>`);
					return {
						$wrpLink: $$`<div class="inline-block">${$lnk}${$dispComma}</div>`,
						$dispComma,
						source: it.source,
						otherSources: it.otherSources,
						isHidden: false,
					};
				});

			const $ptTableGroups = [];

			if (cls.classTableGroups) {
				const $cells = cls.classTableGroups
					.map(tableGroup => this._render_renderClassTable_renderTableGroupRow({tableGroup, ixLvl}))
					.flat();
				Array.prototype.push.apply($ptTableGroups, $cells);
			}

			cls.subclasses.forEach(sc => {
				if (!sc.subclassTableGroups) return;
				const stateKey = UrlUtil.getStateKeySubclass(sc);
				const $cells = sc.subclassTableGroups
					.map(tableGroup => this._render_renderClassTable_renderTableGroupRow({tableGroup, stateKey, ixLvl}))
					.flat();
				Array.prototype.push.apply($ptTableGroups, $cells);
			});

			return {
				$row: $$`<tr class="cls-tbl__stripe-odd">
					<td class="cls-tbl__col-level">${Parser.getOrdinalForm(ixLvl + 1)}</td>
					<td class="cls-tbl__col-prof-bonus">+${pb}</td>
					<td>${metasFeatureLinks.length ? metasFeatureLinks.map(it => it.$wrpLink) : `\u2014`}</td>
					${$ptTableGroups}
				</tr>`,
				metasFeatureLinks,
				level: ixLvl + 1,
			};
		});
	}

	_render_renderClassTable_renderTableGroupRow (
		{
			ixLvl,
			tableGroup,
			stateKey,
		},
	) {
		const $cells = tableGroup.rowsSpellProgression?.[ixLvl]
			? this._render_renderClassTable_$getSpellProgressionCells({ixLvl, tableGroup})
			: this._render_renderClassTable_$getGenericRowCells({ixLvl, tableGroup});

		if (!stateKey) return $cells;

		// If there is a state key, this is a subclass table group, and may therefore need to be hidden
		const hkShowHide = () => $cells.forEach($cell => $cell.toggleVe(!!this._state[stateKey]));
		this._addHookBase(stateKey, hkShowHide);
		MiscUtil.pDefer(hkShowHide); // saves ~10ms

		return $cells;
	}

	_render_renderClassTable_$getGenericRowCells (
		{
			ixLvl,
			tableGroup,
			propRows = "rows",
		},
	) {
		const row = tableGroup[propRows][ixLvl] || [];
		return row.map(cell => {
			const td = e_({
				tag: "td",
				clazz: "cls-tbl__col-generic-center",
				html: cell === 0 ? "\u2014" : Renderer.get().render(cell),
			});
			return $(td);
		});
	}

	_render_renderClassTable_$getSpellProgressionCells (
		{
			ixLvl,
			tableGroup,
		},
	) {
		const $cellsDefault = this._render_renderClassTable_$getGenericRowCells({
			ixLvl,
			tableGroup,
			propRows: "rowsSpellProgression",
		});

		const row = tableGroup.rowsSpellProgression[ixLvl] || [];

		const spellPoints = row
			.map((countSlots, ix) => {
				const spellLevel = ix + 1;
				return Parser.spLevelToSpellPoints(spellLevel) * countSlots;
			})
			.sum();

		const $cellSpellPoints = $(e_({
			tag: "td",
			clazz: "cls-tbl__col-generic-center cls-tbl__cell-spell-points",
			html: spellPoints === 0 ? "\u2014" : spellPoints,
		}));

		const hkSpellPoints = () => {
			$cellsDefault.forEach($it => $it.toggleClass(`cls-tbl__cell-spell-progression--spell-points-enabled`, this._stateGlobal.isUseSpellPoints));
			$cellSpellPoints.toggleClass(`cls-tbl__cell-spell-points--spell-points-enabled`, this._stateGlobal.isUseSpellPoints);
		};
		this._addHookGlobal("isUseSpellPoints", hkSpellPoints);
		hkSpellPoints();

		return [
			...$cellsDefault,
			$cellSpellPoints,
		];
	}

	_render_renderSidebar () {
		const $wrpSidebar = $(`#statsprof`).empty();
		const cls = this.activeClass;

		const $btnToggleSidebar = $(`<div class="cls-side__btn-toggle">[\u2012]</div>`)
			.click(() => this._state.isHideSidebar = !this._state.isHideSidebar);
		const hkSidebarHidden = () => {
			$btnToggleSidebar.text(this._state.isHideSidebar ? `[+]` : `[\u2012]`);
			$(`.cls-side__show-hide`).toggle(!this._state.isHideSidebar);
		};
		this._addHookBase("isHideSidebar", hkSidebarHidden);
		// (call the hook later)

		const $btnSendToFoundry = ExtensionUtil.ACTIVE ? $(Renderer.utils.getBtnSendToFoundryHtml({isMb: false})) : null;
		const dataPartSendToFoundry = `data-page="${UrlUtil.PG_CLASSES}" data-source="${cls.source.qq()}" data-hash="${UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES](cls).qq()}"`;

		// region Requirements
		const $getRenderedRequirements = (requirements, intro = null) => {
			const renderPart = (obj, joiner = ", ") => Object.keys(obj).filter(k => Parser.ABIL_ABVS.includes(k)).sort(SortUtil.ascSortAtts).map(k => `${Parser.attAbvToFull(k)} ${obj[k]}`).join(joiner);
			const orPart = requirements.or ? requirements.or.map(obj => renderPart(obj, " or ")).join("; ") : "";
			const basePart = renderPart(requirements);
			const abilityPart = [orPart, basePart].filter(Boolean).join("; ");

			const allEntries = [
				abilityPart ? `{@b Ability Score Minimum:} ${abilityPart}` : null,
				...requirements.entries || [],
			].filter(Boolean);

			return $$`<div>${Renderer.get().setFirstSection(true).render({type: "section", entries: allEntries})}</div>`;
		};

		let $ptRequirements = null;
		if (cls.requirements) {
			const $ptPrereq = $getRenderedRequirements(cls.requirements);

			$ptRequirements = $$`<tr class="cls-side__show-hide">
				<td class="cls-side__section" colspan="6">
					<h5 class="cls-side__section-head">Prerequisites</h5>
					${$ptPrereq}
				</td>
			</tr>`;
		}
		// endregion

		// region HP/hit dice
		let $ptHp = null;
		if (cls.hd) {
			const hdEntry = Renderer.class.getHitDiceEntry(cls.hd);

			$ptHp = `<tr class="cls-side__show-hide">
				<td colspan="6" class="cls-side__section">
					<h5 class="cls-side__section-head">Hit Points</h5>
					<div><strong>Hit Dice:</strong> ${Renderer.getEntryDice(hdEntry, "Hit die")}</div>
					<div><strong>Hit Points at 1st Level:</strong> ${Renderer.class.getHitPointsAtFirstLevel(cls.hd)}</div>
					<div><strong>Hit Points at Higher Levels:</strong> ${Renderer.class.getHitPointsAtHigherLevels(cls.name, cls.hd, hdEntry)}</div>
				</td>
			</tr>`;
		}
		// endregion

		// region Starting proficiencies
		const profs = cls.startingProficiencies || {};
		// endregion

		// region Starting equipment
		let $ptEquipment = null;
		if (cls.startingEquipment) {
			const equip = cls.startingEquipment;
			const rendered = [
				equip.additionalFromBackground ? "<p>You start with the following items, plus anything provided by your background.</p>" : "",
				equip.default && equip.default.length ? `<ul class="pl-4"><li>${equip.default.map(it => Renderer.get().render(it)).join("</li><li>")}</ul>` : "",
				equip.goldAlternative != null ? `<p>Alternatively, you may start with ${Renderer.get().render(equip.goldAlternative)} gp to buy your own equipment.</p>` : "",
			].filter(Boolean).join("");
			const $dispRendered = $(`<div/>`);

			$ptEquipment = $$`<tr class="cls-side__show-hide">
				<td class="cls-side__section" colspan="6">
					<h5 class="cls-side__section-head">Starting Equipment</h5>
					<div>${$dispRendered}</div>
				</td>
			</tr>`;
			$dispRendered.fastSetHtml(rendered);
		}
		// endregion

		// region multiclassing
		let $ptMulticlassing = null;
		if (cls.multiclassing) {
			const mc = cls.multiclassing;

			const htmlMCcPrereqPreText = mc.requirements || mc.requirementsSpecial ? `<div>To qualify for a new class, you must meet the ${mc.requirementsSpecial ? "" : "ability score "}prerequisites for both your current class and your new one.</div>` : "";
			let $ptMcPrereq = null;
			if (mc.requirements) {
				$ptMcPrereq = $getRenderedRequirements(mc.requirements, htmlMCcPrereqPreText);
			}

			let $ptMcPrereqSpecial = null;
			if (mc.requirementsSpecial) {
				$ptMcPrereqSpecial = $$`<div>
					${mc.requirements ? "" : htmlMCcPrereqPreText}
					<b>${mc.requirements ? "Other " : ""}Prerequisites:</b> ${Renderer.get().render(mc.requirementsSpecial || "")}
				</div>`;
			}

			let $ptMcProfsIntro = null;
			let $ptMcProfsArmor = null;
			let $ptMcProfsWeapons = null;
			let $ptMcProfsTools = null;
			let $ptMcProfsSkills = null;
			if (mc.proficienciesGained) {
				$ptMcProfsIntro = $(`<div ${mc.requirements || mc.requirementsSpecial ? `class="cls-side__mc-prof-intro--requirements"` : ""}>When you gain a level in a class other than your first, you gain only some of that class's starting proficiencies.</div>`);

				if (mc.proficienciesGained.armor) $ptMcProfsArmor = $(`<div><b>Armor:</b> ${Renderer.class.getRenderedArmorProfs(mc.proficienciesGained.armor)}</div>`);

				if (mc.proficienciesGained.weapons) $ptMcProfsWeapons = $(`<div><b>Weapons:</b> ${Renderer.class.getRenderedWeaponProfs(mc.proficienciesGained.weapons)}</div>`);

				if (mc.proficienciesGained.tools) $ptMcProfsTools = $(`<div><b>Tools:</b> ${Renderer.class.getRenderedToolProfs(mc.proficienciesGained.tools)}</div>`);

				if (mc.proficienciesGained.skills) $ptMcProfsSkills = $(`<div><b>Skills:</b> ${Renderer.class.getRenderedSkillProfs(mc.proficienciesGained.skills)}</div>`);
			}

			let $ptMcEntries = null;
			if (mc.entries) {
				$ptMcEntries = $(`<div></div>`).fastSetHtml(Renderer.get().setFirstSection(true).render({type: "section", entries: mc.entries}));
			}

			$ptMulticlassing = $$`<tr class="cls-side__show-hide">
				<td class="cls-side__section" colspan="6">
					<h5 class="cls-side__section-head">Multiclassing</h5>
					${$ptMcPrereq}
					${$ptMcPrereqSpecial}
					${$ptMcEntries}
					${$ptMcProfsIntro}
					${$ptMcProfsArmor}
					${$ptMcProfsWeapons}
					${$ptMcProfsTools}
					${$ptMcProfsSkills}
				</td>
			</tr>`;
		}
		// endregion

		$$`<table class="stats shadow-big">
			<tr><th class="border" colspan="6"></th></tr>
			<tr><th colspan="6">
				<div class="split-v-center pr-1" ${dataPartSendToFoundry}>
					<div class="cls-side__name">${cls.name}</div>
					<div class="ve-flex-v-center">${$btnSendToFoundry}${$btnToggleSidebar}</div>
				</div>
			</th></tr>
			${cls.authors ? `<tr><th colspan="6">By ${cls.authors.join(", ")}</th></tr>` : ""}

			${$ptRequirements}

			${$ptHp}

			<tr class="cls-side__show-hide">
				<td colspan="6" class="cls-side__section">
					<h5 class="cls-side__section-head">Proficiencies</h5>
					<div><b>Armor:</b> <span>${profs.armor ? Renderer.class.getRenderedArmorProfs(profs.armor) : "none"}</span></div>
					<div><b>Weapons:</b> <span>${profs.weapons ? Renderer.class.getRenderedWeaponProfs(profs.weapons) : "none"}</span></div>
					<div><b>Tools:</b> <span>${profs.tools ? Renderer.class.getRenderedToolProfs(profs.tools) : "none"}</span></div>
					<div><b>Saving Throws:</b> <span>${cls.proficiency ? cls.proficiency.map(p => Parser.attAbvToFull(p)).join(", ") : "none"}</span></div>
					<div><b>Skills:</b> <span>${profs.skills ? Renderer.class.getRenderedSkillProfs(profs.skills) : "none"}</span></div>
				</td>
			</tr>

			${$ptEquipment}

			${$ptMulticlassing}

			<tr><th class="border" colspan="6"></th></tr>
		</table>`.appendTo($wrpSidebar);
		$wrpSidebar.showVe();

		MiscUtil.pDefer(hkSidebarHidden);
	}

	async _render_pRenderSubclassTabs () {
		const $wrp = $(`#subclasstabs`).empty();

		this._render_renderSubclassPrimaryControls($wrp);
		await this._render_pInitSubclassControls($wrp);
	}

	_render_renderSubclassPrimaryControls ($wrp) {
		const cls = this.activeClass;

		// region features/fluff
		const $btnToggleFeatures = ComponentUiUtil.$getBtnBool(this, "isHideFeatures", {text: "Features", activeClass: "cls__btn-cf--active", isInverted: true}).title("Toggle Class Features");

		const $btnToggleFeatureVariants = $(`<button class="btn btn-xs btn-default" title="Toggle Class Feature Options/Variants">Variants</button>`)
			.click(() => {
				const f = this.filterBox.getValues();
				const isClassFeatureVariantsDisplayed = f[this._pageFilter.optionsFilter.header].isClassFeatureVariant;
				this._pageFilter.optionsFilter.setValue("isClassFeatureVariant", !isClassFeatureVariantsDisplayed);
				this._pageFilter.filterBox.fireChangeEvent();
			});
		const hkUpdateBtnFeatureVariants = () => {
			const f = this.filterBox.getValues();
			const isClassFeatureVariantsDisplayed = f[this._pageFilter.optionsFilter.header].isClassFeatureVariant;
			$btnToggleFeatureVariants.toggleClass("active", isClassFeatureVariantsDisplayed);
		};
		this.filterBox.on(FilterBox.EVNT_VALCHANGE, () => hkUpdateBtnFeatureVariants());
		hkUpdateBtnFeatureVariants();

		const $btnToggleFluff = ComponentUiUtil.$getBtnBool(this, "isShowFluff", {text: "Info"}).title("Toggle Class Info");

		$$`<div class="ve-flex-v-center m-1 btn-group mr-3 no-shrink">${$btnToggleFeatures}${$btnToggleFeatureVariants}${$btnToggleFluff}</div>`.appendTo($wrp);
		// endregion

		// region subclasses
		const $wrpScTabs = $(`<div class="ve-flex-v-center ve-flex-wrap mr-2 w-100"/>`).appendTo($wrp);
		this._listSubclass = new List({$wrpList: $wrpScTabs, isUseJquery: true, fnSort: ClassesPage._fnSortSubclassFilterItems});

		cls.subclasses.forEach((sc, i) => {
			const listItem = this._render_getSubclassTab(cls, sc, i);
			if (!listItem) return;
			this._listSubclass.addItem(listItem);
		});

		const $dispCount = $(`<div class="text-muted m-1 cls-tabs__sc-not-shown ve-flex-vh-center"/>`);
		this._listSubclass.addItem(new ListItem(
			-1,
			$dispCount,
			null,
			{isAlwaysVisible: true},
		));

		this._listSubclass.on("updated", () => {
			$dispCount.off("click");
			if (this._listSubclass.visibleItems.length) {
				const cntNotShown = this._listSubclass.items.length - this._listSubclass.visibleItems.length;
				$dispCount.html(cntNotShown ? `<i class="clickable" title="Adjust your filters to see more.">(${cntNotShown} more not shown)</i>` : "").click(() => this._doSelectAllSubclasses());
			} else if (this._listSubclass.items.length > 1) {
				$dispCount.html(`<i class="clickable" title="Adjust your filters to see more.">(${this._listSubclass.items.length - 1} subclasses not shown)</i>`).click(() => this._doSelectAllSubclasses());
			} else $dispCount.html("");
		});

		this._listSubclass.init();
		// endregion
	}

	_doSelectAllSubclasses () {
		const cls = this.activeClass;
		const allStateKeys = cls.subclasses.map(sc => UrlUtil.getStateKeySubclass(sc));

		this._pageFilter.sourceFilter.doSetPillsClear();
		this.filterBox.fireChangeEvent();
		this._proxyAssign("state", "_state", "__state", allStateKeys.mergeMap(stateKey => ({[stateKey]: true})));
	}

	async _render_pInitSubclassControls ($wrp) {
		const cls = this.activeClass;

		const $btnSelAll = $(`<button class="btn btn-xs btn-default" title="Select All (SHIFT to include most recent UA/etc.; CTRL to select official only)"><span class="glyphicon glyphicon-check"/></button>`)
			.click(evt => {
				const allStateKeys = cls.subclasses.map(sc => UrlUtil.getStateKeySubclass(sc));
				if (evt.shiftKey) {
					this._doSelectAllSubclasses();
				} else if (evt.ctrlKey || evt.metaKey) {
					const nxtState = {};
					allStateKeys.forEach(k => nxtState[k] = false);
					this._listSubclass.visibleItems
						.filter(it => it.values.mod === "brew" || it.values.mod === "fresh")
						.map(it => it.values.stateKey)
						.forEach(stateKey => nxtState[stateKey] = true);
					this._proxyAssign("state", "_state", "__state", nxtState);
				} else {
					const nxtState = {};
					allStateKeys.forEach(k => nxtState[k] = false);
					this._listSubclass.visibleItems
						.map(it => it.values.stateKey)
						.filter(Boolean)
						.forEach(stateKey => nxtState[stateKey] = true);
					this._proxyAssign("state", "_state", "__state", nxtState);
				}
			});

		const filterSets = [
			{name: "View Official", subHashes: [], isClearSources: false},
			{name: "View Most Recent", subHashes: [], isClearSources: false, sources: {[SRC_UACFV]: 2}},
			{name: "View All", subHashes: ["flstmiscellaneous:reprinted=0"], isClearSources: true},
		];
		const setFilterSet = ix => {
			const filterSet = filterSets[ix];
			const boxSubhashes = this.filterBox.getBoxSubHashes() || [];

			const cpySubHashes = MiscUtil.copy(filterSet.subHashes);
			if (filterSet.isClearSources) {
				const classifiedSources = this._pageFilter.sourceFilter.getSources();
				const sourcePart = [...classifiedSources.official, ...classifiedSources.homebrew]
					.map(src => `${src.toUrlified()}=0`)
					.join(HASH_SUB_LIST_SEP);
				cpySubHashes.push(`flstsource:${sourcePart}`);
			} else if (filterSet.sources) {
				const sourcePartSpecified = Object.entries(filterSet.sources).map(([src, val]) => `${src.toUrlified()}=${val}`);

				const classifiedSources = this._pageFilter.sourceFilter.getSources();
				const sourcePartRest = [...classifiedSources.official, ...classifiedSources.homebrew]
					.filter(src => filterSet.sources[src] == null)
					.map(src => `${src.toUrlified()}=0`);

				const sourcePart = [...sourcePartSpecified, ...sourcePartRest].join(HASH_SUB_LIST_SEP);
				cpySubHashes.push(`flstsource:${sourcePart}`);
			}

			this.filterBox.setFromSubHashes([
				...boxSubhashes,
				...cpySubHashes,
				`flopsource:extend`,
			].filter(Boolean), {force: true});
			$selFilterPreset.val("-1");
		};
		const $selFilterPreset = $(`<select class="input-xs form-control cls-tabs__sel-preset"><option value="-1" disabled>Filter...</option></select>`)
			.change(() => {
				const val = Number($selFilterPreset.val());
				if (val == null) return;
				setFilterSet(val);
			});
		filterSets.forEach((it, i) => $selFilterPreset.append(`<option value="${i}">${it.name}</option>`));
		$selFilterPreset.val("-1");

		const $btnReset = $(`<button class="btn btn-xs btn-default" title="Reset Selection"><span class="glyphicon glyphicon-refresh"/></button>`)
			.click(() => {
				this._proxyAssign("state", "_state", "__state", cls.subclasses.mergeMap(sc => ({[UrlUtil.getStateKeySubclass(sc)]: false})));
			});

		this.filterBox.on(FilterBox.EVNT_VALCHANGE, this._handleSubclassFilterChange.bind(this));
		this._handleSubclassFilterChange();
		// Remove the temporary "hidden" class used to prevent popping
		this._listSubclass.items.forEach(it => it.ele.showVe());

		const $btnToggleSources = ComponentUiUtil.$getBtnBool(this, "isShowScSources", {$ele: $(`<button class="btn btn-xs btn-default ve-flex-1" title="Show Subclass Sources"><span class="glyphicon glyphicon-book"/></button>`)});

		const $btnShuffle = $(`<button title="Feeling Lucky?" class="btn btn-xs btn-default ve-flex-1"><span class="glyphicon glyphicon-random"/></button>`)
			.click(() => {
				if (!this._listSubclass.visibleItems.length) return JqueryUtil.doToast({content: "No subclasses to choose from!", type: "warning"});

				const doDeselAll = () => this._listSubclass.items.filter(it => it.values.stateKey).forEach(it => this._state[it.values.stateKey] = false);

				const visibleSubclassItems = this._listSubclass.visibleItems.filter(it => it.values.stateKey);
				const activeKeys = Object.keys(this._state).filter(it => it.startsWith("sub") && this._state[it]);
				const visibleActiveKeys = this._listSubclass.visibleItems.filter(it => it.values.stateKey).map(it => it.values.stateKey).filter(it => activeKeys.includes(it));

				// Avoid re-selecting the same option if there's only one selected, unless there is only one subclass
				if (visibleActiveKeys.length === 1 && visibleSubclassItems.length !== 1) {
					doDeselAll();
					const options = this._listSubclass.visibleItems.filter(it => it.values.stateKey).map(it => it.values.stateKey).filter(it => it !== visibleActiveKeys[0]);
					this._state[RollerUtil.rollOnArray(options)] = true;
				} else {
					doDeselAll();
					const it = RollerUtil.rollOnArray(this._listSubclass.visibleItems.filter(it => it.values.stateKey));
					this._state[it.values.stateKey] = true;
				}
			});

		$$`<div class="ve-flex-v-center m-1 no-shrink">${$selFilterPreset}</div>`.appendTo($wrp);
		$$`<div class="ve-flex-v-center m-1 btn-group no-shrink">
			${$btnSelAll}${$btnShuffle}${$btnReset}${$btnToggleSources}
		</div>`.appendTo($wrp);
	}

	_handleSubclassFilterChange () {
		const f = this.filterBox.getValues();
		this._listSubclass.filter(li => {
			if (li.values.isAlwaysVisible) return true;
			return this._pageFilter.isSubclassVisible(f, this.activeClass, li.data.entity);
		});
	}

	_render_getSubclassTab (cls, sc, ix) {
		const isExcluded = this.constructor.isSubclassExcluded_(cls, sc);

		const stateKey = UrlUtil.getStateKeySubclass(sc);
		const mod = ClassesPage.getSubclassCssMod(cls, sc);
		const clsActive = `cls__btn-sc--active-${mod}`;

		if (this._state[stateKey] == null) this._state[stateKey] = false;

		const $dispName = $(`<div title="${ClassesPage.getBtnTitleSubclass(sc)}"/>`);
		const $dispSource = $(`<div class="ml-1" title="${Parser.sourceJsonToFull(sc.source)}">(${Parser.sourceJsonToAbv(sc.source)})</div>`);
		const hkSourcesVisible = () => {
			$dispName.text(this._state.isShowScSources ? ClassesPage.getBaseShortName(sc) : sc.shortName);
			$dispSource.toggleVe(!!this._state.isShowScSources);
		};
		this._addHookBase("isShowScSources", hkSourcesVisible);
		MiscUtil.pDefer(hkSourcesVisible);

		// Initially have these "hidden," to prevent them popping out when we filter them
		const $btn = $$`<button class="btn btn-default btn-xs ve-flex-v-center m-1 ve-hidden ${sc.isReprinted ? "cls__btn-sc--reprinted" : ""}">
				${$dispName}
				${$dispSource}
			</button>`
			.click(() => this._state[stateKey] = !this._state[stateKey])
			.contextmenu(evt => {
				evt.preventDefault();
				this._state[stateKey] = !this._state[stateKey];
			});
		const hkVisible = () => $btn.toggleClass(clsActive, !!this._state[stateKey]);
		this._addHookBase(stateKey, hkVisible);
		MiscUtil.pDefer(hkVisible);

		return new ListItem(
			ix,
			$btn,
			sc.name,
			{
				source: sc.source,
				shortName: sc.shortName,
				stateKey,
				mod,
			},
			{
				isExcluded,
				entity: sc,
			},
		);
	}

	_trackOutlineFluffData (depthData) { this._outlineData.fluff = depthData; }

	_trackOutlineCfData (ixLvl, ixFeature, depthData) {
		((this._outlineData.classFeatures = (this._outlineData.classFeatures || []))[ixLvl] =
			(this._outlineData.classFeatures[ixLvl] || []))[ixFeature] =
			depthData;
	}

	_trackOutlineScData (stateKey, level, ixScFeature, depthData) {
		((this._outlineData[stateKey] = (this._outlineData[stateKey] || []))[level] =
			(this._outlineData[stateKey][level] || []))[ixScFeature] =
			depthData;
	}

	_render_renderOutline () {
		this._$wrpOutline.empty();

		// Auto-hide the outline on small screens
		if (Renderer.hover.isSmallScreen()) this._state.isHideOutline = true;

		const $dispShowHide = $(`<div class="cls-nav__disp-toggle"/>`);
		const $wrpHeadInner = $$`<div class="cls-nav__head-inner split">
			<div>Outline</div>
			${$dispShowHide}
		</div>`
			.click(() => this._state.isHideOutline = !this._state.isHideOutline);

		const $wrpHead = $$`<div class="cls-nav__head">
			${$wrpHeadInner}
			<hr class="cls-nav__hr">
		</div>`.appendTo(this._$wrpOutline);
		const $wrpBody = $(`<div class="nav-body"/>`).appendTo(this._$wrpOutline);

		const hkShowHide = () => {
			$wrpHead.toggleClass("cls-nav__head--active", !this._state.isHideOutline);
			$wrpBody.toggleVe(!this._state.isHideOutline);
			$dispShowHide.toggleClass("cls-nav__disp-toggle--active", !this._state.isHideOutline);
		};
		this._addHookBase("isHideOutline", hkShowHide);
		MiscUtil.pDefer(hkShowHide);

		const _hkRender = async () => {
			await this._pLock("render-outline");
			$wrpBody.empty();
			const filterValues = this.filterBox.getValues();
			const isUseSubclassSources = !this._pageFilter.isClassNaturallyDisplayed(filterValues, this.activeClassRaw)
				&& this._pageFilter.isAnySubclassDisplayed(filterValues, this.activeClassRaw);

			const makeItem = () => {};

			if (this._state.isShowFluff && this._outlineData.fluff) {
				this._outlineData.fluff.filter(it => it.name)
					.forEach(it => {
						this._render_renderOutline_doMakeItem({
							filterValues,
							isUseSubclassSources,
							$wrpBody,

							depthData: it,
						});
					});
			}

			if (this._state.isHideFeatures && !this._isAnySubclassActive()) {
				this._unlock("render-outline");
				return;
			}

			this.activeClass.classFeatures.forEach((lvlFeatures, ixLvl) => {
				const ptrHasHandledSubclassFeatures = {_: false};

				lvlFeatures.forEach((feature, ixFeature) => {
					this._render_renderOutline_renderFeature({
						ixLvl,
						feature,
						ixFeature,
						ptrHasHandledSubclassFeatures,

						filterValues,
						isUseSubclassSources,
						$wrpBody,
					});
				});

				// If there are out-of-sync subclass features (e.g. Stryxhaven subclasses), add a "fake" feature to compensate
				if (!ptrHasHandledSubclassFeatures._ && this.constructor._hasSubclassFeaturesAtLevel(this.activeClassRaw, ixLvl + 1)) {
					this._render_renderOutline_renderFeature({
						ixLvl,
						feature: this.constructor._getFauxGainSubclassFeatureFeature(this.activeClassRaw, ixLvl + 1),
						ixFeature: -1,
						ptrHasHandledSubclassFeatures,

						filterValues,
						isUseSubclassSources,
						$wrpBody,
					});
				}
			});

			this._unlock("render-outline");
		};
		const hkRender = MiscUtil.debounce(_hkRender, 50);
		this._addHookBase("isShowFluff", hkRender);
		this._addHookBase("isHideFeatures", hkRender);
		this.activeClass.subclasses.forEach(sc => {
			const stateKey = UrlUtil.getStateKeySubclass(sc);
			this._addHookBase(stateKey, hkRender);
		});
		this._fnOutlineHandleFilterChange = hkRender;
		MiscUtil.pDefer(hkRender);
	}

	static _hasSubclassFeaturesAtLevel (cls, level) {
		return (cls.subclasses || []).some(it => (it.subclassFeatures || []).some(lvlFeatures => lvlFeatures.some(scf => scf.level === level)));
	}

	_render_renderOutline_doMakeItem (
		{
			filterValues,
			isUseSubclassSources,
			$wrpBody,

			depthData,
			additionalCssClasses = "",
		},
	) {
		// Skip inline entries
		if (depthData.depth >= 2) return;
		// Skip filtered sources
		if (
			depthData.source
			&& !this.filterBox.toDisplayByFilters(filterValues, {filter: this._pageFilter.sourceFilter, value: isUseSubclassSources && depthData.source === this.activeClassRaw.source ? this._pageFilter.getActiveSource(filterValues) : depthData.source})
		) return;

		const displayDepth = Math.min(depthData.depth + 1, 2);
		$(`<div class="cls-nav__item cls-nav__item--depth-${displayDepth} ${additionalCssClasses}">${depthData.name}</div>`)
			.click(() => {
				const $it = $(`[data-title-index="${depthData.ixHeader}"]`);
				if ($it.get()[0]) $it.get()[0].scrollIntoView();
			})
			.appendTo($wrpBody);
	}

	_render_renderOutline_renderFeature (
		{
			ixLvl,
			feature,
			ixFeature,
			ptrHasHandledSubclassFeatures,
			$content,
			cls,

			filterValues,
			isUseSubclassSources,
			$wrpBody,
		},
	) {
		const depthData = MiscUtil.get(this._outlineData.classFeatures, ixLvl, ixFeature);

		if (!this._state.isHideFeatures && depthData) {
			depthData.filter(it => it.name).forEach(it => {
				const additionalCssClassesRaw = this._getColorStyleClasses(
					it,
					{
						isForceStandardSource: it.source === this.activeClass.source,
						prefix: "cls-nav__item--",
					},
				);

				this._render_renderOutline_doMakeItem({
					depthData: it,
					additionalCssClasses: additionalCssClassesRaw.join(" "),
					filterValues,
					isUseSubclassSources,
					$wrpBody,
				});
			});
		}

		const activeScStateKeys = this._getActiveSubclasses(true);

		if (!feature.gainSubclassFeature) return;

		if (ptrHasHandledSubclassFeatures) ptrHasHandledSubclassFeatures._ = true;

		if (activeScStateKeys.length) {
			// If we didn't render the intro for gaining a subclass feature, do so now
			if (this._state.isHideFeatures && depthData) {
				depthData.filter(it => it.name).forEach(it => {
					const additionalCssClassesRaw = this._getColorStyleClasses(
						it,
						{
							isSubclass: true,
							isForceStandardSource: true,
							prefix: "cls-nav__item--",
						},
					);

					this._render_renderOutline_doMakeItem({
						depthData: it,
						filterValues,
						isUseSubclassSources,
						$wrpBody,
					});
				});
			}

			this.activeClass.subclasses.forEach(sc => {
				const stateKey = UrlUtil.getStateKeySubclass(sc);

				if (!activeScStateKeys.includes(stateKey)) return;

				const scLvlFeatures = sc.subclassFeatures.find(it => it[0]?.level === ixLvl + 1);
				if (!scLvlFeatures) return;

				scLvlFeatures.forEach((scFeature, ixScFeature) => {
					const depthData = MiscUtil.get(this._outlineData, stateKey, scFeature.level, ixScFeature);
					depthData.filter(it => it.name).map(it => {
						const additionalCssClassesRaw = this._getColorStyleClasses(
							it,
							{
								isSubclass: true,
								isForceStandardSource: sc._isStandardSource,
								prefix: "cls-nav__item--",
							},
						);

						this._render_renderOutline_doMakeItem({
							depthData: it,
							additionalCssClasses: additionalCssClassesRaw.join(" "),
							filterValues,
							isUseSubclassSources,
							$wrpBody,
						});
					});
				});
			});
		}
	}

	static _getFauxGainSubclassFeatureFeature (cls, level) {
		return {
			name: "Subclass Feature",
			source: cls.source,
			className: cls.name,
			classSource: cls.source,
			level: level,
			entries: [
				"Depending on your choice of subclass, you may gain certain subclass features\u2014or meet prerequisites for acquiring them\u2014at this level.",
			],
			gainSubclassFeature: true,
			_isStandardSource: true,
		};
	}

	_render_renderAltViews () { // "Hitler was right"
		const cls = this.activeClass;
		const cpyCls = MiscUtil.copy(this.activeClassRaw);

		// region subclass comparison
		if (this._subclassComparisonView) this._subclassComparisonView.teardown();

		this._subclassComparisonView = new BookModeView({
			stateKey: "isViewActiveScComp",
			state: this._state,
			$openBtn: $(`#btn-comparemode`),
			$eleNoneVisible: this._render_renderAltViews_$getStgCompViewNoneVisible(),
			isHideContentOnNoneShown: true,
			isHideButtonCloseNone: true,
			pageTitle: "Subclass Comparison",
			isFlex: true,
			popTblGetNumShown: ({$wrpContent}) => {
				$wrpContent.removeClass("bkmv__wrp").addClass("h-100").addClass("ve-flex-col");
				$wrpContent.parent().addClass("stats").addClass("stats--book");

				const renderStack = [];
				const levelsWithFeatures = [
					...new Set(cls.subclasses
						.filter(it => it?.subclassFeatures?.length)
						.map(it => it.subclassFeatures.map(it => it.map(f => f.level)).flat()).flat()),
				].sort(SortUtil.ascSort);

				const filterValues = this._pageFilter.filterBox.getValues();
				const walker = MiscUtil.getWalker({keyBlacklist: MiscUtil.GENERIC_WALKER_ENTRIES_KEY_BLACKLIST, isAllowDeleteObjects: true});

				const isAnySubclassDisplayed = this._pageFilter.isAnySubclassDisplayed(filterValues, cpyCls);

				levelsWithFeatures.forEach((lvl, i) => {
					const isLastRow = i === levelsWithFeatures - 1;

					renderStack.push(`<div class="ve-flex ${isLastRow ? "mb-4" : ""}">`);
					cls.subclasses
						.filter(sc => !this.constructor.isSubclassExcluded_(cls, sc))
						.forEach((sc, ixSubclass) => {
							const mod = ClassesPage.getSubclassCssMod(cls, sc);
							renderStack.push(`<div class="mx-2 no-shrink cls-comp__wrp-features cls-main__sc-feature ${mod ? `cls-main__sc-feature--${mod}` : ""}" data-cls-comp-sc-ix="${ixSubclass}">`);
							sc.subclassFeatures
								.filter(it => it.length && it[0].level === lvl)
								.forEach(features => {
									const cpy = MiscUtil.copy(features);

									// Note that this won't affect the root feature, only those nested inside it. The root
									//   feature is filtered out elsewhere.
									walker.walk(
										cpy,
										{
											object: (obj) => {
												if (!obj.source) return obj;
												const fText = obj.isClassFeatureVariant ? {isClassFeatureVariant: true} : null;

												if (
													this.filterBox.toDisplayByFilters(
														filterValues,
														{
															filter: this._pageFilter.sourceFilter,
															value: isAnySubclassDisplayed ? cpyCls._fSourceSubclass : obj.source,
														},
														{
															filter: this._pageFilter.levelFilter,
															value: lvl,
														},
														{
															filter: this._pageFilter.optionsFilter,
															value: fText,
														},
													)
												) return obj;
												return undefined; // If it shouldn't be displayed, delete it
											},
										},
									);

									cpy.forEach(f => Renderer.get().recursiveRender(f, renderStack));
								});
							renderStack.push(`</div>`);
						});
					renderStack.push(`</div>`);

					if (!isLastRow) renderStack.push(`<hr class="hr-2 mt-3 cls-comp__hr-level"/>`);
				});
				$wrpContent.append(renderStack.join(""));

				let numShown = 0;
				cls.subclasses
					.filter(sc => !this.constructor.isSubclassExcluded_(cls, sc))
					.forEach((sc, i) => {
						const key = UrlUtil.getStateKeySubclass(sc);

						if (!this._state[key]) {
							$wrpContent.find(`[data-cls-comp-sc-ix="${i}"]`).hideVe();
						} else numShown++;
					});

				if (!numShown) $wrpContent.find(".cls-comp__hr-level").hideVe();

				return numShown;
			},
		});

		const hkToggleScOverlay = async () => {
			try {
				await this._pLock("sc-comparison");

				if (this._state.isViewActiveScComp) await this._subclassComparisonView.pOpen();
				else {
					this._subclassComparisonView.teardown();
					document.title = `${cls ? cls.name : "Classes"} - 5etools`;
				}
			} finally {
				this._unlock("sc-comparison");
			}
		};
		this._addHookBase("isViewActiveScComp", hkToggleScOverlay);
		hkToggleScOverlay();
		// endregion

		// region book view
		if (this._classBookView) this._classBookView.cleanup();
		this._classBookView = new ClassesPage.ClassBookView(this, this._pageFilter);

		const hkToggleBookOverlay = () => {
			if (this._state.isViewActiveBook) this._classBookView.open();
			else {
				this._classBookView.teardown();
				document.title = `${cls ? cls.name : "Classes"} - 5etools`;
			}
		};
		this._addHookBase("isViewActiveBook", hkToggleBookOverlay);
		hkToggleBookOverlay();
		// endregion
	}

	_render_renderAltViews_$getStgCompViewNoneVisible () {
		const $wrpRows = $(`<div class="ve-flex-col min-h-0"></div>`);

		const $btnAdjustFilters = $(`<span class="clickable help no-select" title="Click Here!">adjust your filters</span>`)
			.click(() => this.filterBox.show());
		const $dispNoneAvailable = $$`<div class="ve-small ve-muted italic">No subclasses are available. Please ${$btnAdjustFilters} first.</div>`;

		const $stgCompViewNoneVisible = $$`<div class="ve-flex-col h-100">
			<div class="mb-2 initial-message">Please select some subclasses:</div>
			${$wrpRows}
			${$dispNoneAvailable}
		</div>`;

		const onListUpdate = () => {
			const subclassStateItems = this._listSubclass.visibleItems.filter(it => it.values.stateKey);

			if (!subclassStateItems.length) {
				$wrpRows.hideVe();
				$dispNoneAvailable.showVe();
				return;
			}

			$wrpRows.showVe();
			$dispNoneAvailable.hideVe();

			$wrpRows.empty();
			const rowMetas = subclassStateItems.map(li => {
				const $cb = $(`<input type="checkbox">`);
				$$`<label class="split-v-center py-1">
					<div>${li.name}</div>
					${$cb}
				</label>`.appendTo($wrpRows);
				return {$cb, stateKey: li.values.stateKey};
			});

			const $btnSave = $(`<button class="btn btn-default mr-2">Save</button>`)
				.click(async () => {
					const nxtState = {isViewActiveScComp: false};
					const rowMetasFilt = rowMetas.filter(it => it.$cb.prop("checked"));
					if (!rowMetasFilt.length) return JqueryUtil.doToast({type: "warning", content: `Please select some subclasses first!`});

					// (We don't `false` out the other subclasses, because if we're seeing this UI there are none
					//   currently selected)
					rowMetasFilt.forEach(meta => {
						nxtState[meta.stateKey] = true;
						meta.$cb.prop("checked", false);
					});

					this._proxyAssignSimple("state", nxtState);

					// Re-open the subclass comparison view with our new content
					try {
						await this._pLock("sc-comparison");
						this._state.isViewActiveScComp = true;
					} finally {
						this._unlock("sc-comparison");
					}
				});

			const $btnClose = $(`<button class="btn btn-default">Close</button>`)
				.click(() => {
					this._subclassComparisonView.close();
				});

			$$`<div class="ve-flex-h-right mt-2">${$btnSave}${$btnClose}</div>`
				.appendTo($wrpRows);
		};
		this._listSubclass.on("updated", () => onListUpdate());
		onListUpdate();

		return $stgCompViewNoneVisible;
	}

	static getSubclassCssMod (cls, sc) {
		if (sc.source !== cls.source) {
			return BrewUtil2.hasSourceJson(sc.source)
				? "brew"
				: SourceUtil.isNonstandardSource(sc.source)
					? sc.isReprinted ? "stale" : "spicy"
					: sc.isReprinted ? "reprinted" : "fresh";
		}
		return "fresh";
	}

	_getColorStyleClasses (entry, {isForceStandardSource, prefix, isSubclass} = {}) {
		if (isSubclass) {
			if (entry.isClassFeatureVariant) {
				if (entry.source && !isForceStandardSource && BrewUtil2.hasSourceJson(entry.source)) return [`${prefix}feature-variant-brew-subclass`];
				if (entry.source && !isForceStandardSource && SourceUtil.isNonstandardSource(entry.source)) return [`${prefix}feature-variant-ua-subclass`];
				return [`${prefix}feature-variant-subclass`];
			}

			if (entry.isReprinted) {
				if (entry.source && !isForceStandardSource && BrewUtil2.hasSourceJson(entry.source)) return [`${prefix}feature-brew-subclass-reprint`];
				if (entry.source && !isForceStandardSource && SourceUtil.isNonstandardSource(entry.source)) return [`${prefix}feature-ua-subclass-reprint`];
				return [`${prefix}feature-subclass-reprint`];
			}

			if (entry.source && !isForceStandardSource && BrewUtil2.hasSourceJson(entry.source)) return [`${prefix}feature-brew-subclass`];
			if (entry.source && !isForceStandardSource && SourceUtil.isNonstandardSource(entry.source)) return [`${prefix}feature-ua-subclass`];
			return [`${prefix}feature-subclass`];
		}

		if (entry.isClassFeatureVariant) {
			if (entry.source && !isForceStandardSource && BrewUtil2.hasSourceJson(entry.source)) return [`${prefix}feature-variant-brew`];
			if (entry.source && !isForceStandardSource && SourceUtil.isNonstandardSource(entry.source)) return [`${prefix}feature-variant-ua`];
			return [`${prefix}feature-variant`];
		}

		if (entry.source && !isForceStandardSource && BrewUtil2.hasSourceJson(entry.source)) return [`${prefix}feature-brew`];
		if (entry.source && !isForceStandardSource && SourceUtil.isNonstandardSource(entry.source)) return [`${prefix}feature-ua`];
		return [];
	}

	_render_renderClassContent () {
		const $content = $(document.getElementById("pagecontent")).empty();
		const cls = this.activeClass;
		this._outlineData = {};

		// Add extra classses to our features as we render them
		Renderer.get()
			.setFnGetStyleClasses(UrlUtil.PG_CLASSES, (entry) => {
				if (typeof entry === "string") return null;

				const sc = entry.subclassShortName
					? (cls.subclasses || []).find(it => it.shortName === entry.subclassShortName && it.source === entry.subclassSource)
					: null;
				const isForceStandardSource = sc ? sc._isStandardSource : (entry.source === cls.source);

				return this._getColorStyleClasses(entry, {isSubclass: !!entry.subclassShortName, isForceStandardSource, prefix: "cls__"});
			});

		$content.append(Renderer.utils.getBorderTr());

		if (cls.fluff) {
			const depthArr = [];
			let stack = "";
			Renderer.get().setFirstSection(true);

			cls.fluff.forEach((f, i) => {
				const cpy = MiscUtil.copy(f);

				if (typeof cpy !== "string") {
					if (f.source && f.source !== cls.source && cpy.entries) cpy.entries.unshift(`{@note The following information is from ${Parser.sourceJsonToFull(f.source)}${Renderer.utils.isDisplayPage(f.page) ? `, page ${f.page}` : ""}.}`);
				}

				stack += Renderer.get().setDepthTracker(depthArr, {additionalPropsInherited: ["_isStandardSource"]}).render(cpy);
			});

			const $trFluff = $(`<tr class="cls-main__cls-fluff"><td colspan="6"/></tr>`).fastSetHtml(stack).appendTo($content);
			this._trackOutlineFluffData(depthArr);
		}

		const ptrIsFirstSubclassLevel = {_: true};
		cls.classFeatures.forEach((lvlFeatures, ixLvl) => {
			const ptrHasHandledSubclassFeatures = {_: false};

			lvlFeatures.forEach((feature, ixFeature) => {
				if (feature.source === cls.source) {
					feature = MiscUtil.copy(feature);
					feature._isStandardSource = true;
				}

				this._render_renderClassContent_renderFeature({
					ixLvl,
					feature,
					ixFeature,
					ptrHasHandledSubclassFeatures,
					ptrIsFirstSubclassLevel,
					$content,
					cls,
				});
			});

			// If there are out-of-sync subclass features (e.g. Stryxhaven subclasses), add a "fake" feature to compensate
			if (!ptrHasHandledSubclassFeatures._ && this.constructor._hasSubclassFeaturesAtLevel(cls, ixLvl + 1)) {
				this.constructor._hasSubclassFeaturesAtLevel(cls, ixLvl + 1);
				this._render_renderClassContent_renderFeature({
					ixLvl,
					feature: this.constructor._getFauxGainSubclassFeatureFeature(cls, ixLvl + 1),
					ixFeature: -1,
					ptrIsFirstSubclassLevel,
					$content,
					cls,
				});
			}
		});

		if (cls.otherSources) {
			const text = Renderer.utils.getSourceAndPageHtml(cls);
			const $trClassFeature = $(`<tr data-feature-type="class"><td colspan="6"/></tr>`)
				.fastSetHtml(`<hr class="hr-1"><b>Class source:</b> ${text}`)
				.appendTo($content);
		}

		this._$trNoContent = ClassesPage._render_$getTrNoContent().appendTo($content);

		$content.append(Renderer.utils.getBorderTr());

		Renderer.get()
			.setFnGetStyleClasses(UrlUtil.PG_CLASSES, null)
			.removePlugins("entries_namePrefix");
	}

	_render_renderClassContent_renderFeature (
		{
			ixLvl,
			feature,
			ixFeature,
			ptrHasHandledSubclassFeatures,
			ptrIsFirstSubclassLevel,
			$content,
			cls,
		},
	) {
		const depthArr = [];

		const toRenderSource = Renderer.findSource(feature);
		const $trClassFeature = Renderer.get().withPlugin({
			pluginTypes: [
				"entries_styleClass_fromSource",
				"section_styleClass_fromSource",
			],
			fnPlugin: (entryType, entry) => {
				const source = entry.source || toRenderSource;
				if (source === cls.source) return {isSkip: true};
			},
			fn: () => {
				return $(`<tr data-scroll-id="${ixLvl}-${ixFeature}" data-feature-type="class" class="cls-main__linked-titles"><td colspan="6"/></tr>`)
					.fastSetHtml(Renderer.get().setDepthTracker(depthArr, {additionalPropsInherited: ["_isStandardSource", "isClassFeatureVariant"]}).render(feature))
					.appendTo($content);
			},
		});
		this._trackOutlineCfData(ixLvl, ixFeature, depthArr);

		if (!feature.gainSubclassFeature) return;

		if (ptrHasHandledSubclassFeatures) ptrHasHandledSubclassFeatures._ = true;

		$trClassFeature.attr("data-feature-type", "gain-subclass");

		// Add a placeholder feature to display when no subclasses are active
		const $trSubclassFeature = $(`<tr class="cls-main__sc-feature" data-subclass-none-message="true"><td colspan="6"/></tr>`)
			.fastSetHtml(Renderer.get().setDepthTracker([]).render({type: "entries", entries: [{name: `{@note No Subclass Selected}`, type: "entries", entries: [`{@note <span class="clickable roller" data-jump-select-a-subclass="true">Select a subclass</span> to view its feature(s) here.}`]}]}))
			.appendTo($content);

		cls.subclasses.forEach(sc => {
			const stateKey = UrlUtil.getStateKeySubclass(sc);

			// Add any extra coloring the subclass might require
			const cssMod = `cls-main__sc-feature--${ClassesPage.getSubclassCssMod(cls, sc)}`;

			const scLvlFeatures = sc.subclassFeatures.find(it => it[0]?.level === ixLvl + 1);
			if (!scLvlFeatures) return;

			scLvlFeatures.forEach((scFeature, ixScFeature) => {
				const depthArr = [];

				const ptDate = ptrIsFirstSubclassLevel._ === true && SourceUtil.isNonstandardSource(sc.source) && Parser.sourceJsonToDate(sc.source)
					? Renderer.get().render(`{@note This subclass was published on ${DatetimeUtil.getDateStr({date: new Date(Parser.sourceJsonToDate(sc.source))})}.}`)
					: "";
				const ptSources = ptrIsFirstSubclassLevel._ === true && sc.otherSources ? `{@note {@b Subclass source:} ${Renderer.utils.getSourceAndPageHtml(sc)}}` : "";
				const toRender = (ptDate || ptSources) && scFeature.entries ? MiscUtil.copy(scFeature) : scFeature;
				if (ptDate && toRender.entries) toRender.entries.unshift(ptDate);
				if (ptSources && toRender.entries) toRender.entries.push(ptSources);

				// region Prefix subclass feature names with the subclass name, which can be shown if multiple
				//   subclasses are shown.
				let hasNamePluginRun = false;
				Renderer.get()
					.addPlugin("entries_namePrefix", function (entry) {
						if (ptrIsFirstSubclassLevel._ === true || !entry.name) return;

						if (hasNamePluginRun) return;
						hasNamePluginRun = true;

						Renderer.get().removePlugins("entries_namePrefix");
						return `<span class="ve-hidden" data-subclass-name-prefix="true">${sc.name.qq()}:</span> `;
					});
				// endregion

				const toRenderSource = Renderer.findSource(toRender);
				Renderer.get().withPlugin({
					pluginTypes: [
						"entries_styleClass_fromSource",
						"section_styleClass_fromSource",
					],
					fnPlugin: (entryType, entry) => {
						const source = entry.source || toRenderSource;
						if (source === sc.source) return {isSkip: true};
					},
					fn: () => {
						const $trSubclassFeature = $(`<tr class="cls-main__sc-feature ${cssMod}" data-subclass-id="${UrlUtil.getStateKeySubclass(sc)}"><td colspan="6"/></tr>`)
							.fastSetHtml(Renderer.get().setDepthTracker(depthArr, {additionalPropsInherited: ["_isStandardSource", "isClassFeatureVariant"]}).render(toRender))
							.appendTo($content);
					},
				});

				Renderer.get().removePlugins("entries_namePrefix");

				this._trackOutlineScData(stateKey, ixLvl + 1, ixScFeature, depthArr);
			});
		});

		ptrIsFirstSubclassLevel._ = false;
	}

	static isSubclassExcluded_ (cls, sc) {
		return ExcludeUtil.isExcluded(UrlUtil.URL_TO_HASH_BUILDER["subclass"]({name: sc.name, shortName: sc.shortName, source: sc.source, className: cls.name, classSource: cls.source}), "subclass", sc.source);
	}

	static _render_$getTrNoContent () {
		return $(`<tr class="cls-main__msg-no-content"><td colspan="6">Toggle a button to view class and subclass information</td></tr>`);
	}

	_getDefaultState () { return MiscUtil.copy(ClassesPage._DEFAULT_STATE); }
}
ClassesPage._SC_FILTER_NAMESPACE = "sctabs";
ClassesPage._DEFAULT_STATE = {
	feature: null,
	isHideSidebar: false,
	isHideFeatures: false,
	isShowFluff: false,
	isShowScSources: false,
	isViewActiveScComp: false,
	isViewActiveBook: false,
	isHideOutline: false,
	isUseSpellPoints: false,
	// N.b. ensure none of these start with the string "sub" as this prefix is used for subclass state keys e.g.
	// `"sub Berserker": false`
};

ClassesPage.ClassBookView = class {
	constructor (classPage, pageFilter) {
		this._classPage = classPage;
		this._pageFilter = pageFilter;
		this._parent = classPage.getPod();
		this._bookViewActive = false;

		this._hooks = {};

		this._$body = null;
		this._$wrpBook = null;

		$(`#btn-readmode`).off("click").on("click", () => this._parent.set("isViewActiveBook", true));
	}

	cleanup () {
		Object.entries(this._hooks).forEach(([prop, arr]) => {
			arr.forEach(hk => this._parent.removeHook(prop, hk));
		});
	}

	open () {
		if (this._bookViewActive) return;
		this._bookViewActive = true;

		const cls = this._classPage.activeClass;

		this._$body = $(document.body);
		this._$wrpBook = $(`<div class="bkmv"/>`);

		this._$body.css("overflow", "hidden");
		this._$body.addClass("bkmv-active");

		// Top bar
		const $btnClose = $(`<button class="btn btn-xs btn-danger br-0 bt-0 bb-0 btl-0 bbl-0 h-20p" title="Close"><span class="glyphicon glyphicon-remove"></span></button>`)
			.click(() => this._parent.set("isViewActiveBook", false));
		$$`<div class="bkmv__spacer-name ve-flex-h-right no-shrink">${$btnClose}</div>`.appendTo(this._$wrpBook);

		const $pnlMenu = $(`<div class="cls-bkmv__wrp-tabs ve-flex-h-center"/>`).appendTo(this._$wrpBook);

		// Main panel
		const $tblBook = $(`<table class="stats stats--book stats--book-large"/>`);
		$$`<div class="ve-flex-col overflow-y-auto container">${$tblBook}</div>`.appendTo(this._$wrpBook);

		const renderStack = [];
		Renderer.get().setFirstSection(true);
		renderStack.push(`<tr><td colspan="6" class="py-3 px-5">`);
		Renderer.get().recursiveRender({type: "section", name: cls.name}, renderStack);
		renderStack.push(`</td></tr>`);

		renderStack.push(`<tr class="text" data-cls-book-fluff="true"><td colspan="6" class="py-3 px-5">`);
		Renderer.get().setFirstSection(true);
		(cls.fluff || []).forEach((f, i) => {
			f = MiscUtil.copy(f);

			// Remove the name from the first section if it is a copy of the class name
			if (i === 0 && f.name && f.name.toLowerCase() === cls.name.toLowerCase()) {
				delete f.name;
			}

			if (f.source && f.source !== cls.source && f.entries) {
				f.entries.unshift(`{@note The following information is from ${Parser.sourceJsonToFull(f.source)}${Renderer.utils.isDisplayPage(f.page) ? `, page ${f.page}` : ""}.}`);
			}

			Renderer.get().recursiveRender(f, renderStack);
		});
		renderStack.push(`</td></tr>`);

		renderStack.push(`<tr class="text" data-cls-book-cf="true"><td colspan="6" class="py-3 px-5">`);
		cls.classFeatures.forEach(lvl => {
			lvl.forEach(cf => Renderer.get().recursiveRender(cf, renderStack));
		});
		renderStack.push(`</td></tr>`);

		cls.subclasses
			.filter(sc => !ClassesPage.isSubclassExcluded_(cls, sc))
			.forEach((sc, ixSubclass) => {
				const mod = ClassesPage.getSubclassCssMod(cls, sc);
				renderStack.push(`<tr data-cls-book-sc-ix="${ixSubclass}" class="cls-main__sc-feature ${mod ? `cls-main__sc-feature--${mod}` : ""}"><td colspan="6" class="py-3 px-5">`);
				sc.subclassFeatures.forEach(lvl => {
					lvl.forEach(f => Renderer.get().recursiveRender(f, renderStack));
				});
				renderStack.push(`</td></tr>`);
			});
		renderStack.push(Renderer.utils.getBorderTr());
		$tblBook.append(renderStack.join(""));

		// Menu panel
		const $btnToggleCf = $(`<span class="cls-bkmv__btn-tab">Features</span>`).on("click", () => {
			this._parent.set("isHideFeatures", !this._parent.get("isHideFeatures"));
		});
		const $btnToggleInfo = $(`<span class="cls-bkmv__btn-tab">Info</span>`).on("click", () => {
			this._parent.set("isShowFluff", !this._parent.get("isShowFluff"));
		});

		if (this._parent.get("isHideFeatures")) this._parent.set("isHideFeatures", false);
		if (!this._parent.get("isShowFluff")) this._parent.set("isShowFluff", true);

		$pnlMenu.append($btnToggleCf);
		$pnlMenu.append($btnToggleInfo);

		const filterValues = this._classPage.filterBox.getValues();
		cls.subclasses
			.filter(sc => !ClassesPage.isSubclassExcluded_(cls, sc))
			.forEach((sc, i) => {
				const name = sc.isReprinted ? `${ClassesPage.getBaseShortName(sc)} (${Parser.sourceJsonToAbv(sc.source)})` : sc.shortName;
				const mod = ClassesPage.getSubclassCssMod(cls, sc);
				const stateKey = UrlUtil.getStateKeySubclass(sc);

				const $btnToggleSc = $(`<span class="cls-bkmv__btn-tab ${sc.isReprinted ? "cls__btn-sc--reprinted" : ""}" title="${ClassesPage.getBtnTitleSubclass(sc)}">${name}</span>`)
					.on("click", () => this._parent.set(stateKey, !this._parent.get(stateKey)));
				const isVisible = this._pageFilter.isSubclassVisible(filterValues, cls, sc);
				if (!isVisible) $btnToggleSc.hideVe();

				const hkShowHide = () => {
					const $dispFeatures = this._$wrpBook.find(`[data-cls-book-sc-ix="${i}"]`);
					const isActive = !!this._parent.get(stateKey);
					$btnToggleSc.toggleClass(`cls__btn-sc--active-${mod}`, isActive);
					$dispFeatures.toggleVe(!!isActive);
				};
				(this._hooks[stateKey] = this._hooks[stateKey] || []).push(hkShowHide);
				this._parent.addHook(stateKey, hkShowHide);
				hkShowHide();

				$pnlMenu.append($btnToggleSc);
			});

		const hkFeatures = () => {
			const $dispFeatures = this._$wrpBook.find(`[data-cls-book-cf="true"]`);
			const isActive = !this._parent.get("isHideFeatures");
			$btnToggleCf.toggleClass("cls__btn-cf--active", isActive);
			$dispFeatures.toggleVe(!!isActive);
		};
		(this._hooks["isHideFeatures"] = this._hooks["isHideFeatures"] || []).push(hkFeatures);
		this._parent.addHook("isHideFeatures", hkFeatures);
		hkFeatures();

		const hkFluff = () => {
			const $dispFluff = this._$wrpBook.find(`[data-cls-book-fluff="true"]`);
			const isHidden = !this._parent.get("isShowFluff");
			$btnToggleInfo.toggleVe(!!isHidden);
			$dispFluff.toggleVe(!isHidden);
		};
		(this._hooks["isShowFluff"] = this._hooks["isShowFluff"] || []).push(hkFluff);
		this._parent.addHook("isShowFluff", hkFluff);
		hkFluff();

		this._$body.append(this._$wrpBook);
	}

	teardown () {
		if (this._bookViewActive) {
			this._$body.css("overflow", "");
			this._$body.removeClass("bkmv-active");
			this._$wrpBook.remove();
			this._bookViewActive = false;
		}
	}
};

const classesPage = new ClassesPage();
window.addEventListener("load", () => classesPage.pOnLoad());
