import express from "express";
import { registerUser, loginUser, createGuestUser, setSessionCookie, clearSessionCookie, getSessionUserId, requireLogin } from "../auth.js";
import { changeAuditOwner } from "../auditJobs.js";
import { changeFixOwner } from "../fixJobs.js";
import CONFIG from "../config.js";

const router = express.Router();

// A guest who creates an account or logs in keeps the audits and fixes they made as a guest
async function keepGuestWork(req, newUserId) {
    const currentUserId = getSessionUserId(req);
    if (!currentUserId || !currentUserId.startsWith("guest-") || currentUserId === newUserId) {
        return;
    }

    await changeAuditOwner(currentUserId, newUserId);
    await changeFixOwner(currentUserId, newUserId);
}

// Start a guest session: audit without creating an account
router.post("/guest", async (req, res) => {
    try {
        const guestUser = await createGuestUser();
        setSessionCookie(res, guestUser.userId);
        return res.status(201).json({ status: true, user: { email: "", isGuest: true } });
    } catch (error) {
        console.error("Guest session failed", { reason: error.message });
        return res.status(500).json({ status: false, code: "GUEST_FAILED", message: "Unable to start a guest session. Please try again." });
    }
});

// Body: { "email": "...", "password": "..." }
router.post("/register", async (req, res) => {
    const email = req.body && req.body.email;
    const password = req.body && req.body.password;

    try {
        const registration = await registerUser(email, password);

        if (!registration.created) {
            return res.status(400).json({ status: false, code: registration.code, message: registration.reason });
        }

        await keepGuestWork(req, registration.user.userId);
        setSessionCookie(res, registration.user.userId);
        return res.status(201).json({ status: true, user: { email: registration.user.email } });
    } catch (error) {
        console.error("Registration failed", { reason: error.message });
        return res.status(500).json({ status: false, code: "REGISTER_FAILED", message: "Unable to create the account. Please try again." });
    }
});

router.post("/login", async (req, res) => {
    const email = req.body && req.body.email;
    const password = req.body && req.body.password;

    try {
        const login = await loginUser(email, password);

        if (!login.loggedIn) {
            return res.status(401).json({ status: false, code: login.code, message: login.reason });
        }

        await keepGuestWork(req, login.user.userId);
        setSessionCookie(res, login.user.userId);
        return res.json({ status: true, user: { email: login.user.email } });
    } catch (error) {
        console.error("Login failed", { reason: error.message });
        return res.status(500).json({ status: false, code: "LOGIN_FAILED", message: "Unable to log in. Please try again." });
    }
});

router.post("/logout", (req, res) => {
    clearSessionCookie(res);
    return res.json({ status: true });
});

// Who is logged in, and which features this server allows (the pages use this to show or hide options)
router.get("/me", requireLogin, (req, res) => {
    return res.json({
        status: true,
        user: { email: res.locals.user.email, isGuest: res.locals.user.isGuest },
        settings: {
            allowLocalFolders: CONFIG.ALLOW_LOCAL_FOLDERS,
            maxUploadMb: CONFIG.MAX_UPLOAD_MB,
            maxPages: CONFIG.MAX_PAGES
        }
    });
});

export default router;
