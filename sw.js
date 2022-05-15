/**
 * Dbgging notes:
 *   - **CTRL+F5 is unreliable**
 *   - spam "Clear Site Data" in DevTools
 *   - use "update on reload" in Service Workers DevTools section
 *   - sanity-check code to ensure it has updated
 */

"use strict";

importScripts("./js/sw-files.js");

const cacheName = /* 5ETOOLS_VERSION__OPEN */"1.154.2"/* 5ETOOLS_VERSION__CLOSE */;
const cacheableFilenames = new Set(filesToCache);

let isCacheRunning;
let _port;

function getPath (urlOrPath) {
	// Add a fake domain name to allow proper URL conversion
	if (urlOrPath.startsWith("/")) urlOrPath = `https://5e.com${urlOrPath}`;
	return (new URL(urlOrPath)).pathname;
}

/** Estimate a reasonable cache timeout depending on file type. */
function getCacheTimeout (url) {
	const ext = url.toLowerCase().trim().split(".").slice(-1)[0];
	switch (ext) {
		case "mp3":
		case "png":
		case "jpg":
		case "jpeg":
		case "webp":
		case "svg":
		case "gif":
			return 15 * 1000;
		case "html":
		case "webmanifest":
		case "tff":
		case "eot":
		case "woff":
		case "woff2":
			return 3 * 1000;
		case "json":
		case "css":
		case "js":
			return 7.5 * 1000;
		default:
			return 7.5 * 1000;
	}
}

// Installing Service Worker
self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", evt => {
	evt.waitUntil(self.clients.claim());

	// Remove any outdated caches
	evt.waitUntil((async () => {
		const cacheNames = await caches.keys();
		await Promise.all(cacheNames.filter(name => name !== cacheName).map(name => caches.delete(name)));
	})());
});

async function pGetOrCache (url) {
	const path = getPath(url);
	const cache = await caches.open(cacheName);

	let retryCount = 2;
	while (true) {
		let response;
		try {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), getCacheTimeout(url));
			response = await fetch(url, {signal: controller.signal, cache: "reload"});
		} catch (e) {
			if (--retryCount) continue;
			console.error(e, url);
			break;
		}
		// throttle this with `await` to ensure Firefox doesn't die under load
		await cache.put(path, response.clone());
		return response;
	}

	// If the request fails, try to respond with a cached copy
	console.log(`Returning cached copy of ${url} (if it exists)`);
	return cache.match(path);
}

async function pDelay (msecs) {
	return new Promise(resolve => setTimeout(() => resolve(), msecs));
}

// All data loading (JSON, images, etc) passes through here when the service worker is active
self.addEventListener("fetch", evt => {
	const url = evt.request.url;
	const path = getPath(url);

	if (!cacheableFilenames.has(path)) return evt.respondWith(fetch(evt.request));

	evt.respondWith(pGetOrCache(url));
});

async function _doSendMessage (content) { _port.postMessage(content); }

/**
 * We chunk the preloading to allow for a continual back-and-forth of (relatively) low-delay events with the client.
 * This allows us to avoid timeouts/silent failures (see: https://bugzilla.mozilla.org/show_bug.cgi?id=1610772).
 * This is especially notable on Firefox, but Chrome seems to have a similar "problem," albeit with a longer delay
 * before dying.
 */
const _CHUNK_MAXIMUM_DURATION = 10_000;

async function _doCache ({evt, index}) {
	const tStart = Date.now();
	let i = index;
	for (; i < filesToCache.length; ++i) {
		if (!isCacheRunning) return _doSendMessage({type: "download-cancelled"});
		try {
			// Wrap this in a second timeout, because the internal abort controller doesn't work(?)
			const raceResult = await Promise.race([
				pGetOrCache(filesToCache[i]),
				pDelay(getCacheTimeout(filesToCache[i])),
			]);
			if (raceResult == null) return _doSendMessage({type: "download-error", message: `Failed to cache "${filesToCache[i]}"`});
		} catch (e) {
			console.error(e, filesToCache[i]);
			debugger
			return _doSendMessage({evt, content: {type: "download-error", message: e.name || e.message || ((e.stack || "").trim())}});
		}
		if (!isCacheRunning) return _doSendMessage({type: "download-cancelled"});
		const isChunkTimeout = (Date.now() - tStart) >= _CHUNK_MAXIMUM_DURATION;
		if (i % 17 === 0 || isChunkTimeout) _doSendMessage({type: "download-progress", data: {pct: `${((i / filesToCache.length) * 100).toFixed(2)}%`}});
		if (isChunkTimeout) break;
	}

	if (i >= filesToCache.length) {
		console.debug(`All files downloaded!`);
		return _doSendMessage({type: "download-progress", data: {pct: `100%`}});
	}

	console.debug(`${i} files downloaded...`);
	_doSendMessage({type: "download-continue", data: {index: i}});
}

self.addEventListener("message", async evt => {
	_port = evt.ports?.[0] || _port;
	const msg = evt.data;
	switch (msg.type) {
		case "cache-cancel":
			isCacheRunning = false;
			break;
		case "cache-start": {
			isCacheRunning = true;
			await _doCache({evt, index: 0});
			break;
		}
		case "cache-continue": {
			await _doCache({evt, index: msg.data.index});
			break;
		}
	}
});
