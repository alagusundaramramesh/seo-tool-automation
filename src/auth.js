import crypto from "crypto";
import { saveFile, readFile } from "./storage.js";
import CONFIG from "./config.js";

// Accounts and login.
//
// Users are saved in storage (local disk or S3), one file each: users/<userId>.json
// The userId is made from the email, so we can find a user by email without a database.
// Passwords are never saved, only a scrypt hash with a random salt.
//
// After login the browser gets a cookie "yngo_session" = "<userId>.<expiresAt>.<signature>".
// The signature is an HMAC made with the session secret, so the cookie cannot be faked.

const SESSION_COOKIE_NAME = "yngo_session";
const SESSION_DAYS = 7;
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

let sessionSecret = "";
const failedLoginsByEmail = {};

// Called once when the server starts
export async function loadSessionSecret() {
    if (CONFIG.SESSION_SECRET) {
        sessionSecret = CONFIG.SESSION_SECRET;
        return;
    }

    // Keep the secret in storage so users stay logged in after a restart
    const savedSecret = await readFile("settings/session-secret.txt");
    if (savedSecret) {
        sessionSecret = savedSecret.trim();
        return;
    }

    sessionSecret = crypto.randomBytes(32).toString("hex");
    await saveFile("settings/session-secret.txt", sessionSecret, "text/plain");
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function getUserIdForEmail(email) {
    return crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 24);
}

export function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function isPasswordCorrect(password, user) {
    const passwordHash = Buffer.from(hashPassword(password, user.passwordSalt), "hex");
    const savedHash = Buffer.from(user.passwordHash, "hex");
    // timingSafeEqual takes the same time for every wrong password, so attackers learn nothing from timing
    return passwordHash.length === savedHash.length && crypto.timingSafeEqual(passwordHash, savedHash);
}

async function getUser(userId) {
    const userText = await readFile(`users/${userId}.json`);
    return userText ? JSON.parse(userText) : null;
}

// Returns { created: true, user } or { created: false, code, reason }
export async function registerUser(email, password) {
    const cleanEmail = normalizeEmail(email);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return { created: false, code: "INVALID_EMAIL", reason: "Please enter a valid email address" };
    }

    if (!password || password.length < 8) {
        return { created: false, code: "PASSWORD_TOO_SHORT", reason: "Password must be at least 8 characters" };
    }

    const userId = getUserIdForEmail(cleanEmail);
    if (await getUser(userId)) {
        return { created: false, code: "EMAIL_ALREADY_REGISTERED", reason: "An account with this email already exists. Please log in." };
    }

    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const user = {
        userId: userId,
        email: cleanEmail,
        passwordSalt: passwordSalt,
        passwordHash: hashPassword(password, passwordSalt),
        createdAt: new Date().toISOString()
    };

    await saveFile(`users/${userId}.json`, JSON.stringify(user, null, 2), "application/json");
    return { created: true, user };
}

function isLoginBlocked(email) {
    const failedLogins = failedLoginsByEmail[email];
    if (!failedLogins) {
        return false;
    }

    if (Date.now() - failedLogins.firstFailedAt > FAILED_LOGIN_WINDOW_MS) {
        delete failedLoginsByEmail[email];
        return false;
    }

    return failedLogins.count >= MAX_FAILED_LOGINS;
}

function recordFailedLogin(email) {
    if (!failedLoginsByEmail[email]) {
        failedLoginsByEmail[email] = { count: 0, firstFailedAt: Date.now() };
    }
    failedLoginsByEmail[email].count++;
}

// Returns { loggedIn: true, user } or { loggedIn: false, code, reason }
export async function loginUser(email, password) {
    const cleanEmail = normalizeEmail(email);

    if (isLoginBlocked(cleanEmail)) {
        return { loggedIn: false, code: "TOO_MANY_ATTEMPTS", reason: "Too many wrong passwords. Please wait 15 minutes." };
    }

    const user = await getUser(getUserIdForEmail(cleanEmail));

    // Same message for "no such user" and "wrong password", so nobody can check which emails have accounts
    if (!user || !password || !isPasswordCorrect(password, user)) {
        recordFailedLogin(cleanEmail);
        return { loggedIn: false, code: "WRONG_EMAIL_OR_PASSWORD", reason: "Email or password is wrong" };
    }

    delete failedLoginsByEmail[cleanEmail];
    return { loggedIn: true, user };
}

// A guest can audit without an account. The guest is a user without email or password,
// so all the "own audits only" rules work the same way. Saved at users/guest-<random>.json
export async function createGuestUser() {
    const guestUser = {
        userId: `guest-${crypto.randomBytes(10).toString("hex")}`,
        email: "",
        isGuest: true,
        createdAt: new Date().toISOString()
    };

    await saveFile(`users/${guestUser.userId}.json`, JSON.stringify(guestUser, null, 2), "application/json");
    return guestUser;
}

function signText(text) {
    return crypto.createHmac("sha256", sessionSecret).update(text).digest("hex");
}

export function createSessionToken(userId) {
    const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    const tokenBody = `${userId}.${expiresAt}`;
    return `${tokenBody}.${signText(tokenBody)}`;
}

// Returns the userId inside a valid, unexpired token, or null
export function readSessionToken(sessionToken) {
    const tokenParts = String(sessionToken || "").split(".");
    if (tokenParts.length !== 3) {
        return null;
    }

    const [userId, expiresAt, signature] = tokenParts;
    const expectedSignature = signText(`${userId}.${expiresAt}`);

    const isSignatureValid = signature.length === expectedSignature.length
        && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    if (!isSignatureValid) {
        return null;
    }

    if (Number(expiresAt) < Date.now()) {
        return null;
    }

    return userId;
}

function getCookie(req, cookieName) {
    const cookieHeader = req.headers.cookie || "";

    for (const cookiePart of cookieHeader.split(";")) {
        const [name, ...valueParts] = cookiePart.trim().split("=");
        if (name === cookieName) {
            return decodeURIComponent(valueParts.join("="));
        }
    }

    return "";
}

export function setSessionCookie(res, userId) {
    res.cookie(SESSION_COOKIE_NAME, createSessionToken(userId), {
        httpOnly: true,
        sameSite: "lax",
        secure: CONFIG.COOKIE_SECURE,
        maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
    });
}

export function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME);
}

// The userId of the current login cookie, or null. Used to keep a guest's audits when they create an account.
export function getSessionUserId(req) {
    return readSessionToken(getCookie(req, SESSION_COOKIE_NAME));
}

// Express middleware: lets the request through only for logged-in users.
// Sets res.locals.user = { userId, email, isGuest }
export async function requireLogin(req, res, next) {
    const userId = readSessionToken(getCookie(req, SESSION_COOKIE_NAME));

    if (!userId) {
        return res.status(401).json({ status: false, code: "LOGIN_REQUIRED", message: "Please log in" });
    }

    try {
        const user = await getUser(userId);
        if (!user) {
            return res.status(401).json({ status: false, code: "LOGIN_REQUIRED", message: "Please log in" });
        }

        res.locals.user = { userId: user.userId, email: user.email, isGuest: Boolean(user.isGuest) };
        return next();
    } catch (error) {
        console.error("Could not load logged-in user", { userId, reason: error.message });
        return res.status(500).json({ status: false, code: "USER_LOAD_FAILED", message: "Unable to check your login" });
    }
}
