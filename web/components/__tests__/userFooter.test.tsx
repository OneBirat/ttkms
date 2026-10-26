import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@/lib/api";
import { UserFooter, initialsOf, rolePlace } from "../UserFooter";

const user = {
  id: 1,
  username: "ram",
  phone: null,
  full_name: "Ram Bahadur Thapa",
  role: "manager",
  role_label: "Manager",
  employee_id: null,
  last_login_at: null,
  must_change_password: false,
} as const;

describe("sidebar footer", () => {
  it("initials, and role · the active branch (never all branches)", () => {
    assert.equal(initialsOf("Ram Bahadur Thapa"), "RT");
    assert.equal(initialsOf("Administrator"), "AD");
    assert.equal(initialsOf("  "), "?");
    assert.equal(rolePlace(user, "Main branch"), "Manager · Main branch");
    assert.equal(rolePlace({ role_label: "Admin" }, "Branch 2"), "Admin · Branch 2");
    assert.equal(rolePlace(user, null), "Manager");
  });

  it("renders the avatar, name, place and a Log out button", () => {
    const html = renderToStaticMarkup(createElement(UserFooter, { user: user as unknown as User, place: "Manager · Main branch", onLogout: () => {} }));
    assert.match(html, />RT</);
    assert.match(html, /Ram Bahadur Thapa/);
    assert.match(html, /Manager · Main branch/);
    assert.match(html, /<button[^>]*type="button"[^>]*>.*Log out<\/button>/);
  });
});
