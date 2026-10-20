// The in-app tutorial. Plain data so it is easy to keep current: each topic has steps, and a step may carry a link.
// Menu names inside Meta, Google and Salesforce change now and then; the steps say what to look for rather than exact clicks.
window.GUIDE = [
  { id: 'start', title: 'Start here', intro: 'Lumen reads your numbers from the places you already use and keeps them on this computer. Every source is optional, and you can add them in any order.',
    steps: [
      ['Try it with demo data', 'The Demo workspace shows exactly how Lumen looks. Make a new workspace (Settings → Workspaces) for your real accounts; one workspace per business or client keeps numbers separate.'],
      ['Add a source', 'Sources → pick a card → Connect & sync. Lumen tests the connection first and tells you in plain words what is wrong if it fails.'],
      ['Keys stay put', 'Tokens and secrets are encrypted with this computer’s keychain. Lumen never shows them again, and the window itself has no internet access. Only the app’s background process talks to Meta, Google, Salesforce and your AI.'],
      ['Overview vs Analytics', 'Overview adds up what you spend (Meta + Google Ads). Analytics shows what happened after the click: GA4, YouTube and Salesforce. They are kept apart on purpose so nothing is counted twice.']
    ] },
  { id: 'meta', title: 'Meta (Facebook + Instagram ads)', intro: 'Lumen needs your ad account ID and a long-lived access token.',
    steps: [
      ['Register as a developer', 'developers.facebook.com → Get started. This is a one-time step for your Facebook login.', 'https://developers.facebook.com/'],
      ['Create an app', 'My Apps → Create app → choose the Business / “Other” type. Leave it in Development mode; that is fine for your own accounts.'],
      ['Create a System User', 'Meta Business Settings → Users → System users → Add. A system user’s token does not expire like a personal one.', 'https://business.facebook.com/settings/system-users'],
      ['Give it your ad account', 'Select the system user → Add assets → Ad accounts → switch on your ad account (view access is enough for reporting).'],
      ['Generate the token', 'Generate new token → pick your app → tick ads_read → Never expires if offered. Copy it straight into Lumen; do not paste it into chats or documents.'],
      ['Find the ad account ID', 'In Ads Manager the URL contains act=1234567890. The number is the ID. Paste just the number.'],
      ['Later, for posting and ad changes', 'Also tick ads_management, pages_manage_posts, pages_read_engagement, instagram_basic, instagram_content_publish and business_management, and assign your Pages and Instagram account to the system user. Reporting works without them.']
    ] },
  { id: 'google', title: 'Google sign-in (Analytics, Ads, YouTube)', intro: 'One Google sign-in powers all three. You create a small private “OAuth client” once; it takes about ten minutes and never costs anything.',
    steps: [
      ['Make a Cloud project', 'console.cloud.google.com → New project (name it Lumen).', 'https://console.cloud.google.com/projectcreate'],
      ['Turn on the APIs', 'APIs & Services → Library. Enable: Google Analytics Data API, Google Ads API, YouTube Data API v3, YouTube Analytics API. If a connector later says an API “has not been used”, this is the step that was missed.', 'https://console.cloud.google.com/apis/library'],
      ['Set up the consent screen', 'APIs & Services → OAuth consent screen (may be called Google Auth Platform). Choose External, fill the app name and your email, and add yourself as a test user.'],
      ['Stop the 7-day expiry', 'While the app is in “Testing”, Google ends your sign-in every 7 days. Click Publish app (Production). You do not need verification for personal use; you will just see a “Google hasn’t verified this app” screen when you sign in. Choose Advanced → Continue.'],
      ['Create the client', 'Credentials → Create credentials → OAuth client ID → application type Desktop app. Copy the client ID and client secret.', 'https://console.cloud.google.com/apis/credentials'],
      ['Sign in from Lumen', 'Sources → Google card → paste the client ID and secret → Save → Sign in with Google. Use the Google account that can see your Analytics property, Ads account and YouTube channel. Your browser opens, you approve, and you return to Lumen.']
    ] },
  { id: 'ga4', title: 'Google Analytics 4', intro: 'Pulls sessions, engaged sessions, key events and revenue by channel and by campaign.',
    steps: [
      ['Finish the Google sign-in first', 'See “Google sign-in” above.'],
      ['Find the property ID', 'analytics.google.com → Admin → Property settings → Property ID. It is a number, not the G-XXXX measurement ID.', 'https://analytics.google.com/'],
      ['Add it', 'Sources → Google Analytics 4 → paste the number → Connect & sync.'],
      ['Matching GA4 to Meta', 'Analytics lines up GA4 campaigns with ad campaigns by name. For a clean match, make your ads’ utm_campaign value the same as the campaign name. Differences are normal (GA4 counts site actions; Meta counts its own attribution window), but big gaps are worth a look.']
    ] },
  { id: 'google-ads', title: 'Google Ads', intro: 'Daily campaign performance, including YouTube video campaigns.',
    steps: [
      ['Finish the Google sign-in first', 'See “Google sign-in” above.'],
      ['Get a developer token', 'In a Google Ads manager account: Tools → API Center → apply for a developer token. Basic access is enough. A token that only has “test account” access cannot read real accounts; it needs Basic access approved.', 'https://ads.google.com/aw/apicenter'],
      ['Find the customer ID', 'The 10-digit number at the top right of Google Ads (123-456-7890).'],
      ['Manager accounts', 'If you sign in through a manager (MCC) account, put the manager’s ID in the Manager ID box too.'],
      ['If it says the version is retired', 'Google Ads versions sunset about once a year. Type a newer one (for example v25) into the API version box.']
    ] },
  { id: 'youtube', title: 'YouTube', intro: 'Your channel’s daily views, watch time, subscribers, likes, comments and top videos. (Paid YouTube ads appear under Google Ads.)',
    steps: [
      ['Finish the Google sign-in first', 'Sign in with the Google account that owns the channel.'],
      ['Add it', 'Sources → YouTube → Connect & sync. There is nothing to type.'],
      ['Brand accounts', 'If the channel belongs to a Brand Account, pick that channel on Google’s account-chooser screen when you sign in.']
    ] },
  { id: 'salesforce', title: 'Salesforce reports', intro: 'Runs the reports you pick and shows their latest results. Dashboards are made of reports, so choose the reports behind the dashboard you care about.',
    steps: [
      ['Create an app for Lumen', 'Setup → App Manager → New External Client App (or Connected App). Turn on OAuth and the scope “Manage user data via APIs (api)”.'],
      ['Allow the client-credentials flow', 'Enable the Client Credentials Flow and choose a “Run As” user. That user needs access to the reports, so an integration user with read access is ideal. Lumen only reads reports.'],
      ['Copy the keys', 'Copy the Consumer Key and Consumer Secret into Lumen.'],
      ['Instance URL', 'Your My Domain address, like https://yourcompany.my.salesforce.com (no trailing path).'],
      ['Report IDs', 'Open a report: the URL looks like …/Report/00O5e000001AbCdEAK/view. Copy the 00O… part. Add several separated by commas.'],
      ['Sharing', 'The Run As user must be able to see each report’s folder. “The requested resource does not exist” usually means it cannot.']
    ] },
  { id: 'ai', title: 'AI without an API key', intro: 'Ask Lumen can use an API key, or the signed-in Claude or Codex app already on your computer, which uses your normal plan instead of API credits.',
    steps: [
      ['Pick a provider', 'Settings → AI → choose Anthropic API key, Claude (signed-in CLI) or ChatGPT (signed-in Codex CLI).'],
      ['Claude CLI', 'Install Claude Code, open Terminal, run claude once and sign in with your Claude account. Lumen then runs it in a locked-down, read-only mode: no file or command access.'],
      ['Codex CLI', 'Install Codex, run codex once and sign in with ChatGPT. Lumen runs it in read-only mode.'],
      ['Check it', 'Use Check install, then Send test. Plan usage limits still apply, and answers take a few seconds longer than with an API key.'],
      ['What the AI sees', 'Only a summary of the window you are looking at (totals, campaigns, GA4 and YouTube headline numbers). It cannot change anything.']
    ] },
  { id: 'fix', title: 'When something goes wrong', intro: 'Most problems are an expired token, a switched-off API, or an account that lacks access.',
    steps: [
      ['Meta says the token expired (190)', 'Generate a new system-user token, then Sources → Edit on the Meta source and paste it. Your history stays.'],
      ['Meta says deprecated version', 'Lumen pins a current API version. Update Lumen, or type the version into the API version box.'],
      ['Google says an API has not been used', 'Enable that API in your Cloud project (Google sign-in → Turn on the APIs).'],
      ['Google sign-in stopped working after a week', 'The consent screen is still in Testing. Publish it to Production, then sign in again.'],
      ['Numbers look off', 'Check the date range, the time zone of the ad account, and the attribution window in Ads Manager. Meta’s default is 7-day click and 1-day view.']
    ] }
];
