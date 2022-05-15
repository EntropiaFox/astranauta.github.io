class RenderCharCreationOptions {
	static $getRenderedCharCreationOption (it) {
		const renderStack = [];

		const prerequisite = Renderer.utils.getPrerequisiteHtml(it.prerequisite);

		const preText = Renderer.charoption.getOptionTypePreText(it.optionType);
		if (preText) renderStack.push(preText);

		const entryList = {type: "entries", entries: it.entries};
		Renderer.get().setFirstSection(true).recursiveRender(entryList, renderStack);

		return $$`
		${Renderer.utils.getBorderTr()}
		${Renderer.utils.getExcludedTr({entity: it, dataProp: "charoption"})}
		${Renderer.utils.getNameTr(it, {page: UrlUtil.PG_CHAR_CREATION_OPTIONS})}
		${prerequisite ? `<tr><td colspan="6"><span class="prerequisite">${prerequisite}</span></td></tr>` : ""}
		<tr><td class="divider" colspan="6"><div></div></td></tr>
		<tr class="text"><td colspan="6">${renderStack.join("")}</td></tr>
		${Renderer.utils.getPageTr(it)}
		${Renderer.utils.getBorderTr()}
		`;
	}
}
