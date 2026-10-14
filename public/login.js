// Login page: log in, create an account, or continue as a guest

const loginForm = document.getElementById("login-form");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const submitButton = document.getElementById("submit-button");
const guestButton = document.getElementById("guest-button");
const loginMessage = document.getElementById("login-message");
const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");

let isRegisterMode = false;

function setMode(registerMode) {
    isRegisterMode = registerMode;
    loginTab.className = registerMode ? "" : "active";
    registerTab.className = registerMode ? "active" : "";
    submitButton.textContent = registerMode ? "Create account" : "Log in";
    formTitle.textContent = registerMode ? "Create your free account" : "Welcome back";
    formSubtitle.textContent = registerMode
        ? "Your audits and fixes are saved to your account. Guest audits come with you."
        : "Log in to see your audits.";
    loginForm.password.autocomplete = registerMode ? "new-password" : "current-password";
    showMessage(loginMessage, "");
}

loginTab.addEventListener("click", () => setMode(false));
registerTab.addEventListener("click", () => setMode(true));

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;

    const apiPath = isRegisterMode ? "/api/auth/register" : "/api/auth/login";

    try {
        await postJson(apiPath, {
            email: loginForm.email.value,
            password: loginForm.password.value
        });
        window.location.href = "/";
    } catch (error) {
        showMessage(loginMessage, error.message, "error");
    } finally {
        submitButton.disabled = false;
    }
});

guestButton.addEventListener("click", async () => {
    guestButton.disabled = true;

    try {
        await postJson("/api/auth/guest");
        window.location.href = "/";
    } catch (error) {
        showMessage(loginMessage, error.message, "error");
        guestButton.disabled = false;
    }
});

// "Create free account" links open this page with ?mode=register
if (getPageParam("mode") === "register") {
    setMode(true);
}
