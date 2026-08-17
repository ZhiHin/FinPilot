/**
 * en-MY message catalog (ADR-016). All user-facing strings live here so ms-MY and
 * zh-MY become catalog additions, not refactors. Keys are dot-namespaced by surface.
 * Interpolation placeholders use {name}.
 */
export const enMY = {
  "app.name": "FinPilot",
  "app.tagline": "Understand your money. Decide with confidence.",

  "common.greeting": "Good day, {name}",
  "common.continue": "Continue",
  "common.back": "Back",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.retry": "Try again",
  "common.loading": "Loading…",
  "common.skipForNow": "Skip for now",
  "common.comingInPhase": "Arrives in {phase}",
  "common.notFinancialAdvice": "This is educational information, not financial advice.",

  "nav.overview": "Overview",
  "nav.transactions": "Transactions",
  "nav.budget": "Budget",
  "nav.goals": "Goals",
  "nav.recurring": "Recurring",
  "nav.analytics": "Analytics",
  "nav.scenarios": "Scenario Lab",
  "nav.insights": "AI Insights",
  "nav.accounts": "Accounts",
  "nav.journal": "Journal",
  "nav.imports": "Imports",
  "nav.notifications": "Notifications",
  "nav.settings": "Settings",
  "nav.more": "More",
  "nav.skipToContent": "Skip to content",
  "nav.openCommandMenu": "Open command menu",
  "nav.signOut": "Sign out",

  "auth.signIn.title": "Sign in to FinPilot",
  "auth.signIn.submit": "Sign in",
  "auth.signIn.noAccount": "New to FinPilot?",
  "auth.signIn.createAccount": "Create an account",
  "auth.signIn.forgot": "Forgot your password?",
  "auth.signUp.title": "Create your FinPilot account",
  "auth.signUp.submit": "Create account",
  "auth.signUp.haveAccount": "Already have an account?",
  "auth.email.label": "Email address",
  "auth.password.label": "Password",
  "auth.password.new.label": "New password",
  "auth.password.confirm.label": "Confirm password",
  "auth.password.requirements": "At least 12 characters. A passphrase works well.",
  "auth.error.invalidCredentials": "That email and password combination didn’t work.",
  "auth.error.rateLimited": "Too many attempts. Please wait a moment and try again.",
  "auth.error.generic": "Something went wrong. Please try again.",
  "auth.reset.title": "Reset your password",
  "auth.reset.request.submit": "Send reset link",
  "auth.reset.requested":
    "If an account exists for that email, a reset link is on its way. Check your inbox.",
  "auth.reset.set.title": "Choose a new password",
  "auth.reset.set.submit": "Set new password",
  "auth.reset.invalidToken":
    "This reset link is invalid or has expired. Request a new one to continue.",
  "auth.reset.success": "Your password has been reset. Sign in with your new password.",

  "onboarding.title": "Set up FinPilot",
  "onboarding.step1.title": "Where do you manage your money?",
  "onboarding.step1.why":
    "Locale, currency, and timezone drive every date, amount, and payday calculation you’ll see.",
  "onboarding.step4.title": "Your safety buffer and budget style",
  "onboarding.step4.why":
    "The buffer is money FinPilot always treats as off-limits when calculating what’s safe to spend.",
  "onboarding.summary.title": "You’re set",

  "settings.title": "Settings",
  "settings.profile.title": "Profile",
  "settings.preferences.title": "Preferences",
  "settings.security.title": "Security",
  "settings.notifications.title": "Notifications",
  "settings.privacy.title": "Privacy & AI",
  "settings.data.title": "Data",

  "overview.title": "Overview",
  "privacy.hideAmounts": "Hide amounts",
  "privacy.showAmounts": "Show amounts",
  "theme.toggle": "Theme",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
} as const;

export type MessageKey = keyof typeof enMY;
