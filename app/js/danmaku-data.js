/* The few protobuf fields needed to display ordinary bilibili danmaku.
 * Deliberately small: no protobuf runtime or full-video history in TV memory. */
var DanmakuData = (function () {
    "use strict";

    var MAX_BYTES = 1024 * 1024;
    var MAX_ITEMS = 6000;
    var decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

    function varint(bytes, at, end) {
        var value = 0, factor = 1, count = 0, b;
        do {
            if (at >= end || ++count > 10) { throw new Error("bad danmaku varint"); }
            b = bytes[at++];
            value += (b & 127) * factor;
            factor *= 128;
        } while (b & 128);
        return { value: value, next: at };
    }

    function field(bytes, at, end) {
        var tag = varint(bytes, at, end), kind = tag.value & 7;
        if (!tag.value || (kind !== 0 && kind !== 1 && kind !== 2 && kind !== 5)) {
            throw new Error("bad danmaku field");
        }
        var value = 0, start = tag.next, stop = start;
        if (kind === 0) {
            var n = varint(bytes, start, end);
            value = n.value; stop = n.next;
        } else if (kind === 1) { stop += 8; }
        else if (kind === 5) { stop += 4; }
        else {
            var len = varint(bytes, start, end);
            start = len.next;
            stop = start + len.value;
        }
        if (stop > end || stop < start) { throw new Error("bad danmaku length"); }
        return { number: tag.value >>> 3, kind: kind, value: value,
                 start: start, end: stop };
    }

    function utf8(bytes, start, end) {
        if (decoder) { return decoder.decode(bytes.subarray(start, end)); }
        /* TextDecoder exists on Tizen 5.5; this also permits older test engines. */
        var escaped = "";
        for (var i = start; i < end; i++) {
            escaped += "%" + ("0" + bytes[i].toString(16)).slice(-2);
        }
        try { return decodeURIComponent(escaped); } catch (e) { return ""; }
    }

    function item(bytes, start, end) {
        var at = start, progress = -1, mode = 0, content = "";
        while (at < end) {
            var f = field(bytes, at, end);
            if (f.number === 2 && f.kind === 0) { progress = f.value; }
            else if (f.number === 3 && f.kind === 0) { mode = f.value; }
            else if (f.number === 7 && f.kind === 2 && f.end - f.start <= 600) {
                content = utf8(bytes, f.start, f.end);
            }
            at = f.end;
        }
        /* Advanced/BAS/reverse and picture danmaku need separate renderers.
         * Showing them as ordinary text would misrepresent their timing. */
        if (progress < 0 || progress > 86400000 || mode < 1 || mode > 3 ||
                !content || content.length > 200) { return null; }
        return { at: progress, text: content };
    }

    function parse(buffer) {
        if (!buffer || !buffer.byteLength || buffer.byteLength > MAX_BYTES) {
            throw new Error("danmaku segment too large or empty");
        }
        var bytes = new Uint8Array(buffer), rows = [], at = 0;
        while (at < bytes.length) {
            var f = field(bytes, at, bytes.length);
            if (f.number === 1 && f.kind === 2 && rows.length < MAX_ITEMS) {
                var row = item(bytes, f.start, f.end);
                if (row) { rows.push(row); }
            }
            at = f.end;
        }
        rows.sort(function (a, b) { return a.at - b.at; });
        return rows;
    }

    return { parse: parse };
})();
