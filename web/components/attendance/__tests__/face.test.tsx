import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FaceContent } from "../Face";
import { thumbUrl } from "@/app/people/_lib/helpers";

describe("employee photos on the screens", () => {
  it("attendance avatars: the thumbnail when there is a photo, else initials", () => {
    const url = "/api/payroll/employees/6/photo?size=thumb&v=2d25c4f28f1e3920";
    const html = renderToStaticMarkup(createElement(FaceContent, { employee: { name: "Anita Gurung", photo_url: url } }));
    assert.match(html, /<img src="\/api\/payroll\/employees\/6\/photo\?size=thumb&amp;v=2d25c4f28f1e3920"/);
    assert.match(html, /loading="lazy"/);
    assert.equal(renderToStaticMarkup(createElement(FaceContent, { employee: { name: "Anita Gurung", photo_url: null } })), "AG");
  });

  it("people lists and avatars use the thumbnail, falling back to the full photo", () => {
    assert.equal(thumbUrl({ photo_url: "/full?v=1", photo_thumb_url: "/thumb?v=1" }), "/thumb?v=1");
    assert.equal(thumbUrl({ photo_url: "data:image/png;base64,xx" }), "data:image/png;base64,xx");
    assert.equal(thumbUrl({ photo_url: null, photo_thumb_url: null }), null);
  });
});
