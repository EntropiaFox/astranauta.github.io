function parsesize (size) {
	if (size == "T") size = "Tiny";
	if (size == "S") size = "Small";
	if (size == "M") size = "Medium";
	if (size == "L") size = "Large";
	if (size == "H") size = "Huge";
	if (size == "G") size = "Gargantuan";
	return size;
}

function parsesource (src) {
	source = src;
	if (source === "Player's Handbook") source = "PHB";
	if (source === "Curse of Strahd") source = "CoS";
	if (source === "Sword Coast Adventurer's Guide") source = "SCAG";
	if (source === "Unearthed Arcana") source = "UA";
	if (source === "Plane Shift Innistrad") source = "PSI";
	if (source === "Plane Shift Amonkhet") source = "PSA";
	return source;
}

function tagcontent (curitem, tag, multi=false) {
	if (!curitem.getElementsByTagName(tag).length) return false;
	return curitem.getElementsByTagName(tag)[0].childNodes[0].nodeValue;
}

function asc_sort(a, b){
    return ($(b).text()) < ($(a).text()) ? 1 : -1;
}

function dec_sort(a, b){
    return ($(b).text()) > ($(a).text()) ? 1 : -1;
}

window.onload = loadbackgrounds;

var tabledefault = "";

function loadbackgrounds () {
	tabledefault = $("#stats").html();
	var bglist = backgrounddata.compendium.background;

	for (var i = 0; i < bglist.length; i++) {
		var curbg = bglist[i];
		var name = curbg.name;
		$("ul.backgrounds").append("<li id='"+i+"' data-link='"+encodeURI(name)+"'><span class='name col-xs-9'>"+name.replace("Variant ","")+"</span> <span class='source col-xs-3' title='"+curbg.source+"'>"+parsesource(curbg.source)+"</span></li>");

		if (!$("select.sourcefilter:contains(\""+curbg.source+"\")").length) {
			$("select.sourcefilter").append("<option value='"+parsesource(curbg.source)+"'>"+curbg.source+"</option>");
		}
	}

	$("select.sourcefilter option").sort(asc_sort).appendTo('select.sourcefilter');
	$("select.sourcefilter").val("All");

	var options = {
		valueNames: ['name', 'source'],
		listClass: "backgrounds"
	}

	var backgroundslist = new List("listcontainer", options);
	backgroundslist.sort ("name")

	$("form#filtertools select").change(function(){
		var sourcefilter = $("select.sourcefilter").val();

		backgroundslist.filter(function(item) {
			if (sourcefilter === "All" || item.values().source.indexOf(sourcefilter) !== -1) return true;
			return false;
		});
	});


	$("ul.list li").mousedown(function(e) {
		if (e.which === 2) {
			console.log("#"+$(this).attr("data-link"))
			window.open("#"+$(this).attr("data-link"), "_blank").focus();
			e.preventDefault();
			e.stopPropagation();
			return;
		}
	});

	$("ul.list li").click(function(e) {
		usebackground($(this).attr("id"));
		document.title = decodeURI($(this).attr("data-link")) + " - 5etools Backgrounds";
		window.location = "#"+$(this).attr("data-link");
	});

	if (window.location.hash.length) {
		$("ul.list li[data-link='"+window.location.hash.split("#")[1]+"']:eq(0)").click();
	} else $("ul.list li:eq(0)").click();

	// reset button
	$("button#reset").click(function() {
		$("#search").val("");
		backgroundslist.search("");
		backgroundslist.sort("name");
		backgroundslist.update();
	})
}

function usebackground (id) {
	$("#stats").html(tabledefault);
	var bglist = backgrounddata.compendium.background;
	var curbg = bglist[id];

	var name = curbg.name;
	$("th#name").html(name);

	var traitlist = curbg.trait;
	$("tr.trait").remove();
	for (var n = traitlist.length-1; n >= 0; n--) {
		var traitname = traitlist[n].name;
		var texthtml = "<span class='name'>"+traitname+".</span> ";
		var textlist = traitlist[n].text;
		texthtml = texthtml + "<span>"+textlist[0]+"</span> ";

		for (var i = 1; i < textlist.length; i++) {
			if (!textlist[i]) continue;
			if (textlist[i].indexOf ("Source: ") !== -1) continue;
			texthtml = texthtml + "<p>"+textlist[i]+"</p>";
		}

        var subtraitlist = traitlist[n].subtrait;
		if (subtraitlist !== undefined) {
			var k = 0;
            var subtrait;
			for (var j = 0; j < subtraitlist.length; j++) {
                texthtml = texthtml + "<p class='subtrait'>";
				subtrait = subtraitlist[j];
				texthtml = texthtml + "<span class='name'>"+subtrait.name+".</span> ";
				for (k = 0; k < subtrait.text.length; k++) {
					if (!subtrait.text[k]) continue;
					if (k === 0) {
                        texthtml = texthtml + "<span>" + subtrait.text[k] + "</span>";
                    } else {
                        texthtml = texthtml + "<p class='subtrait'>" + subtrait.text[k] + "</p>";
					}
				}
                texthtml = texthtml + "</p>";
			}
		}

		$("tr#traits").after("<tr class='trait'><td colspan='6' class='trait"+i+"'>"+texthtml+"</td></tr>");
	}

};
