import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// Use a temporary storage folder so tests never touch real users
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "yngo-auth-test-"));

const { loadSessionSecret, registerUser, loginUser, createSessionToken, readSessionToken } = await import("../src/auth.js");
await loadSessionSecret();

test("register checks email and password length", async () => {
    assert.equal((await registerUser("not-an-email", "secret-password")).code, "INVALID_EMAIL");
    assert.equal((await registerUser("a@b.com", "short")).code, "PASSWORD_TOO_SHORT");
});

test("register then log in, wrong password is refused", async () => {
    const registration = await registerUser("Dev@Example.com", "secret-password");
    assert.equal(registration.created, true);
    assert.equal(registration.user.email, "dev@example.com");
    assert.equal(registration.user.password, undefined);

    assert.equal((await registerUser("dev@example.com", "another-password")).code, "EMAIL_ALREADY_REGISTERED");
    assert.equal((await loginUser("dev@example.com", "secret-password")).loggedIn, true);
    assert.equal((await loginUser("dev@example.com", "wrong-password")).code, "WRONG_EMAIL_OR_PASSWORD");
    assert.equal((await loginUser("nobody@example.com", "secret-password")).code, "WRONG_EMAIL_OR_PASSWORD");
});

test("session token works, and a changed token is refused", () => {
    const sessionToken = createSessionToken("user123");
    assert.equal(readSessionToken(sessionToken), "user123");

    const fakeToken = sessionToken.replace("user123", "admin99");
    assert.equal(readSessionToken(fakeToken), null);
    assert.equal(readSessionToken("garbage"), null);
});
