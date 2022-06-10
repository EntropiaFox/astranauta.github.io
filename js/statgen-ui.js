"use strict";

class StatGenUi extends BaseComponent {
	/**
	 * @param opts
	 * @param opts.races
	 * @param opts.feats
	 * @param [opts.tabMetasAdditional]
	 * @param [opts.isCharacterMode] Disables some functionality (e.g. changing number of ability scores)
	 * @param [opts.isFvttMode]
	 * @param [opts.modalFilterRaces]
	 * @param [opts.modalFilterFeats]
	 * @param [opts.existingScores]
	 */
	constructor (opts) {
		super();
		opts = opts || {};

		TabUiUtilSide.decorate(this, {isInitMeta: true});

		this._races = opts.races;
		this._feats = opts.feats;
		this._tabMetasAdditional = opts.tabMetasAdditional;
		this._isCharacterMode = opts.isCharacterMode;
		this._isFvttMode = opts.isFvttMode;

		this._modalFilterRaces = opts.modalFilterRaces || new ModalFilterRaces({namespace: "statgen.races", isRadio: true, allData: this._races});
		this._modalFilterFeats = opts.modalFilterFeats || new ModalFilterFeats({namespace: "statgen.feats", isRadio: true, allData: this._feats});

		this._isLevelUp = !!opts.existingScores;
		this._existingScores = opts.existingScores;

		// region Rolled
		this._$rollIptFormula = null;
		// endregion

		// region Point buy
		this._compAsi = new StatGenUi.CompAsi({parent: this});
		this._pbRaceHookMetas = [];
		// endregion
	}

	get ixActiveTab () { return this._getIxActiveTab(); }
	set ixActiveTab (ix) { this._setIxActiveTab({ixActiveTab: ix}); }

	// region Expose for external use
	addHookAbilityScores (hook) { Parser.ABIL_ABVS.forEach(ab => this._addHookBase(`common_export_${ab}`, hook)); }
	addHookPulseAsi (hook) { this._addHookBase("common_pulseAsi", hook); }
	getFormDataAsi () { return this._compAsi.getFormData(); }

	getMode (ix, namespace) {
		const {propMode} = this.getPropsAsi(ix, namespace);
		return this._state[propMode];
	}

	setIxFeat (ix, namespace, ixFeat) {
		const {propMode, propIxFeat} = this.getPropsAsi(ix, namespace);

		if (ixFeat == null && (this._state[propMode] === "asi" || this._state[propMode] == null)) {
			this._state[propIxFeat] = null;
			return;
		}

		this._state[propMode] = "feat";
		this._state[propIxFeat] = ixFeat;
	}

	setIxFeatSet (namespace, ixSet) {
		const {propIxSel} = this.getPropsAdditionalFeats_(namespace);
		this._state[propIxSel] = ixSet;
	}

	setIxFeatSetIxFeats (namespace, metaFeats) {
		const nxtState = {};
		metaFeats.forEach(({ix, ixFeat}) => {
			const {propIxFeat} = this.getPropsAdditionalFeatsFeatSet_(namespace, "fromFilter", ix);
			nxtState[propIxFeat] = ixFeat;
		});
		this._proxyAssignSimple("state", nxtState);
	}

	set common_cntAsi (val) { this._state.common_cntAsi = val; }

	addHookIxRace (hook) { this._addHookBase("common_ixRace", hook); }
	get ixRace () { return this._state.common_ixRace; }
	set ixRace (ixRace) { this._state.common_ixRace = ixRace; }

	addCustomFeat () { this._state.common_cntFeatsCustom = Math.min(StatGenUi._MAX_CUSTOM_FEATS, (this._state.common_cntFeatsCustom || 0) + 1); }
	setCntCustomFeats (val) { this._state.common_cntFeatsCustom = Math.min(StatGenUi._MAX_CUSTOM_FEATS, val || 0); }
	// endregion

	// region Expose for ASI component
	get isCharacterMode () { return this._isCharacterMode; }
	get state () { return this._state; }
	get modalFilterFeats () { return this._modalFilterFeats; }
	get feats () { return this._feats; }
	addHookBase (prop, hook) { return this._addHookBase(prop, hook); }
	removeHookBase (prop, hook) { return this._removeHookBase(prop, hook); }
	proxyAssignSimple (hookProp, toObj, isOverwrite) { return this._proxyAssignSimple(hookProp, toObj, isOverwrite); }
	get race () { return this._races[this._state.common_ixRace]; }
	get isLevelUp () { return this._isLevelUp; }
	// endregion

	getTotals () {
		if (this._isLevelUp) {
			return {
				mode: "levelUp",
				totals: {
					levelUp: this._getTotals_levelUp(),
				},
			};
		}

		return {
			mode: StatGenUi.MODES[this.ixActiveTab || 0],
			totals: {
				rolled: this._getTotals_rolled(),
				array: this._getTotals_array(),
				pointbuy: this._getTotals_pb(),
				manual: this._getTotals_manual(),
			},
		};
	}

	_getTotals_rolled () { return Parser.ABIL_ABVS.mergeMap(ab => ({[ab]: this._rolled_getTotalScore(ab)})); }
	_getTotals_array () { return Parser.ABIL_ABVS.mergeMap(ab => ({[ab]: this._array_getTotalScore(ab)})); }
	_getTotals_pb () { return Parser.ABIL_ABVS.mergeMap(ab => ({[ab]: this._pb_getTotalScore(ab)})); }
	_getTotals_manual () { return Parser.ABIL_ABVS.mergeMap(ab => ({[ab]: this._manual_getTotalScore(ab)})); }
	_getTotals_levelUp () { return Parser.ABIL_ABVS.mergeMap(ab => ({[ab]: this._levelUp_getTotalScore(ab)})); }

	addHook (hookProp, prop, hook) { return this._addHook(hookProp, prop, hook); }
	addHookAll (hookProp, hook) {
		this._addHookAll(hookProp, hook);
		this._compAsi._addHookAll(hookProp, hook);
	}

	addHookActiveTag (hook) { this._addHookActiveTab(hook); }

	async pInit () {
		await this._modalFilterRaces.pPreloadHidden();
		await this._modalFilterFeats.pPreloadHidden();
	}

	getPropsAsi (ix, namespace) {
		return {
			prefix: `common_asi_${namespace}_${ix}_`,
			propMode: `common_asi_${namespace}_${ix}_mode`,
			propIxAsiPointOne: `common_asi_${namespace}_${ix}_asiPointOne`,
			propIxAsiPointTwo: `common_asi_${namespace}_${ix}_asiPointTwo`,
			propIxFeat: `common_asi_${namespace}_${ix}_ixFeat`,
			propIxFeatAbility: `common_asi_${namespace}_${ix}_ixFeatAbility`,
			propFeatAbilityChooseFrom: `common_asi_${namespace}_${ix}_featAbilityChooseFrom`,
		};
	}

	getPropsAdditionalFeats_ (namespace) {
		return {
			propPrefix: `common_additionalFeats_${namespace}_`,
			propIxSel: `common_additionalFeats_${namespace}_ixSel`,
		};
	}

	getPropsAdditionalFeatsFeatSet_ (namespace, type, ix) {
		return {
			propIxFeat: `common_additionalFeats_${namespace}_${type}_${ix}_ixFeat`,
			propIxFeatAbility: `common_additionalFeats_${namespace}_${type}_${ix}_ixFeatAbility`,
			propFeatAbilityChooseFrom: `common_additionalFeats_${namespace}_${type}_${ix}_featAbilityChooseFrom`,
		};
	}

	_roll_getRolledStats () {
		const wrpTree = Renderer.dice.lang.getTree3(this._state.rolled_formula);
		if (!wrpTree) return this._$rollIptFormula.addClass("form-control--error");

		const rolls = [];
		for (let i = 0; i < this._state.rolled_rollCount; i++) {
			const meta = {};
			meta.total = wrpTree.tree.evl(meta);
			rolls.push(meta);
		}
		rolls.sort((a, b) => SortUtil.ascSort(b.total, a.total));

		return rolls.map(r => ({total: r.total, text: (r.text || []).join("")}));
	}

	render ($parent) {
		$parent.empty().addClass("statgen");

		const iptTabMetas = this._isLevelUp
			? [
				new TabUiUtil.TabMeta({name: "Existing", icon: this._isFvttMode ? `fas fa-fw fa-user` : `far fa-fw fa-user`, hasBorder: true}),
				...this._tabMetasAdditional || [],
			]
			: [
				new TabUiUtil.TabMeta({name: "Roll", icon: this._isFvttMode ? `fas fa-fw fa-dice` : `far fa-fw fa-dice`, hasBorder: true}),
				new TabUiUtil.TabMeta({name: "Standard Array", icon: this._isFvttMode ? `fas fa-fw fa-signal` : `far fa-fw fa-signal-alt`, hasBorder: true}),
				new TabUiUtil.TabMeta({name: "Point Buy", icon: this._isFvttMode ? `fas fa-fw fa-chart-bar` : `far fa-fw fa-chart-bar`, hasBorder: true}),
				new TabUiUtil.TabMeta({name: "Manual", icon: this._isFvttMode ? `fas fa-fw fa-tools` : `far fa-fw fa-tools`, hasBorder: true}),
				...this._tabMetasAdditional || [],
			];

		const tabMetas = this._renderTabs(iptTabMetas, {$parent: this._isFvttMode ? null : $parent});
		if (this._isFvttMode) {
			if (!this._isLevelUp) {
				const {propActive: propActiveTab, propProxy: propProxyTabs} = this._getTabProps();
				const $selMode = ComponentUiUtil.$getSelEnum(
					this,
					propActiveTab,
					{
						values: iptTabMetas.map((_, ix) => ix),
						fnDisplay: ix => iptTabMetas[ix].name,
						propProxy: propProxyTabs,
					},
				)
					.addClass("max-w-200p");
				$$`<div class="ve-flex-v-center statgen-shared__wrp-header">
					<div class="mr-2"><b>Mode</b></div>
					${$selMode}
				</div>
				<hr class="hr-2">`.appendTo($parent);
			}

			tabMetas.forEach(it => it.$wrpTab.appendTo($parent));
		}

		const $wrpAll = $(`<div class="ve-flex-col w-100 h-100"></div>`);
		this._render_all($wrpAll);

		const hkTab = () => {
			tabMetas[this.ixActiveTab || 0].$wrpTab.append($wrpAll);
		};
		this._addHookActiveTab(hkTab);
		hkTab();

		this._addHookBase("common_cntAsi", () => this._state.common_pulseAsi = !this._state.common_pulseAsi);
		this._addHookBase("common_cntFeatsCustom", () => this._state.common_pulseAsi = !this._state.common_pulseAsi);
	}

	_render_$getStgRolledHeader () {
		this._$rollIptFormula = ComponentUiUtil.$getIptStr(this, "rolled_formula")
			.addClass("text-center max-w-100p")
			.keydown(evt => {
				if (evt.key === "Enter") setTimeout(() => $btnRoll.click()); // Defer to allow `.change` to fire first
			})
			.change(() => this._$rollIptFormula.removeClass("form-control--error"));

		const $iptRollCount = this._isCharacterMode ? null : ComponentUiUtil.$getIptInt(this, "rolled_rollCount", 1, {min: 1, fallbackOnNaN: 1, html: `<input type="text" class="form-control input-xs form-control--minimal text-center max-w-100p">`})
			.keydown(evt => {
				if (evt.key === "Enter") setTimeout(() => $btnRoll.click()); // Defer to allow `.change` to fire first
			})
			.change(() => this._$rollIptFormula.removeClass("form-control--error"));

		const $btnRoll = $(`<button class="btn btn-primary bold">Roll</button>`)
			.click(() => {
				this._state.rolled_rolls = this._roll_getRolledStats();
			});

		const $btnRandom = $(`<button class="btn btn-xs btn-default mt-2">Randomly Assign</button>`)
			.hideVe()
			.click(() => {
				const abs = [...Parser.ABIL_ABVS].shuffle();
				abs.forEach((ab, i) => {
					const {propAbilSelectedRollIx} = this.constructor._rolled_getProps(ab);
					this._state[propAbilSelectedRollIx] = i;
				});
			});

		const $wrpRolled = $(`<div class="ve-flex-v-center mr-auto statgen-rolled__wrp-results py-1"></div>`);
		const $wrpRolledOuter = $$`<div class="ve-flex-v-center"><div class="mr-2">=</div>${$wrpRolled}</div>`;

		const hkRolled = () => {
			$wrpRolledOuter.toggleVe(this._state.rolled_rolls.length);
			$btnRandom.toggleVe(this._state.rolled_rolls.length);

			$wrpRolled.html(this._state.rolled_rolls.map((it, i) => {
				const cntPrevRolls = this._state.rolled_rolls.slice(0, i).filter(r => r.total === it.total).length;
				return `<div class="px-3 py-1 help-subtle ve-flex-vh-center" title="${it.text}"><div class="ve-muted">[</div><div class="ve-flex-vh-center statgen-rolled__disp-result">${it.total}${cntPrevRolls ? Parser.numberToSubscript(cntPrevRolls) : ""}</div><div class="ve-muted">]</div></div>`;
			}));
		};
		this._addHookBase("rolled_rolls", hkRolled);
		hkRolled();

		return $$`<div class="ve-flex-col mb-3 mr-auto">
			<div class="ve-flex mb-2">
				<div class="ve-flex-col ve-flex-h-center mr-3">
					<label class="ve-flex-v-center"><div class="mr-2 no-shrink w-100p">Formula:</div>${this._$rollIptFormula}</label>

					${this._isCharacterMode ? null : $$`<label class="ve-flex-v-center mt-2"><div class="mr-2 no-shrink w-100p">Number of rolls:</div>${$iptRollCount}</label>`}
				</div>
				${$btnRoll}
			</div>

			${$wrpRolledOuter}

			<div class="ve-flex-v-center">${$btnRandom}</div>
		</div>`;
	}

	_render_$getStgArrayHeader () {
		const $btnRandom = $(`<button class="btn btn-xs btn-default">Randomly Assign</button>`)
			.click(() => {
				const abs = [...Parser.ABIL_ABVS].shuffle();
				abs.forEach((ab, i) => {
					const {propAbilSelectedScoreIx} = this.constructor._array_getProps(ab);
					this._state[propAbilSelectedScoreIx] = i;
				});
			});

		return $$`<div class="ve-flex-col mb-3 mr-auto">
			<div class="mb-2">Assign these numbers to your abilities as desired:</div>
			<div class="bold mb-2">${StatGenUi._STANDARD_ARRAY.join(", ")}</div>
			<div class="ve-flex">${$btnRandom}</div>
		</div>`;
	}

	_render_$getStgManualHeader () {
		return $$`<div class="ve-flex-col mb-3 mr-auto">
			<div>Enter your desired ability scores in the &quot;Base&quot; column below.</div>
		</div>`;
	}

	_doReset () {
		if (this._isLevelUp) return; // Should never occur

		const nxtState = this._getDefaultStateCommonResettable();

		switch (this.ixActiveTab) {
			case StatGenUi._IX_TAB_ROLLED: Object.assign(nxtState, this._getDefaultStateRolledResettable()); break;
			case StatGenUi._IX_TAB_ARRAY: Object.assign(nxtState, this._getDefaultStateArrayResettable()); break;
			case StatGenUi._IX_TAB_PB: Object.assign(nxtState, this._getDefaultStatePointBuyResettable()); break;
			case StatGenUi._IX_TAB_MANUAL: Object.assign(nxtState, this._getDefaultStateManualResettable()); break;
		}

		this._proxyAssignSimple("state", nxtState);
	}

	doResetAll () {
		this._proxyAssignSimple("state", this._getDefaultState(), true);
	}

	_render_$getStgPbHeader () {
		const $iptBudget = ComponentUiUtil.$getIptInt(
			this,
			"pb_budget",
			0,
			{
				html: `<input type="text" class="form-control statgen-pb__ipt-budget text-center statgen-shared__ipt">`,
				min: 0,
				fallbackOnNaN: 0,
			},
		);
		const hkIsCustom = () => {
			$iptBudget.attr("readonly", !this._state.pb_isCustom);
		};
		this._addHookBase("pb_isCustom", hkIsCustom);
		hkIsCustom();

		const $iptRemaining = ComponentUiUtil.$getIptInt(
			this,
			"pb_points",
			0,
			{
				html: `<input type="text" class="form-control statgen-pb__ipt-budget text-center statgen-shared__ipt">`,
				min: 0,
				fallbackOnNaN: 0,
			},
		).attr("readonly", true);

		const hkPoints = () => {
			this._state.pb_points = this._pb_getPointsRemaining(this._state);
			$iptRemaining.toggleClass(`statgen-pb__ipt-budget--error`, this._state.pb_points < 0);
		};
		this._addHookAll("state", hkPoints);
		hkPoints();

		const $btnReset = $(`<button class="btn btn-default">Reset</button>`)
			.click(() => this._doReset());

		const $btnRandom = $(`<button class="btn btn-default">Random</button>`)
			.click(() => {
				this._doReset();

				let canIncrease = Parser.ABIL_ABVS.map(it => `pb_${it}`);
				const cpyBaseState = canIncrease.mergeMap(it => ({[it]: this._state[it]}));
				const cntRemaining = this._pb_getPointsRemaining(cpyBaseState);
				if (cntRemaining <= 0) return;

				for (let step = 0; step < 10000; ++step) {
					if (!canIncrease.length) break;

					const prop = RollerUtil.rollOnArray(canIncrease);
					if (!this._state.pb_rules.some(rule => rule.entity.score === cpyBaseState[prop] + 1)) {
						canIncrease = canIncrease.filter(it => it !== prop);
						continue;
					}

					const draftCpyBaseState = MiscUtil.copy(cpyBaseState);
					draftCpyBaseState[prop]++;

					const cntRemaining = this._pb_getPointsRemaining(draftCpyBaseState);

					if (cntRemaining > 0) {
						Object.assign(cpyBaseState, draftCpyBaseState);
					} else if (cntRemaining === 0) {
						this._proxyAssignSimple("state", draftCpyBaseState);
						break;
					} else {
						canIncrease = canIncrease.filter(it => it !== prop);
					}
				}
			});

		return $$`<div class="ve-flex mobile__ve-flex-col mb-2">
			<div class="ve-flex-v-center">
				<div class="statgen-pb__cell mr-4 mobile__hidden"></div>

				<label class="ve-flex-col mr-2">
					<div class="mb-1 text-center">Budget</div>
					${$iptBudget}
				</label>

				<label class="ve-flex-col mr-2">
					<div class="mb-1 text-center">Remain</div>
					${$iptRemaining}
				</label>
			</div>

			<div class="ve-flex-v-center mobile__mt-2">
				<div class="ve-flex-col mr-2">
					<div class="mb-1 text-center mobile__hidden">&nbsp;</div>
					${$btnReset}
				</div>

				<div class="ve-flex-col">
					<div class="mb-1 text-center mobile__hidden">&nbsp;</div>
					${$btnRandom}
				</div>
			</div>
		</div>`;
	}

	_render_$getStgPbCustom () {
		const $btnAddLower = $(`<button class="btn btn-default btn-xs">Add Lower Score</button>`)
			.click(() => {
				const prevLowest = this._state.pb_rules[0];
				const score = prevLowest.entity.score - 1;
				const cost = prevLowest.entity.cost;
				this._state.pb_rules = [this._getDefaultState_pb_rule(score, cost), ...this._state.pb_rules];
			});

		const $btnAddHigher = $(`<button class="btn btn-default btn-xs">Add Higher Score</button>`)
			.click(() => {
				const prevHighest = this._state.pb_rules.last();
				const score = prevHighest.entity.score + 1;
				const cost = prevHighest.entity.cost;
				this._state.pb_rules = [...this._state.pb_rules, this._getDefaultState_pb_rule(score, cost)];
			});

		const $btnResetRules = $(`<button class="btn btn-default btn-xs">Reset</button>`)
			.click(() => {
				this._state.pb_rules = this._getDefaultStatePointBuyCosts().pb_rules;
			});

		const $stgCustomCostControls = $$`<div class="ve-flex-col mb-auto ml-2 mobile__ml-0 mobile__mt-3">
			<div class="btn-group-vertical ve-flex-col mb-2">${$btnAddLower}${$btnAddHigher}</div>
			<div class="ve-flex-v-center">${$btnResetRules}</div>
		</div>`;

		const $stgCostRows = $$`<div class="ve-flex-col"></div>`;

		const renderableCollectionRules = new StatGenUi.RenderableCollectionPbRules(
			this,
			$stgCostRows,
		);
		const hkRules = () => {
			renderableCollectionRules.render();

			// region Clamp values between new min/max scores
			const {min: minScore, max: maxScore} = this._pb_getMinMaxScores();
			Parser.ABIL_ABVS.forEach(it => {
				const prop = `pb_${it}`;
				this._state[prop] = Math.min(maxScore, Math.max(minScore, this._state[prop]));
			});
			// endregion
		};
		this._addHookBase("pb_rules", hkRules);
		hkRules();

		let lastIsCustom = this._state.pb_isCustom;
		const hkIsCustomReset = () => {
			$stgCustomCostControls.toggleVe(this._state.pb_isCustom);

			if (lastIsCustom === this._state.pb_isCustom) return;
			lastIsCustom = this._state.pb_isCustom;

			// On resetting to non-custom, reset the rules
			if (!this._state.pb_isCustom) this._state.pb_rules = this._getDefaultStatePointBuyCosts().pb_rules;
		};
		this._addHookBase("pb_isCustom", hkIsCustomReset);
		hkIsCustomReset();

		return $$`<div class="ve-flex-col">
			<h4>Ability Score Point Cost</h4>

			<div class="ve-flex-col">
				<div class="ve-flex mobile__ve-flex-col">
					<div class="ve-flex-col mr-3mobile__mr-0">
						<div class="ve-flex-v-center mb-1">
							<div class="statgen-pb__col-cost ve-flex-vh-center bold">Score</div>
							<div class="statgen-pb__col-cost ve-flex-vh-center bold">Modifier</div>
							<div class="statgen-pb__col-cost ve-flex-vh-center bold">Point Cost</div>
							<div class="statgen-pb__col-cost-delete"></div>
						</div>

						${$stgCostRows}
					</div>

					${$stgCustomCostControls}
				</div>
			</div>

			<hr class="hr-4 mb-2">

			<label class="ve-flex-v-center">
				<div class="mr-2">Custom Rules</div>
				${ComponentUiUtil.$getCbBool(this, "pb_isCustom")}
			</label>
		</div>`;
	}

	_render_all ($wrpTab) {
		if (this._isLevelUp) return this._render_isLevelUp($wrpTab);
		this._render_isLevelOne($wrpTab);
	}

	_render_isLevelOne ($wrpTab) {
		const $elesRolled = [];
		const $elesArray = [];
		const $elesPb = [];
		const $elesManual = [];

		// region Rolled header
		const $stgRolledHeader = this._render_$getStgRolledHeader();
		const hkStgRolled = () => $stgRolledHeader.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_ROLLED);
		this._addHookActiveTab(hkStgRolled);
		hkStgRolled();
		// endregion

		// region Point Buy stages
		const $stgPbHeader = this._render_$getStgPbHeader();
		const $stgPbCustom = this._render_$getStgPbCustom();
		const $vrPbCustom = $(`<div class="vr-5 mobile-ish__hidden"></div>`);
		const $hrPbCustom = $(`<hr class="hr-5 mobile-ish__visible">`);
		const hkStgPb = () => {
			$stgPbHeader.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_PB);
			$stgPbCustom.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_PB);
			$vrPbCustom.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_PB);
			$hrPbCustom.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_PB);
		};
		this._addHookActiveTab(hkStgPb);
		hkStgPb();
		// endregion

		// region Array header
		const $stgArrayHeader = this._render_$getStgArrayHeader();
		const hkStgArray = () => $stgArrayHeader.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_ARRAY);
		this._addHookActiveTab(hkStgArray);
		hkStgArray();
		// endregion

		// region Manual header
		const $stgManualHeader = this._render_$getStgManualHeader();
		const hkStgManual = () => $stgManualHeader.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_MANUAL);
		this._addHookActiveTab(hkStgManual);
		hkStgManual();
		// endregion

		// region Other elements
		const hkElesMode = () => {
			$elesRolled.forEach($ele => $ele.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_ROLLED));
			$elesArray.forEach($ele => $ele.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_ARRAY));
			$elesPb.forEach($ele => $ele.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_PB));
			$elesManual.forEach($ele => $ele.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_MANUAL));
		};
		this._addHookActiveTab(hkElesMode);
		// endregion

		const $btnResetRolledOrArrayOrManual = $(`<button class="btn btn-default btn-xxs relative statgen-shared__btn-reset" title="Reset"><span class="glyphicon glyphicon-refresh"></span></button>`)
			.click(() => this._doReset());
		const hkRolledOrArray = () => $btnResetRolledOrArrayOrManual.toggleVe(this.ixActiveTab === StatGenUi._IX_TAB_ROLLED || this.ixActiveTab === StatGenUi._IX_TAB_ARRAY || this.ixActiveTab === StatGenUi._IX_TAB_MANUAL);
		this._addHookActiveTab(hkRolledOrArray);
		hkRolledOrArray();

		const $wrpsBase = Parser.ABIL_ABVS.map(ab => {
			// region Rolled
			const {propAbilSelectedRollIx} = this.constructor._rolled_getProps(ab);

			const $selRolled = $(`<select class="form-control input-xs form-control--minimal statgen-shared__ipt statgen-shared__ipt--sel"></select>`)
				.change(() => {
					const ix = Number($selRolled.val());

					const nxtState = {
						...Parser.ABIL_ABVS
							.map(ab => this.constructor._rolled_getProps(ab).propAbilSelectedRollIx)
							.filter(prop => ix != null && this._state[prop] === ix)
							.mergeMap(prop => ({[prop]: null})),
						[propAbilSelectedRollIx]: ~ix ? ix : null,
					};
					this._proxyAssignSimple("state", nxtState);
				});
			$(`<option/>`, {value: -1, text: "\u2014"}).appendTo($selRolled);

			let $optionsRolled = [];
			const hkRolls = () => {
				$optionsRolled.forEach($opt => $opt.remove());

				this._state.rolled_rolls.forEach((it, i) => {
					const cntPrevRolls = this._state.rolled_rolls.slice(0, i).filter(r => r.total === it.total).length;
					const $opt = $(`<option/>`, {value: i, text: `${it.total}${cntPrevRolls ? Parser.numberToSubscript(cntPrevRolls) : ""}`}).appendTo($selRolled);
					$optionsRolled.push($opt);
				});

				let nxtSelIx = this._state[propAbilSelectedRollIx];
				if (nxtSelIx >= this._state.rolled_rolls.length) nxtSelIx = null;
				$selRolled.val(`${nxtSelIx == null ? -1 : nxtSelIx}`);
				if ((nxtSelIx) !== this._state[propAbilSelectedRollIx]) this._state[propAbilSelectedRollIx] = nxtSelIx;
			};
			this._addHookBase("rolled_rolls", hkRolls);
			hkRolls();

			const hookIxRolled = () => {
				const ix = this._state[propAbilSelectedRollIx] == null ? -1 : this._state[propAbilSelectedRollIx];
				$selRolled.val(`${ix}`);
			};
			this._addHookBase(propAbilSelectedRollIx, hookIxRolled);
			hookIxRolled();

			$elesRolled.push($selRolled);
			// endregion

			// region Array
			const {propAbilSelectedScoreIx} = this.constructor._array_getProps(ab);

			const $selArray = $(`<select class="form-control input-xs form-control--minimal statgen-shared__ipt statgen-shared__ipt--sel"></select>`)
				.change(() => {
					const ix = Number($selArray.val());

					const nxtState = {
						...Parser.ABIL_ABVS
							.map(ab => this.constructor._array_getProps(ab).propAbilSelectedScoreIx)
							.filter(prop => ix != null && this._state[prop] === ix)
							.mergeMap(prop => ({[prop]: null})),
						[propAbilSelectedScoreIx]: ~ix ? ix : null,
					};
					this._proxyAssignSimple("state", nxtState);
				});
			$(`<option/>`, {value: -1, text: "\u2014"}).appendTo($selArray);

			StatGenUi._STANDARD_ARRAY.forEach((it, i) => $(`<option/>`, {value: i, text: it}).appendTo($selArray));

			const hookIxArray = () => {
				const ix = this._state[propAbilSelectedScoreIx] == null ? -1 : this._state[propAbilSelectedScoreIx];
				$selArray.val(`${ix}`);
			};
			this._addHookBase(propAbilSelectedScoreIx, hookIxArray);
			hookIxArray();

			$elesArray.push($selArray);
			// endregion

			// region Point buy
			const propPb = `pb_${ab}`;
			const $iptPb = ComponentUiUtil.$getIptInt(
				this,
				propPb,
				0,
				{
					fallbackOnNaN: 0,
					min: 0,
					html: `<input class="form-control form-control--minimal statgen-shared__ipt text-right" type="number">`,
				},
			);

			const hkPb = () => {
				const {min: minScore, max: maxScore} = this._pb_getMinMaxScores();
				this._state[propPb] = Math.min(maxScore, Math.max(minScore, this._state[propPb]));
			};
			this._addHookBase(propPb, hkPb);
			hkPb();

			$elesPb.push($iptPb);
			// endregion

			// region Manual
			const {propAbilValue} = this.constructor._manual_getProps(ab);
			const $iptManual = ComponentUiUtil.$getIptInt(
				this,
				propAbilValue,
				0,
				{
					fallbackOnNaN: 0,
					html: `<input class="form-control form-control--minimal statgen-shared__ipt text-right" type="number">`,
				},
			);

			$elesManual.push($iptManual);
			// endregion

			return $$`<label class="my-1 statgen-pb__cell">
				${$selRolled}
				${$selArray}
				${$iptPb}
				${$iptManual}
			</label>`;
		});

		const $wrpsUser = this._render_$getWrpsUser();

		const metasTotalAndMod = this._render_getMetasTotalAndMod();

		const $wrpRace = $(`<div class="ve-flex"></div>`);
		const $wrpRaceOuter = $$`<div class="ve-flex-col">
			<div class="my-1 statgen-pb__header statgen-pb__header--group mr-3 text-center italic">Race</div>

			${$wrpRace}
		</div>`;
		const hkIxRace = () => {
			this._pb_unhookRaceRender();
			this._state.common_raceChoiceMetasFrom = [];
			this._state.common_raceChoiceMetasWeighted = [];
			const isAnyRacial = this._render_pointBuy_races($wrpRace);
			$wrpRaceOuter.toggleVe(isAnyRacial);
		};
		this._addHookBase("common_ixRace", hkIxRace);
		this._addHookBase("common_isTashas", hkIxRace);
		hkIxRace();

		const {$wrp: $selRace, fnUpdateHidden: fnUpdateSelRaceHidden} = ComponentUiUtil.$getSelSearchable(
			this,
			"common_ixRace",
			{
				values: this._races.map((_, i) => i),
				isAllowNull: true,
				fnDisplay: ix => {
					const r = this._races[ix];
					if (!r) return "(Unknown)";
					return `${r.name} ${r.source !== SRC_PHB ? `[${Parser.sourceJsonToAbv(r.source)}]` : ""}`;
				},
				asMeta: true,
			},
		);

		const doApplyFilterToSelRace = () => {
			const f = this._modalFilterRaces.pageFilter.filterBox.getValues();
			const isHiddenPerRace = this._races.map(it => !this._modalFilterRaces.pageFilter.toDisplay(f, it));
			fnUpdateSelRaceHidden(isHiddenPerRace, false);
		};

		this._modalFilterRaces.pageFilter.filterBox.on(FilterBox.EVNT_VALCHANGE, () => doApplyFilterToSelRace());
		doApplyFilterToSelRace();

		const $btnFilterForRace = $(`<button class="btn btn-xs btn-default br-0 pr-2" title="Filter for Race"><span class="glyphicon glyphicon-filter"></span> Filter</button>`)
			.click(async () => {
				const selected = await this._modalFilterRaces.pGetUserSelection();
				if (selected == null || !selected.length) return;

				const selectedRace = selected[0];
				const ixRace = this._races.findIndex(it => it.name === selectedRace.name && it.source === selectedRace.values.sourceJson);
				if (!~ixRace) throw new Error(`Could not find selected race: ${JSON.stringify(selectedRace)}`); // Should never occur
				this._state.common_ixRace = ixRace;
			});

		const $btnPreviewRace = ComponentUiUtil.$getBtnBool(
			this,
			"common_isPreviewRace",
			{
				html: `<button class="btn btn-xs btn-default" title="Toggle Race Preview"><span class="glyphicon glyphicon-eye-open"></span></button>`,
			},
		);
		const hkBtnPreviewRace = () => $btnPreviewRace.toggleVe(this._state.common_ixRace != null && !~this._state.common_ixRace);
		this._addHookBase("common_ixRace", hkBtnPreviewRace);
		hkBtnPreviewRace();

		const $dispPreviewRace = $(`<div class="ve-flex-col mb-2"></div>`);
		const hkPreviewRace = () => {
			if (!this._state.common_isPreviewRace) return $dispPreviewRace.hideVe();

			const race = this._state.common_ixRace != null ? this._races[this._state.common_ixRace] : null;
			if (!race) return $dispPreviewRace.hideVe();

			$dispPreviewRace.empty().showVe().append(Renderer.hover.$getHoverContent_stats(UrlUtil.PG_RACES, race));
		};
		this._addHookBase("common_ixRace", hkPreviewRace);
		this._addHookBase("common_isPreviewRace", hkPreviewRace);
		hkPreviewRace();

		const $btnToggleTashasPin = ComponentUiUtil.$getBtnBool(
			this,
			"common_isShowTashasRules",
			{
				html: `<button class="btn btn-xxs btn-default ve-small p-0 statgen-shared__btn-toggle-tashas-rules ve-flex-vh-center" title="Toggle &quot;Customizing Your Origin&quot; Section"><span class="glyphicon glyphicon-eye-open"></span></button>`,
			},
		);

		const $dispTashas = $(`<div class="ve-flex-col"><div class="italic ve-muted">Loading...</div></div>`);
		Renderer.hover.pCacheAndGet(UrlUtil.PG_VARIANTRULES, SRC_TCE, UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_VARIANTRULES]({name: "Customizing Your Origin", source: SRC_TCE}))
			.then(rule => {
				$$($dispTashas.empty())`${Renderer.hover.$getHoverContent_stats(UrlUtil.PG_VARIANTRULES, rule)}<hr class="hr-3">`;
			});
		const hkIsShowTashas = () => {
			$dispTashas.toggleVe(this._state.common_isShowTashasRules);
		};
		this._addHookBase("common_isShowTashasRules", hkIsShowTashas);
		hkIsShowTashas();

		const $hrPreviewRaceTashas = $(`<hr class="hr-3">`);
		const hkPreviewAndTashas = () => $hrPreviewRaceTashas.toggleVe(this._state.common_isPreviewRace && this._state.common_isShowTashasRules);
		this._addHookBase("common_isPreviewRace", hkPreviewAndTashas);
		this._addHookBase("common_isShowTashasRules", hkPreviewAndTashas);
		hkPreviewAndTashas();

		const $wrpAsi = this._render_$getWrpAsi();

		hkElesMode();

		$$($wrpTab)`
			${$stgRolledHeader}
			${$stgArrayHeader}
			${$stgManualHeader}

			<div class="ve-flex mobile-ish__ve-flex-col w-100 px-3">
				<div class="ve-flex-col">
					${$stgPbHeader}

					<div class="ve-flex">
						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header"></div>
							<div class="my-1 statgen-pb__header ve-flex-h-right">${$btnResetRolledOrArrayOrManual}</div>

							${Parser.ABIL_ABVS.map(it => `<div class="my-1 bold statgen-pb__cell ve-flex-v-center ve-flex-h-right" title="${Parser.attAbvToFull(it)}">${it.toUpperCase()}</div>`)}
						</div>

						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header"></div>
							<div class="my-1 bold statgen-pb__header ve-flex-vh-center">Base</div>
							${$wrpsBase}
						</div>

						${$wrpRaceOuter}

						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header"></div>
							<div class="my-1 statgen-pb__header ve-flex-vh-center help text-muted" title="Input any additional/custom bonuses here">User</div>
							${$wrpsUser}
						</div>

						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header"></div>
							<div class="my-1 statgen-pb__header ve-flex-vh-center">Total</div>
							${metasTotalAndMod.map(it => it.$wrpIptTotal)}
						</div>

						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header"></div>
							<div class="my-1 statgen-pb__header ve-flex-vh-center" title="Modifier">Mod.</div>
							${metasTotalAndMod.map(it => it.$wrpIptMod)}
						</div>
					</div>

					<div class="ve-flex-col">
						<div class="mb-1">Select a Race</div>
						<div class="ve-flex-v-center mb-2">
							<div class="ve-flex-v-center btn-group w-100 mr-2">${$btnFilterForRace}${$selRace}</div>
							<div>${$btnPreviewRace}</div>
						</div>
						<label class="ve-flex-v-center mb-1">
							<div class="mr-1">Allow Origin Customization</div>
							${ComponentUiUtil.$getCbBool(this, "common_isTashas")}
						</label>
						<div class="ve-flex">
							<div class="ve-small ve-muted italic mr-1">${Renderer.get().render(`An {@variantrule Customizing Your Origin|TCE|optional rule}`)}</div>
							${$btnToggleTashasPin}
							<div class="ve-small ve-muted italic ml-1">${Renderer.get().render(`from Tasha's Cauldron of Everything, page 8.`)}</div>
						</div>
					</div>
				</div>

				${$vrPbCustom}
				${$hrPbCustom}

				${$stgPbCustom}
			</div>

			<hr class="hr-3">

			${$dispPreviewRace}
			${$hrPreviewRaceTashas}
			${$dispTashas}

			${$wrpAsi}
		`;
	}

	_render_isLevelUp ($wrpTab) {
		const $wrpsExisting = Parser.ABIL_ABVS.map(ab => {
			const $iptExisting = $(`<input class="form-control form-control--minimal statgen-shared__ipt text-right" type="number" readonly>`)
				.val(this._existingScores[ab]);

			return $$`<label class="my-1 statgen-pb__cell">
				${$iptExisting}
			</label>`;
		});

		const $wrpsUser = this._render_$getWrpsUser();

		const metasTotalAndMod = this._render_getMetasTotalAndMod();

		const $wrpAsi = this._render_$getWrpAsi();

		$$($wrpTab)`
			<div class="ve-flex mobile-ish__ve-flex-col w-100 px-3">
				<div class="ve-flex-col">
					<div class="ve-flex">
						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header"></div>

							${Parser.ABIL_ABVS.map(it => `<div class="my-1 bold statgen-pb__cell ve-flex-v-center ve-flex-h-right" title="${Parser.attAbvToFull(it)}">${it.toUpperCase()}</div>`)}
						</div>

						<div class="ve-flex-col mr-3">
							<div class="my-1 bold statgen-pb__header ve-flex-vh-center" title="Current">Curr.</div>
							${$wrpsExisting}
						</div>

						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header ve-flex-vh-center help text-muted" title="Input any additional/custom bonuses here">User</div>
							${$wrpsUser}
						</div>

						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header ve-flex-vh-center">Total</div>
							${metasTotalAndMod.map(it => it.$wrpIptTotal)}
						</div>

						<div class="ve-flex-col mr-3">
							<div class="my-1 statgen-pb__header ve-flex-vh-center" title="Modifier">Mod.</div>
							${metasTotalAndMod.map(it => it.$wrpIptMod)}
						</div>
					</div>
				</div>
			</div>

			<hr class="hr-3">

			${$wrpAsi}
		`;
	}

	_render_$getWrpsUser () {
		return Parser.ABIL_ABVS.map(ab => {
			const {propUserBonus} = this.constructor._common_getProps(ab);
			const $ipt = ComponentUiUtil.$getIptInt(
				this,
				propUserBonus,
				0,
				{
					fallbackOnNaN: 0,
					html: `<input class="form-control form-control--minimal statgen-shared__ipt text-right" type="number">`,
				},
			);
			return $$`<label class="my-1 statgen-pb__cell">${$ipt}</label>`;
		});
	}

	_render_getMetasTotalAndMod () {
		return Parser.ABIL_ABVS.map(ab => {
			const $iptTotal = $(`<input class="form-control form-control--minimal statgen-shared__ipt text-center" type="text" readonly>`);
			const $iptMod = $(`<input class="form-control form-control--minimal statgen-shared__ipt text-center" type="text" readonly>`);

			const $wrpIptTotal = $$`<label class="my-1 statgen-pb__cell">${$iptTotal}</label>`;
			const $wrpIptMod = $$`<label class="my-1 statgen-pb__cell">${$iptMod}</label>`;

			const exportedStateProp = `common_export_${ab}`;

			const hk = () => {
				const totalScore = this._isLevelUp
					? this._levelUp_getTotalScore(ab)
					: this.ixActiveTab === StatGenUi._IX_TAB_ROLLED
						? this._rolled_getTotalScore(ab)
						: this.ixActiveTab === StatGenUi._IX_TAB_ARRAY
							? this._array_getTotalScore(ab)
							: this.ixActiveTab === StatGenUi._IX_TAB_PB
								? this._pb_getTotalScore(ab)
								: this._manual_getTotalScore(ab);

				const isOverLimit = totalScore > 20;
				$iptTotal
					.val(totalScore)
					.toggleClass("form-control--error", isOverLimit)
					.title(isOverLimit ? `In general, you can't increase an ability score above 20.` : "");
				$iptMod.val(Parser.getAbilityModifier(totalScore));

				this._state[exportedStateProp] = totalScore;
			};
			this._addHookAll("state", hk);
			this._addHookActiveTab(hk);
			hk();

			return {
				$wrpIptTotal,
				$wrpIptMod,
			};
		});
	}

	_render_$getWrpAsi () {
		const $wrpAsi = $(`<div class="ve-flex-col w-100"></div>`);
		this._compAsi.render($wrpAsi);
		return $wrpAsi;
	}

	static _common_getProps (ab) {
		return {
			propUserBonus: `${StatGenUi._PROP_PREFIX_COMMON}${ab}_user`,
		};
	}

	static _rolled_getProps (ab) {
		return {
			propAbilSelectedRollIx: `${StatGenUi._PROP_PREFIX_ROLLED}${ab}_abilSelectedRollIx`,
		};
	}

	static _array_getProps (ab) {
		return {
			propAbilSelectedScoreIx: `${StatGenUi._PROP_PREFIX_ARRAY}${ab}_abilSelectedScoreIx`,
		};
	}

	static _manual_getProps (ab) {
		return {
			propAbilValue: `${StatGenUi._PROP_PREFIX_MANUAL}${ab}_abilValue`,
		};
	}

	_pb_unhookRaceRender () {
		this._pbRaceHookMetas.forEach(it => it.unhook());
		this._pbRaceHookMetas = [];
	}

	_pb_getRacialAbility () {
		const race = this._state.common_ixRace != null ? this._races[this._state.common_ixRace] : null;
		if (!race) return null;

		// (Always use the first set of ability scores, for simplicity)
		let fromRace = race.ability ? race.ability[0] : null;
		if (!fromRace) return null;

		if (this._state.common_isTashas) {
			const weights = [];

			if (fromRace.choose && fromRace.choose.weighted && fromRace.choose.weighted.weights) {
				weights.push(...fromRace.choose.weighted.weights);
			}

			Parser.ABIL_ABVS.forEach(it => {
				if (fromRace[it]) weights.push(fromRace[it]);
			});

			if (fromRace.choose && fromRace.choose.from) {
				const count = fromRace.choose.count || 1;
				const amount = fromRace.choose.amount || 1;
				for (let i = 0; i < count; ++i) weights.push(amount);
			}

			weights.sort((a, b) => SortUtil.ascSort(b, a));

			fromRace = {
				choose: {
					weighted: {
						from: [...Parser.ABIL_ABVS],
						weights,
					},
				},
			};
		}

		return fromRace;
	}

	_pb_getPointsRemaining (baseState) {
		const spent = Parser.ABIL_ABVS.map(it => {
			const prop = `pb_${it}`;
			const score = baseState[prop];
			const rule = this._state.pb_rules.find(it => it.entity.score === score);
			if (!rule) return 0;
			return rule.entity.cost;
		}).reduce((a, b) => a + b, 0);

		return this._state.pb_budget - spent;
	}

	_render_pointBuy_races ($wrpRaces) {
		$wrpRaces.empty();

		const fromRace = this._pb_getRacialAbility();
		if (fromRace == null) return false;

		let $ptBase = null;
		if (Parser.ABIL_ABVS.some(it => fromRace[it])) {
			const $wrpsRace = Parser.ABIL_ABVS.map(ab => {
				return $$`<div class="my-1 statgen-pb__cell">
					<input class="form-control form-control--minimal statgen-shared__ipt text-right" type="number" readonly value="${fromRace[ab] || 0}">
				</div>`;
			});

			$ptBase = $$`<div class="ve-flex-col mr-3">
				<div class="my-1 statgen-pb__header ve-flex-vh-center">Static</div>
				${$wrpsRace}
			</div>`;
		}

		let $ptChooseFrom = null;
		if (fromRace.choose && fromRace.choose.from) {
			const amount = fromRace.choose.amount || 1;
			const count = fromRace.choose.count || 1;

			const $wrpsChoose = Parser.ABIL_ABVS.map(ab => {
				if (!fromRace.choose.from.includes(ab)) return `<div class="my-1 statgen-pb__cell"></div>`;

				const $cb = $(`<input type="checkbox">`)
					.change(() => {
						const existing = this._state.common_raceChoiceMetasFrom.find(it => it.ability === ab);
						if (existing) {
							this._state.common_raceChoiceMetasFrom = this._state.common_raceChoiceMetasFrom.filter(it => it !== existing);
							return;
						}

						// If we're already at the max number of choices, remove the oldest one
						if (this._state.common_raceChoiceMetasFrom.length >= count) {
							while (this._state.common_raceChoiceMetasFrom.length >= count) this._state.common_raceChoiceMetasFrom.shift();
							this._state.common_raceChoiceMetasFrom = [...this._state.common_raceChoiceMetasFrom];
						}

						this._state.common_raceChoiceMetasFrom = [
							...this._state.common_raceChoiceMetasFrom,
							{ability: ab, amount},
						];
					});

				const hk = () => $cb.prop("checked", this._state.common_raceChoiceMetasFrom.some(it => it.ability === ab));
				this._addHookBase("common_raceChoiceMetasFrom", hk);
				this._pbRaceHookMetas.push({unhook: () => this._removeHookBase("common_raceChoiceMetasFrom", hk)});
				hk();

				return $$`<label class="my-1 statgen-pb__cell ve-flex-vh-center">${$cb}</label>`;
			});

			$ptChooseFrom = $$`<div class="ve-flex-col mr-3">
				<div class="my-1 statgen-pb__header statgen-pb__header--choose-from ve-flex-vh-center">
					<div class="${count !== 1 ? `mr-1` : ""}">${UiUtil.intToBonus(amount)}</div>${count !== 1 ? `<div class="ve-small ve-muted">(x${count})</div>` : ""}
				</div>
				${$wrpsChoose}
			</div>`;
		}

		let $ptsChooseWeighted = null;
		if (fromRace.choose && fromRace.choose.weighted && fromRace.choose.weighted.weights) {
			$ptsChooseWeighted = fromRace.choose.weighted.weights.map((weight, ixWeight) => {
				const $wrpsChoose = Parser.ABIL_ABVS.map(ab => {
					if (!fromRace.choose.weighted.from.includes(ab)) return `<div class="my-1 statgen-pb__cell"></div>`;

					const $cb = $(`<input type="checkbox">`)
						.change(() => {
							const existing = this._state.common_raceChoiceMetasWeighted.find(it => it.ability === ab && it.ix === ixWeight);
							if (existing) {
								this._state.common_raceChoiceMetasWeighted = this._state.common_raceChoiceMetasWeighted.filter(it => it !== existing);
								return;
							}

							// Remove other selections for the same ability score, or selections for the same weight
							const withSameAbil = this._state.common_raceChoiceMetasWeighted.filter(it => it.ability === ab || it.ix === ixWeight);
							if (withSameAbil.length) {
								this._state.common_raceChoiceMetasWeighted = this._state.common_raceChoiceMetasWeighted.filter(it => it.ability !== ab && it.ix !== ixWeight);
							}

							this._state.common_raceChoiceMetasWeighted = [
								...this._state.common_raceChoiceMetasWeighted,
								{ability: ab, amount: weight, ix: ixWeight},
							];
						});

					const hk = () => {
						$cb.prop("checked", this._state.common_raceChoiceMetasWeighted.some(it => it.ability === ab && it.ix === ixWeight));
					};
					this._addHookBase("common_raceChoiceMetasWeighted", hk);
					this._pbRaceHookMetas.push({unhook: () => this._removeHookBase("common_raceChoiceMetasWeighted", hk)});
					hk();

					return $$`<label class="my-1 statgen-pb__cell ve-flex-vh-center">${$cb}</label>`;
				});

				return $$`<div class="ve-flex-col mr-3">
					<div class="my-1 statgen-pb__header statgen-pb__header--choose-from ve-flex-vh-center">${UiUtil.intToBonus(weight)}</div>
					${$wrpsChoose}
				</div>`;
			});
		}

		$$($wrpRaces)`
			${$ptBase}
			${$ptChooseFrom}
			${$ptsChooseWeighted}
		`;

		return $ptBase || $ptChooseFrom || $ptsChooseWeighted;
	}

	_rolled_getTotalScore (ab) {
		const {propAbilSelectedRollIx} = this.constructor._rolled_getProps(ab);
		const {propUserBonus} = this.constructor._common_getProps(ab);
		return (this._state.rolled_rolls[this._state[propAbilSelectedRollIx]] || {total: 0}).total + this._state[propUserBonus] + this._getTotalScore_getBonuses(ab);
	}

	_array_getTotalScore (ab) {
		const {propAbilSelectedScoreIx} = this.constructor._array_getProps(ab);
		const {propUserBonus} = this.constructor._common_getProps(ab);
		return (StatGenUi._STANDARD_ARRAY[this._state[propAbilSelectedScoreIx]] || 0) + this._state[propUserBonus] + this._getTotalScore_getBonuses(ab);
	}

	_pb_getTotalScore (ab) {
		const prop = `pb_${ab}`;
		const {propUserBonus} = this.constructor._common_getProps(ab);
		return this._state[prop] + this._state[propUserBonus] + this._getTotalScore_getBonuses(ab);
	}

	_manual_getTotalScore (ab) {
		const {propAbilValue} = this.constructor._manual_getProps(ab);
		const {propUserBonus} = this.constructor._common_getProps(ab);
		return (this._state[propAbilValue] || 0) + this._state[propUserBonus] + this._getTotalScore_getBonuses(ab);
	}

	_levelUp_getTotalScore (ab) {
		const {propUserBonus} = this.constructor._common_getProps(ab);
		return (this._existingScores[ab] || 0) + this._state[propUserBonus] + this._getTotalScore_getBonuses(ab);
	}

	_getTotalScore_getBonuses (ab) {
		let total = 0;

		if (!this._isLevelUp) {
			const fromRace = this._pb_getRacialAbility();
			if (fromRace) {
				if (fromRace[ab]) total += fromRace[ab];

				if (fromRace.choose && fromRace.choose.from) {
					total += this._state.common_raceChoiceMetasFrom
						.filter(it => it.ability === ab)
						.map(it => it.amount)
						.reduce((a, b) => a + b, 0);
				}

				if (fromRace.choose && fromRace.choose.weighted && fromRace.choose.weighted.weights) {
					total += this._state.common_raceChoiceMetasWeighted
						.filter(it => it.ability === ab)
						.map(it => it.amount)
						.reduce((a, b) => a + b, 0);
				}
			}
		}

		const formDataAsi = this._compAsi.getFormData();
		if (formDataAsi) total += formDataAsi.data[ab] || 0;

		return total;
	}

	getSaveableState () {
		const out = super.getSaveableState();

		if (out.common_ixRace != null && !~this._state.common_ixRace) {
			out._pb_raceHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES](this._races[out.common_ixRace]);
			delete out.common_ixRace;
		}

		return out;
	}

	setStateFrom (saved, isOverwrite = false) {
		saved = MiscUtil.copy(saved);

		MiscUtil.getOrSet(saved, "state", {});

		if (saved._pb_raceHash) {
			const ixRace = this._races.findIndex(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES](it);
				return hash === saved._pb_raceHash;
			});
			if (~ixRace) saved.common_ixRace = ixRace;
		}

		const validKeys = new Set(Object.keys(this._getDefaultState()));
		const validKeyPrefixes = [
			StatGenUi._PROP_PREFIX_COMMON,
			StatGenUi._PROP_PREFIX_ROLLED,
			StatGenUi._PROP_PREFIX_ARRAY,
			StatGenUi._PROP_PREFIX_MANUAL,
		];

		Object.keys(saved.state).filter(k => !validKeys.has(k) && !validKeyPrefixes.some(it => k.startsWith(it))).forEach(k => delete saved.state[k]);

		// region Trim the ASI/feat state to the max count of ASIs/feats
		for (let i = saved.state.common_cntAsi || 0; i < 1000; ++i) {
			const {propMode, prefix} = this.getPropsAsi(i, "ability");
			if (saved.state[propMode]) Object.keys(saved.state).filter(k => k.startsWith(prefix)).forEach(k => delete saved.state[k]);
		}

		for (let i = saved.state.common_cntFeatsCustom || 0; i < 1000; ++i) {
			const {propMode, prefix} = this.getPropsAsi(i, "custom");
			if (saved.state[propMode]) Object.keys(saved.state).filter(k => k.startsWith(prefix)).forEach(k => delete saved.state[k]);
		}
		// endregion

		super.setStateFrom(saved, isOverwrite);
	}

	_pb_getMinMaxScores () {
		return {
			min: Math.min(...this._state.pb_rules.map(it => it.entity.score)),
			max: Math.max(...this._state.pb_rules.map(it => it.entity.score)),
		};
	}

	_getDefaultStateCommonResettable () {
		return {
			...Parser.ABIL_ABVS.mergeMap(ab => ({[this.constructor._common_getProps(ab).propUserBonus]: 0})),

			common_raceChoiceMetasFrom: [],
			common_raceChoiceMetasWeighted: [],
		};
	}

	_getDefaultStateRolledResettable () {
		return {
			...Parser.ABIL_ABVS.mergeMap(ab => ({[this.constructor._rolled_getProps(ab).propAbilSelectedRollIx]: null})),
		};
	}

	_getDefaultStateArrayResettable () {
		return {
			...Parser.ABIL_ABVS.mergeMap(ab => ({[this.constructor._array_getProps(ab).propAbilSelectedScoreIx]: null})),
		};
	}

	_getDefaultStatePointBuyResettable () {
		return {
			pb_str: 8,
			pb_dex: 8,
			pb_con: 8,
			pb_int: 8,
			pb_wis: 8,
			pb_cha: 8,
		};
	}

	_getDefaultStatePointBuyCosts () {
		return {
			pb_rules: [
				{score: 8, cost: 0},
				{score: 9, cost: 1},
				{score: 10, cost: 2},
				{score: 11, cost: 3},
				{score: 12, cost: 4},
				{score: 13, cost: 5},
				{score: 14, cost: 7},
				{score: 15, cost: 9},
			].map(({score, cost}) => this._getDefaultState_pb_rule(score, cost)),
		};
	}

	_getDefaultState_pb_rule (score, cost) {
		return {
			id: CryptUtil.uid(),
			entity: {
				score,
				cost,
			},
		};
	}

	_getDefaultStateManualResettable () {
		return {
			...Parser.ABIL_ABVS.mergeMap(ab => ({[this.constructor._manual_getProps(ab).propAbilValue]: null})),
		};
	}

	_getDefaultState () {
		return {
			// region Common
			common_isPreviewRace: false,
			common_isTashas: false,
			common_isShowTashasRules: false,
			common_ixRace: null,

			common_pulseAsi: false, // Used as a general pulse for all changes in form data
			common_cntAsi: 0,
			common_cntFeatsCustom: 0,

			// region Used to allow external components to hook onto score changes
			common_export_str: null,
			common_export_dex: null,
			common_export_con: null,
			common_export_int: null,
			common_export_wis: null,
			common_export_cha: null,
			// endregion

			...this._getDefaultStateCommonResettable(),
			// endregion

			// region Rolled stats
			rolled_formula: "4d6dl1",
			rolled_rollCount: 6,
			rolled_rolls: [],
			...this._getDefaultStateRolledResettable(),
			// endregion

			// region Standard array
			...this._getDefaultStateArrayResettable(),
			// endregion

			// region Point buy
			...this._getDefaultStatePointBuyResettable(),
			...this._getDefaultStatePointBuyCosts(),

			pb_points: 27,
			pb_budget: 27,

			pb_isCustom: false,
			// endregion

			// region Manual
			...this._getDefaultStateManualResettable(),
			// endregion
		};
	}
}

StatGenUi._STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
StatGenUi._PROP_PREFIX_COMMON = "common_";
StatGenUi._PROP_PREFIX_ROLLED = "rolled_";
StatGenUi._PROP_PREFIX_ARRAY = "array_";
StatGenUi._PROP_PREFIX_MANUAL = "manual_";
StatGenUi.MODES = [
	"rolled",
	"array",
	"pointbuy",
	"manual",
];
[StatGenUi._IX_TAB_ROLLED, StatGenUi._IX_TAB_ARRAY, StatGenUi._IX_TAB_PB, StatGenUi._IX_TAB_MANUAL] = StatGenUi.MODES.map((_, i) => i);
StatGenUi._MAX_CUSTOM_FEATS = 20;

class UtilAdditionalFeats {
	static isNoChoice (available) {
		if (!available?.length) return true;
		if (available.length > 1) return false;
		return !available[0].any;
	}

	static getUidsStatic (availableSet) {
		return Object.entries(availableSet || {})
			.filter(([k, v]) => k !== "any" && v)
			.sort(([kA], [kB]) => SortUtil.ascSortLower(kA, kB))
			.map(([k]) => k);
	}

	static getSelIxSetMeta ({comp, prop, available}) {
		return ComponentUiUtil.$getSelEnum(
			comp,
			prop,
			{
				values: available.map((_, i) => i),
				fnDisplay: ix => {
					const featSet = available[ix];

					const out = [];

					if (featSet.any) {
						out.push(`Choose any${featSet.any > 1 ? ` ${Parser.numberToText(featSet.any)}` : ""}`);
					}

					this.getUidsStatic(featSet)
						.forEach(uid => {
							const {name} = DataUtil.proxy.unpackUid("feat", uid, "feat", {isLower: true});
							out.push(name.toTitleCase());
						});

					return out.filter(Boolean).join("; ");
				},
				asMeta: true,
			},
		);
	}
}

StatGenUi.CompAsi = class extends BaseComponent {
	constructor ({parent}) {
		super();
		this._parent = parent;

		this._metasAsi = {ability: [], race: [], custom: []};

		this._doPulseThrottled = MiscUtil.throttle(this._doPulse_.bind(this), 50);
	}

	/**
	 * Add this to UI interactions rather than state hooks, as there is a copy of this component per tab.
	 */
	_doPulse_ () { this._parent.state.common_pulseAsi = !this._parent.state.common_pulseAsi; }

	_render_renderAsiFeatSection (propCnt, namespace, $wrpRows) {
		const hk = () => {
			let ix = 0;

			for (; ix < this._parent.state[propCnt]; ++ix) {
				const ix_ = ix;
				const {propMode, propIxFeat, propIxAsiPointOne, propIxAsiPointTwo, propIxFeatAbility, propFeatAbilityChooseFrom} = this._parent.getPropsAsi(ix_, namespace);

				if (!this._metasAsi[namespace][ix_]) {
					this._parent.state[propMode] = this._parent.state[propMode] || (namespace === "ability" ? "asi" : "feat");

					const $btnAsi = namespace !== "ability" ? null : $(`<button class="btn btn-xs btn-default w-50p">ASI</button>`)
						.click(() => {
							this._parent.state[propMode] = "asi";
							this._doPulseThrottled();
						});

					const $btnFeat = namespace !== "ability" ? $(`<div class="w-100p text-center">Feat</div>`) : $(`<button class="btn btn-xs btn-default w-50p">Feat</button>`)
						.click(() => {
							this._parent.state[propMode] = "feat";
							this._doPulseThrottled();
						});

					// region ASI
					let $stgAsi;
					if (namespace === "ability") {
						const $colsAsi = Parser.ABIL_ABVS.map((it, ixAsi) => {
							const updateDisplay = () => $ipt.val(Number(this._parent.state[propIxAsiPointOne] === ixAsi) + Number(this._parent.state[propIxAsiPointTwo] === ixAsi));

							const $ipt = $(`<input class="form-control form-control--minimal text-right input-xs statgen-shared__ipt" type="number" style="width: 42px;">`)
								.disableSpellcheck()
								.keydown(evt => { if (evt.key === "Escape") $ipt.blur(); })
								.change(() => {
									const raw = $ipt.val().trim();
									const asNum = Number(raw);

									const activeProps = [propIxAsiPointOne, propIxAsiPointTwo].filter(prop => this._parent.state[prop] === ixAsi);

									if (isNaN(asNum) || asNum <= 0) {
										this._parent.proxyAssignSimple(
											"state",
											{
												...activeProps.mergeMap(prop => ({[prop]: null})),
											},
										);
										updateDisplay();
										return this._doPulseThrottled();
									}

									if (asNum >= 2) {
										this._parent.proxyAssignSimple(
											"state",
											{
												[propIxAsiPointOne]: ixAsi,
												[propIxAsiPointTwo]: ixAsi,
											},
										);
										updateDisplay();
										return this._doPulseThrottled();
									}

									if (activeProps.length === 2) {
										this._parent.state[propIxAsiPointTwo] = null;
										updateDisplay();
										return this._doPulseThrottled();
									}

									if (this._parent.state[propIxAsiPointOne] == null) {
										this._parent.state[propIxAsiPointOne] = ixAsi;
										updateDisplay();
										return this._doPulseThrottled();
									}

									this._parent.state[propIxAsiPointTwo] = ixAsi;
									updateDisplay();
									this._doPulseThrottled();
								});

							const hkSelected = () => updateDisplay();
							this._parent.addHookBase(propIxAsiPointOne, hkSelected);
							this._parent.addHookBase(propIxAsiPointTwo, hkSelected);
							hkSelected();

							return $$`<div class="ve-flex-col h-100 mr-2">
							<div class="statgen-asi__cell text-center pb-1" title="${Parser.attAbvToFull(it)}">${it.toUpperCase()}</div>
							<div class="ve-flex-vh-center statgen-asi__cell relative">
								<div class="absolute no-events statgen-asi__disp-plus">+</div>
								${$ipt}
							</div>
						</div>`;
						});

						$stgAsi = $$`<div class="ve-flex-v-center">
							${$colsAsi}
						</div>`;
					}
					// endregion

					// region Feat
					const {$stgFeat, $btnChooseFeat, hkIxFeat} = this._render_getMetaFeat({propIxFeat, propIxFeatAbility, propFeatAbilityChooseFrom});
					// endregion

					const hkMode = () => {
						if (namespace === "ability") {
							$btnAsi.toggleClass("active", this._parent.state[propMode] === "asi");
							$btnFeat.toggleClass("active", this._parent.state[propMode] === "feat");
						}

						$btnChooseFeat.toggleVe(this._parent.state[propMode] === "feat");

						if (namespace === "ability") $stgAsi.toggleVe(this._parent.state[propMode] === "asi");
						$stgFeat.toggleVe(this._parent.state[propMode] === "feat");

						hkIxFeat();
					};
					this._parent.addHookBase(propMode, hkMode);
					hkMode();

					const $row = $$`<div class="ve-flex-v-end py-3 px-1">
						<div class="btn-group">${$btnAsi}${$btnFeat}</div>
						<div class="vr-4"></div>
						${$stgAsi}
						${$stgFeat}
					</div>`.appendTo($wrpRows);

					this._metasAsi[namespace][ix_] = {
						$row,
					};
				}

				this._metasAsi[namespace][ix_].$row.showVe().addClass("statgen-asi__row");
			}

			// Remove border styling from the last visible row
			if (this._metasAsi[namespace][ix - 1]) this._metasAsi[namespace][ix - 1].$row.removeClass("statgen-asi__row");

			for (; ix < this._metasAsi[namespace].length; ++ix) {
				if (!this._metasAsi[namespace][ix]) continue;
				this._metasAsi[namespace][ix].$row.hideVe().removeClass("statgen-asi__row");
			}
		};
		this._parent.addHookBase(propCnt, hk);
		hk();
	}

	_render_renderAdditionalFeatSection ({namespace, $wrpRows, propEntity}) {
		const fnsCleanupEnt = [];
		const fnsCleanupGroup = [];

		const {propIxSel, propPrefix} = this._parent.getPropsAdditionalFeats_(namespace);

		const resetGroupState = () => {
			const nxtState = Object.keys(this._parent.state)
				.filter(k => k.startsWith(propPrefix) && k !== propIxSel)
				.mergeMap(k => ({[k]: null}));
			this._parent.proxyAssignSimple("state", nxtState);
		};

		const hkEnt = (isNotFirstRun) => {
			fnsCleanupEnt.splice(0, fnsCleanupEnt.length).forEach(fn => fn());
			fnsCleanupGroup.splice(0, fnsCleanupGroup.length).forEach(fn => fn());
			$wrpRows.empty();

			if (isNotFirstRun) resetGroupState();

			const ent = this._parent[namespace]; // e.g. `this._parent.race`

			if ((ent?.feats?.length || 0) > 1) {
				const {$sel: $selGroup, unhook: unhookIxGroup} = UtilAdditionalFeats.getSelIxSetMeta({comp: this._parent, prop: propIxSel, available: ent.feats});
				fnsCleanupEnt.push(unhookIxGroup);
				$$`<div class="ve-flex-col mb-2">
					<div class="ve-flex-v-center mb-2">
						<div class="mr-2">Feat Set:</div>
						${$selGroup.addClass("max-w-200p")}
					</div>
				</div>`.appendTo($wrpRows);
			} else {
				this._parent.state[propIxSel] = 0;
			}

			const $wrpRowsInner = $(`<div class="w-100 ve-flex-col min-h-0"></div>`).appendTo($wrpRows);

			const hkIxSel = (isNotFirstRun) => {
				fnsCleanupGroup.splice(0, fnsCleanupGroup.length).forEach(fn => fn());
				$wrpRowsInner.empty();

				if (isNotFirstRun) resetGroupState();

				const featSet = ent?.feats?.[this._parent.state[propIxSel]];

				const uidsStatic = UtilAdditionalFeats.getUidsStatic(featSet);

				const $rows = [];

				uidsStatic.map((uid, ix) => {
					const {propIxFeatAbility, propFeatAbilityChooseFrom} = this._parent.getPropsAdditionalFeatsFeatSet_(namespace, "static", ix);
					const {name, source} = DataUtil.proxy.unpackUid("feat", uid, "feat", {isLower: true});
					const feat = this._parent.feats.find(it => it.name.toLowerCase() === name && it.source.toLowerCase() === source);
					const {$stgFeat, hkIxFeat, cleanup} = this._render_getMetaFeat({featStatic: feat, propIxFeatAbility, propFeatAbilityChooseFrom});
					fnsCleanupGroup.push(cleanup);
					hkIxFeat();

					const $row = $$`<div class="ve-flex-v-end py-3 px-1 statgen-asi__row">
						<div class="btn-group"><div class="w-100p text-center">Feat</div></div>
						<div class="vr-4"></div>
						${$stgFeat}
					</div>`.appendTo($wrpRowsInner);
					$rows.push($row);
				});

				[...new Array(featSet?.any || 0)].map((_, ix) => {
					const {propIxFeat, propIxFeatAbility, propFeatAbilityChooseFrom} = this._parent.getPropsAdditionalFeatsFeatSet_(namespace, "fromFilter", ix);
					const {$stgFeat, hkIxFeat, cleanup} = this._render_getMetaFeat({propIxFeat, propIxFeatAbility, propFeatAbilityChooseFrom});
					fnsCleanupGroup.push(cleanup);
					hkIxFeat();

					const $row = $$`<div class="ve-flex-v-end py-3 px-1 statgen-asi__row">
						<div class="btn-group"><div class="w-100p text-center">Feat</div></div>
						<div class="vr-4"></div>
						${$stgFeat}
					</div>`.appendTo($wrpRowsInner);
					$rows.push($row);
				});

				// Remove border styling from the last row
				if ($rows.last()) $rows.last().removeClass("statgen-asi__row");

				this._doPulseThrottled();
			};
			this._parent.addHookBase(propIxSel, hkIxSel);
			fnsCleanupEnt.push(() => this._parent.removeHookBase(propIxSel, hkIxSel));
			hkIxSel();
			this._doPulseThrottled();
		};
		this._parent.addHookBase(propEntity, hkEnt);
		hkEnt();
	}

	_render_getMetaFeat ({featStatic = null, propIxFeat = null, propIxFeatAbility, propFeatAbilityChooseFrom}) {
		if (featStatic && propIxFeat) throw new Error(`Cannot combine static feat and feat property!`);
		if (featStatic == null && propIxFeat == null) throw new Error(`Either a static feat or a feat property must be specified!`);

		const $btnChooseFeat = featStatic ? null : $(`<button class="btn btn-xxs btn-default mr-2" title="Choose a Feat"><span class="glyphicon glyphicon-search"></span></button>`)
			.click(async () => {
				const selecteds = await this._parent.modalFilterFeats.pGetUserSelection();
				if (selecteds == null || !selecteds.length) return;

				const selected = selecteds[0];
				const ix = this._parent.feats.findIndex(it => it.name === selected.name && it.source === selected.values.sourceJson);
				if (!~ix) throw new Error(`Could not find selected entity: ${JSON.stringify(selected)}`); // Should never occur
				this._parent.state[propIxFeat] = ix;

				this._doPulseThrottled();
			});

		// region Feat
		const $dispFeat = $(`<div class="ve-flex-v-center mr-2"></div>`);
		const $stgSelectAbilitySet = $$`<div class="ve-flex-v-center mr-2"></div>`;
		const $stgFeatNoChoice = $$`<div class="ve-flex-v-center mr-2"></div>`;
		const $stgFeatChooseAsiFrom = $$`<div class="ve-flex-v-end"></div>`;
		const $stgFeatChooseAsiWeighted = $$`<div class="ve-flex-v-center"></div>`;

		const $stgFeat = $$`<div class="ve-flex-v-center">
			${$btnChooseFeat}
			${$dispFeat}
			${$stgSelectAbilitySet}
			${$stgFeatNoChoice}
			${$stgFeatChooseAsiFrom}
			${$stgFeatChooseAsiWeighted}
		</div>`;

		const fnsCleanup = [];
		const fnsCleanupFeat = [];
		const fnsCleanupFeatAbility = [];

		const hkIxFeat = (isNotFirstRun) => {
			fnsCleanupFeat.splice(0, fnsCleanupFeat.length).forEach(fn => fn());
			fnsCleanupFeatAbility.splice(0, fnsCleanupFeatAbility.length).forEach(fn => fn());

			if (isNotFirstRun) {
				const nxtState = Object.keys(this._parent.state).filter(it => it.startsWith(propFeatAbilityChooseFrom)).mergeMap(it => ({[it]: null}));
				this._parent.proxyAssignSimple("state", nxtState);
			}

			const feat = featStatic || this._parent.feats[this._parent.state[propIxFeat]];

			$stgFeat.removeClass("ve-flex-v-end").addClass("ve-flex-v-center");
			$dispFeat.toggleClass("italic ve-muted", !feat);
			$dispFeat.html(feat ? Renderer.get().render(`{@feat ${feat.name.toLowerCase()}|${feat.source}}`) : `(Choose a feat)`);

			this._parent.state[propIxFeatAbility] = 0;

			$stgSelectAbilitySet.hideVe();
			if (feat) {
				if (feat.ability && feat.ability.length > 1) {
					const metaChooseAbilitySet = ComponentUiUtil.$getSelEnum(
						this._parent,
						propIxFeatAbility,
						{
							values: feat.ability.map((_, i) => i),
							fnDisplay: ix => Renderer.getAbilityData([feat.ability[ix]]).asText,
							asMeta: true,
						},
					);

					$stgSelectAbilitySet.showVe().append(metaChooseAbilitySet.$sel);
					metaChooseAbilitySet.$sel.change(() => this._doPulseThrottled());
					fnsCleanupFeat.push(() => metaChooseAbilitySet.unhook());
				}

				const hkAbilitySet = () => {
					fnsCleanupFeatAbility.splice(0, fnsCleanupFeatAbility.length).forEach(fn => fn());

					if (!feat.ability) {
						$stgFeatNoChoice.empty().hideVe();
						$stgFeatChooseAsiFrom.empty().hideVe();
						return;
					}

					const abilitySet = feat.ability[this._parent.state[propIxFeatAbility]];

					// region Static/no choices
					const ptsNoChoose = Parser.ABIL_ABVS.filter(ab => abilitySet[ab]).map(ab => `${Parser.attAbvToFull(ab)} ${UiUtil.intToBonus(abilitySet[ab])}`);
					$stgFeatNoChoice.empty().toggleVe(ptsNoChoose.length).html(`<div><span class="mr-2">\u2014</span>${ptsNoChoose.join(", ")}</div>`);
					// endregion

					// region Choices
					if (abilitySet.choose && abilitySet.choose.from) {
						$stgFeat.removeClass("ve-flex-v-center").addClass("ve-flex-v-end");
						$stgFeatChooseAsiFrom.showVe().empty();
						$stgFeatChooseAsiWeighted.empty().hideVe();

						const count = abilitySet.choose.count || 1;
						const amount = abilitySet.choose.amount || 1;

						const {rowMetas, cleanup: cleanupAsiPicker} = ComponentUiUtil.getMetaWrpMultipleChoice(
							this._parent,
							propFeatAbilityChooseFrom,
							{
								values: abilitySet.choose.from,
								fnDisplay: v => `${Parser.attAbvToFull(v)} ${UiUtil.intToBonus(amount)}`,
								count,
							},
						);
						fnsCleanupFeatAbility.push(() => cleanupAsiPicker());

						$stgFeatChooseAsiFrom.append(`<div><span class="mr-2">\u2014</span>choose ${count > 1 ? `${count} ` : ""}${UiUtil.intToBonus(amount)}</div>`);

						rowMetas.forEach(meta => {
							meta.$cb.change(() => this._doPulseThrottled());

							$$`<label class="ve-flex-col no-select">
								<div class="ve-flex-vh-center statgen-asi__cell-feat" title="${Parser.attAbvToFull(meta.value)}">${meta.value.toUpperCase()}</div>
								<div class="ve-flex-vh-center statgen-asi__cell-feat">${meta.$cb}</div>
							</label>`.appendTo($stgFeatChooseAsiFrom);
						});
					} else if (abilitySet.choose && abilitySet.choose.weighted) {
						// TODO(Future) unsupported, for now
						$stgFeatChooseAsiFrom.empty().hideVe();
						$stgFeatChooseAsiWeighted.showVe().html(`<i class="ve-muted">The selected ability score format is currently unsupported. Please check back later!</i>`);
					} else {
						$stgFeatChooseAsiFrom.empty().hideVe();
						$stgFeatChooseAsiWeighted.empty().hideVe();
					}
					// endregion

					this._doPulseThrottled();
				};
				this._parent.addHookBase(propIxFeatAbility, hkAbilitySet);
				fnsCleanupFeat.push(() => this._parent.removeHookBase(propIxFeatAbility, hkAbilitySet));
				hkAbilitySet();
			} else {
				$stgFeatNoChoice.empty().hideVe();
				$stgFeatChooseAsiFrom.empty().hideVe();
				$stgFeatChooseAsiWeighted.empty().hideVe();
			}

			this._doPulseThrottled();
		};

		if (!featStatic) {
			this._parent.addHookBase(propIxFeat, hkIxFeat);
			fnsCleanup.push(() => this._parent.removeHookBase(propIxFeat, hkIxFeat));
		}

		const cleanup = () => {
			fnsCleanup.splice(0, fnsCleanup.length).forEach(fn => fn());
			fnsCleanupFeat.splice(0, fnsCleanupFeat.length).forEach(fn => fn());
			fnsCleanupFeatAbility.splice(0, fnsCleanupFeatAbility.length).forEach(fn => fn());
		};

		return {$btnChooseFeat, $stgFeat, hkIxFeat, cleanup};
	}

	render ($wrpAsi) {
		const $wrpRowsAsi = $(`<div class="ve-flex-col w-100 overflow-y-auto"></div>`);
		const $wrpRowsRace = $(`<div class="ve-flex-col w-100 overflow-y-auto"></div>`);
		const $wrpRowsCustom = $(`<div class="ve-flex-col w-100 overflow-y-auto"></div>`);

		this._render_renderAsiFeatSection("common_cntAsi", "ability", $wrpRowsAsi);
		this._render_renderAsiFeatSection("common_cntFeatsCustom", "custom", $wrpRowsCustom);
		this._render_renderAdditionalFeatSection({propEntity: "common_ixRace", namespace: "race", $wrpRows: $wrpRowsRace});

		const $stgRace = $$`<div class="ve-flex-col">
			<hr class="hr-3 hr--dotted">
			<h4 class="my-2 bold">Racial Feats</h4>
			${$wrpRowsRace}
		</div>`;
		const hkIxRace = () => {
			const race = this._parent.race;
			$stgRace.toggleVe(!this._parent.isLevelUp && !!race?.feats);
		};
		this._parent.addHookBase("common_ixRace", hkIxRace);
		hkIxRace();

		const $iptCountFeatsCustom = ComponentUiUtil.$getIptInt(this._parent, "common_cntFeatsCustom", 0, {min: 0, max: StatGenUi._MAX_CUSTOM_FEATS})
			.addClass("w-100p text-center");

		$$($wrpAsi)`
			<h4 class="my-2 bold">Ability Score Increases</h4>
			${this._render_$getStageCntAsi()}
			${$wrpRowsAsi}

			${$stgRace}

			<hr class="hr-3 hr--dotted">
			<h4 class="my-2 bold">Additional Feats</h4>
			<label class="w-100 ve-flex-v-center mb-2">
				<div class="mr-2 no-shrink">Number of additional feats:</div>${$iptCountFeatsCustom}
			</label>
			${$wrpRowsCustom}
		`;
	}

	_render_$getStageCntAsi () {
		if (!this._parent.isCharacterMode) {
			const $iptCountAsi = ComponentUiUtil.$getIptInt(this._parent, "common_cntAsi", 0, {min: 0, max: 20})
				.addClass("w-100p text-center");
			return $$`<label class="w-100 ve-flex-v-center mb-2"><div class="mr-2 no-shrink">Number of Ability Score Increases to apply:</div>${$iptCountAsi}</label>`;
		}

		const $out = $$`<div class="w-100 ve-flex-v-center mb-2 italic ve-muted">No ability score increases available.</div>`;
		const hkCntAsis = () => $out.toggleVe(this._parent.state.common_cntAsi === 0);
		this._parent.addHookBase("common_cntAsi", hkCntAsis);
		hkCntAsis();
		return $out;
	}

	_getFormData_getForNamespace_basic (outs, outIsFormCompletes, outFeats, propCnt, namespace) {
		for (let i = 0; i < this._parent.state[propCnt]; ++i) {
			const {propMode, propIxFeat, propIxAsiPointOne, propIxAsiPointTwo, propIxFeatAbility, propFeatAbilityChooseFrom} = this._parent.getPropsAsi(i, namespace);

			if (this._parent.state[propMode] === "asi") {
				const out = {};

				let ttlChosen = 0;

				Parser.ABIL_ABVS.forEach((ab, abI) => {
					const increase = [this._parent.state[propIxAsiPointOne] === abI, this._parent.state[propIxAsiPointTwo] === abI].filter(Boolean).length;
					if (increase) out[ab] = increase;
					ttlChosen += increase;
				});

				const isFormComplete = ttlChosen === 2;

				outFeats[namespace].push(null); // Pad the array

				outs.push(out);
				outIsFormCompletes.push(isFormComplete);
			} else if (this._parent.state[propMode] === "feat") {
				const {isFormComplete, out} = this._getFormData_doAddFeatMeta({
					namespace,
					outFeats,
					propIxFeat,
					propIxFeatAbility,
					propFeatAbilityChooseFrom,
					type: "choose",
				});
				outs.push(out);
				outIsFormCompletes.push(isFormComplete);
			}
		}
	}

	_getFormData_getForNamespace_additional (outs, outIsFormCompletes, outFeats, namespace) {
		const ent = this._parent[namespace]; // e.g. `this._parent.race`
		if (!ent?.feats?.length) return;

		const {propIxSel} = this._parent.getPropsAdditionalFeats_(namespace);

		const featSet = ent.feats[this._parent.state[propIxSel]];
		if (!featSet) {
			outIsFormCompletes.push(false);
			return;
		}

		const uidsStatic = UtilAdditionalFeats.getUidsStatic(featSet);

		uidsStatic.map((uid, ix) => {
			const {propIxFeatAbility, propFeatAbilityChooseFrom} = this._parent.getPropsAdditionalFeatsFeatSet_(namespace, "static", ix);
			const {name, source} = DataUtil.proxy.unpackUid("feat", uid, "feat", {isLower: true});
			const feat = this._parent.feats.find(it => it.name.toLowerCase() === name && it.source.toLowerCase() === source);

			const {isFormComplete, out} = this._getFormData_doAddFeatMeta({
				namespace,
				outFeats,
				featStatic: feat,
				propIxFeatAbility,
				propFeatAbilityChooseFrom,
				type: "static",
			});

			outs.push(out);
			outIsFormCompletes.push(isFormComplete);
		});

		[...new Array(featSet.any || 0)].map((_, ix) => {
			const {propIxFeat, propIxFeatAbility, propFeatAbilityChooseFrom} = this._parent.getPropsAdditionalFeatsFeatSet_(namespace, "fromFilter", ix);

			const {isFormComplete, out} = this._getFormData_doAddFeatMeta({
				namespace,
				outFeats,
				propIxFeat,
				propIxFeatAbility,
				propFeatAbilityChooseFrom,
				type: "choose",
			});

			outs.push(out);
			outIsFormCompletes.push(isFormComplete);
		});
	}

	_getFormData_doAddFeatMeta ({namespace, outFeats, propIxFeat = null, featStatic = null, propIxFeatAbility, propFeatAbilityChooseFrom, type}) {
		if (featStatic && propIxFeat) throw new Error(`Cannot combine static feat and feat property!`);
		if (featStatic == null && propIxFeat == null) throw new Error(`Either a static feat or a feat property must be specified!`);

		const out = {};

		const feat = featStatic || this._parent.feats[this._parent.state[propIxFeat]];

		const featMeta = feat
			? {ix: this._parent.state[propIxFeat], uid: `${feat.name}|${feat.source}`, type}
			: {ix: -1, uid: null, type};
		outFeats[namespace].push(featMeta);

		if (!~featMeta.ix) return {isFormComplete: false, out};
		if (!feat.ability) return {isFormComplete: true, out};

		const abilitySet = feat.ability[this._parent.state[propIxFeatAbility] || 0];

		// Add static values
		Parser.ABIL_ABVS.forEach(ab => { if (abilitySet[ab]) out[ab] = abilitySet[ab]; });

		if (!abilitySet.choose) return {isFormComplete: true, out};

		let isFormComplete = true;

		// Track any bonuses chosen, so we can use `"inherit"` when handling a feats "additionalSpells" elsewhere
		featMeta.abilityChosen = {};

		if (abilitySet.choose.from) {
			if (isFormComplete) isFormComplete = !!this._parent.state[ComponentUiUtil.getMetaWrpMultipleChoice_getPropIsAcceptable(propFeatAbilityChooseFrom)];

			const ixs = ComponentUiUtil.getMetaWrpMultipleChoice_getSelectedIxs(this._parent, propFeatAbilityChooseFrom);
			ixs.map(it => abilitySet.choose.from[it]).forEach(ab => {
				const amount = abilitySet.choose.amount || 1;
				out[ab] = (out[ab] || 0) + amount;
				featMeta.abilityChosen[ab] = amount;
			});
		}

		return {isFormComplete, out};
	}

	getFormData () {
		const outs = [];
		const isFormCompletes = [];
		const feats = {ability: [], race: [], custom: []};

		this._getFormData_getForNamespace_basic(outs, isFormCompletes, feats, "common_cntAsi", "ability");
		this._getFormData_getForNamespace_basic(outs, isFormCompletes, feats, "common_cntFeatsCustom", "custom");
		this._getFormData_getForNamespace_additional(outs, isFormCompletes, feats, "race");

		const data = {};
		outs.filter(Boolean).forEach(abilBonuses => Object.entries(abilBonuses).forEach(([ab, bonus]) => data[ab] = (data[ab] || 0) + bonus));

		return {
			isFormComplete: isFormCompletes.every(Boolean),
			dataPerAsi: outs,
			data,
			feats,
		};
	}
};

StatGenUi.RenderableCollectionPbRules = class extends RenderableCollectionBase {
	constructor (statGenUi, $wrp) {
		super(statGenUi, "pb_rules");

		this._$wrp = $wrp;
	}

	getNewRender (rule) {
		const parentComp = this._comp;

		const comp = BaseComponent.fromObject(rule.entity);
		comp._addHookAll("state", () => {
			rule.entity = comp.toObject();
			parentComp._triggerCollectionUpdate("pb_rules");
		});

		const $dispCost = $(`<div class="ve-flex-vh-center"></div>`);
		const hkCost = () => $dispCost.text(comp._state.cost);
		comp._addHookBase("cost", hkCost);
		hkCost();

		const $iptCost = ComponentUiUtil.$getIptInt(comp, "cost", 0, {html: `<input class="form-control input-xs form-control--minimal text-center">`, fallbackOnNaN: 0});

		const hkIsCustom = () => {
			$dispCost.toggleVe(!parentComp.state.pb_isCustom);
			$iptCost.toggleVe(parentComp.state.pb_isCustom);
		};
		parentComp._addHookBase("pb_isCustom", hkIsCustom);
		hkIsCustom();

		const $btnDelete = $(`<button class="btn btn-xxs btn-danger" title="Delete"><span class="glyphicon glyphicon-trash"></span></button>`)
			.click(() => {
				if (parentComp.state.pb_rules.length === 1) return; // Never delete the final item
				parentComp.state.pb_rules = parentComp.state.pb_rules.filter(it => it !== rule);
			});

		const $wrpRow = $$`<div class="ve-flex py-1 stripe-even statgen-pb__row-cost">
			<div class="statgen-pb__col-cost ve-flex-vh-center">${comp._state.score}</div>
			<div class="statgen-pb__col-cost ve-flex-vh-center">${Parser.getAbilityModifier(comp._state.score)}</div>
			<div class="statgen-pb__col-cost ve-flex-vh-center px-3">
				${$dispCost}
				${$iptCost}
			</div>
			<div class="statgen-pb__col-cost-delete">${$btnDelete}</div>
		</div>`.appendTo(this._$wrp);

		const hkRules = () => {
			$btnDelete.toggleVe((parentComp.state.pb_rules[0] === rule || parentComp.state.pb_rules.last() === rule) && parentComp.state.pb_isCustom);
		};
		parentComp._addHookBase("pb_rules", hkRules);
		parentComp._addHookBase("pb_isCustom", hkRules);
		hkRules();

		return {
			comp,
			$wrpRow,
			fnCleanup: () => {
				parentComp._removeHookBase("pb_isCustom", hkIsCustom);
				parentComp._removeHookBase("pb_isCustom", hkRules);
				parentComp._removeHookBase("pb_rules", hkRules);
			},
		};
	}

	doUpdateExistingRender (renderedMeta, rule) {
		renderedMeta.comp._proxyAssignSimple("state", rule.entity, true);
	}

	doDeleteExistingRender (renderedMeta) {
		renderedMeta.fnCleanup();
	}

	doReorderExistingComponent (renderedMeta, rule) {
		const parent = this._comp;

		const ix = parent.state.pb_rules.map(it => it.id).indexOf(rule.id);
		const curIx = this._$wrp.find(`.statgen-pb__row-cost`).index(renderedMeta.$wrpRow);

		const isMove = !this._$wrp.length || curIx !== ix;
		if (isMove) renderedMeta.$wrpRow.detach().appendTo(this._$wrp);
	}
};
