"use strict";

class LanguagesPage extends ListPage {
	constructor () {
		const pageFilter = new PageFilterLanguages();
		super({
			dataSource: DataUtil.language.loadJSON,

			pageFilter,

			listClass: "languages",

			sublistClass: "sublanguages",

			dataProps: ["language"],
		});
	}

	getListItem (it, anI, isExcluded) {
		this._pageFilter.mutateAndAddToFilters(it, isExcluded);

		const eleLi = document.createElement("div");
		eleLi.className = `lst__row ve-flex-col ${isExcluded ? "lst__row--blacklisted" : ""}`;

		const source = Parser.sourceJsonToAbv(it.source);
		const hash = UrlUtil.autoEncodeHash(it);

		eleLi.innerHTML = `<a href="#${hash}" class="lst--border lst__row-inner">
			<span class="col-6 bold pl-0">${it.name}</span>
			<span class="col-2 text-center">${(it.type || "\u2014").uppercaseFirst()}</span>
			<span class="col-2 text-center">${(it.script || "\u2014").toTitleCase()}</span>
			<span class="col-2 text-center ${Parser.sourceJsonToColor(it.source)} pr-0" title="${Parser.sourceJsonToFull(it.source)}" ${BrewUtil2.sourceJsonToStyle(it.source)}>${source}</span>
		</a>`;

		const listItem = new ListItem(
			anI,
			eleLi,
			it.name,
			{
				hash,
				source,
				dialects: it.dialects || [],
				type: it.type || "",
				script: it.script || "",
			},
			{
				isExcluded,
			},
		);

		eleLi.addEventListener("click", (evt) => this._list.doSelect(listItem, evt));
		eleLi.addEventListener("contextmenu", (evt) => ListUtil.openContextMenu(evt, this._list, listItem));

		return listItem;
	}

	handleFilterChange () {
		const f = this._filterBox.getValues();
		this._list.filter(item => this._pageFilter.toDisplay(f, this._dataList[item.ix]));
		FilterBox.selectFirstVisible(this._dataList);
	}

	pGetSublistItem (it, ix) {
		const hash = UrlUtil.autoEncodeHash(it);

		const $ele = $(`<div class="lst__row lst__row--sublist ve-flex-col">
			<a href="#${hash}" class="lst--border lst__row-inner">
				<span class="bold col-8 pl-0">${it.name}</span>
				<span class="col-2 text-center">${(it.type || "\u2014").uppercaseFirst()}</span>
				<span class="col-2 text-center pr-0">${(it.script || "\u2014").toTitleCase()}</span>
			</a>
		</div>`)
			.contextmenu(evt => ListUtil.openSubContextMenu(evt, listItem))
			.click(evt => ListUtil.sublist.doSelect(listItem, evt));

		const listItem = new ListItem(
			ix,
			$ele,
			it.name,
			{
				hash,
				type: it.type || "",
				script: it.script || "",
			},
		);
		return listItem;
	}

	doLoadHash (id) {
		this._$pgContent.empty();
		const it = this._dataList[id];

		const buildStatsTab = () => {
			this._$pgContent.append(RenderLanguages.$getRenderedLanguage(it));
		};

		const buildFluffTab = (isImageTab) => {
			return Renderer.utils.pBuildFluffTab({
				isImageTab,
				$content: this._$pgContent,
				entity: it,
				pFnGetFluff: Renderer.language.pGetFluff,
			});
		};

		const tabMetas = [
			new Renderer.utils.TabButton({
				label: "Traits",
				fnPopulate: buildStatsTab,
				isVisible: true,
			}),
			new Renderer.utils.TabButton({
				label: "Info",
				fnPopulate: buildFluffTab,
				isVisible: Renderer.utils.hasFluffText(it, "languageFluff"),
			}),
			new Renderer.utils.TabButton({
				label: "Images",
				fnPopulate: buildFluffTab.bind(null, true),
				isVisible: Renderer.utils.hasFluffImages(it, "languageFluff"),
			}),
			new Renderer.utils.TabButton({
				label: "Fonts",
				fnPopulate: () => {
					this._$pgContent.append(Renderer.utils.getBorderTr());
					this._$pgContent.append(Renderer.utils.getNameTr(it));
					const $td = $(`<td colspan="6" class="text"/>`);
					$$`<tr class="text">${$td}</tr>`.appendTo(this._$pgContent);
					this._$pgContent.append(Renderer.utils.getBorderTr());

					const allFonts = [...it.fonts || [], ...it._fonts || []];

					if (!allFonts || !allFonts.length) {
						$td.append("<i>No fonts available.</i>");
						return;
					}

					const $styleFont = $(`<style/>`);

					let lastStyleIndex = null;
					let lastStyleClass = null;
					const renderStyle = (ix) => {
						if (ix === lastStyleIndex) return;

						const font = allFonts[ix];
						const slugName = Parser.stringToSlug(font.split("/").last().split(".")[0]);

						const styleClass = `languages__sample--${slugName}`;

						$styleFont.empty().append(`
						@font-face { font-family: ${slugName}; src: url('${font}'); }
						.${styleClass} { font-family: ${slugName}, sans-serif; }
					`);

						if (lastStyleClass) $ptOutput.removeClass(lastStyleClass);
						lastStyleClass = styleClass;
						$ptOutput.addClass(styleClass);
						lastStyleIndex = ix;
					};

					const saveTextDebounced = MiscUtil.debounce((text) => StorageUtil.pSetForPage("sampleText", text), 500);
					const updateText = (val) => {
						if (val === undefined) val = $iptSample.val();
						else $iptSample.val(val);
						$ptOutput.text(val);
						saveTextDebounced(val);
					};

					const DEFAULT_TEXT = "The big quick brown flumph jumped over the lazy dire xorn";

					const $iptSample = $(`<textarea class="form-control w-100 mr-2 resize-vertical font-ui mb-2" style="height: 110px">${DEFAULT_TEXT}</textarea>`)
						.keyup(() => updateText())
						.change(() => updateText());

					const $selFont = allFonts.length === 1
						? null
						: $(`<select class="form-control font-ui languages__sel-sample input-xs">${allFonts.map((f, i) => `<option value="${i}">${f.split("/").last().split(".")[0]}</option>`).join("")}</select>`)
							.change(() => {
								const ix = Number($selFont.val());
								renderStyle(ix);
							});

					const $ptOutput = $(`<pre class="languages__sample p-2 mb-0">${DEFAULT_TEXT}</pre>`);

					renderStyle(0);

					StorageUtil.pGetForPage("sampleText")
						.then(val => {
							if (val != null) updateText(val);
						});

					$$`<div class="ve-flex-col w-100">
						${$styleFont}
						${$selFont ? $$`<label class="ve-flex-v-center mb-2"><div class="mr-2">Font:</div>${$selFont}</div>` : ""}
						${$iptSample}
						${$ptOutput}
						<hr class="hr-4">
						<h5 class="mb-2 mt-0">Downloads</h5>
						<ul class="pl-5 mb-0">
							${allFonts.map(f => `<li><a href="${f}" target="_blank">${f.split("/").last()}</a></li>`).join("")}
						</ul>
					</div>`.appendTo($td);
				},
				isVisible: [...it.fonts || [], ...it._fonts || []].length > 0,
			}),
		];

		Renderer.utils.bindTabButtons({
			tabButtons: tabMetas.filter(it => it.isVisible),
			tabLabelReference: tabMetas.map(it => it.label),
		});

		ListUtil.updateSelected();
	}
}

const languagesPage = new LanguagesPage();
window.addEventListener("load", () => languagesPage.pOnLoad());
