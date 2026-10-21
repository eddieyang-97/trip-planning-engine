# Connect Trip Planner to ChatGPT or Claude

Updated 21 October 2026. **A quick guide for friends — no coding required.**

Trip Planner is a shared travel itinerary and research tool. You can use it directly in a browser; connecting an AI assistant is optional.

## Before you connect

1. Open **[Trip Planner](https://trip-planning-engine.onrender.com/account)**, create **your own account**, confirm your email and sign in.
2. If a friend owns the trip you want to access, ask them to send you a **signed-in invitation** and accept it using your account. An anonymous view-only link works in the browser but **does not** itself give an AI assistant access to the trip.
3. Your account shows only trips you own or have been invited to. **Never share another person's login or authorization link.**

Use these details in either assistant:

- **Connection name:** `Trip Planning`
- **Server URL:** `https://trip-planning-engine.onrender.com/mcp`
- **Sign-in method:** OAuth — use the same Trip Planner account you created above.

## Option A: Claude

Claude supports remote custom connectors on Free, Pro and Max plans (Free supports one custom connector). Team/Enterprise organizations may require an administrator to add it first.

1. Open [Claude](https://claude.ai) in your browser.
2. Go to **Customize → Connectors**. Choose **+ Add → Add custom connector** (the exact button wording can vary).
3. Name it **Trip Planning** and paste the server URL above.
4. Continue through the suggested authentication setup, choosing **Sign in now** (or **Sign in when needed**) rather than **No sign in**. Keep the recommended OAuth option unless your administrator supplies a different configuration.
5. Select **Add**, then **Connect**. Sign in with your **own Trip Planner account** and review/approve the requested permissions.
6. In a Claude chat, use the **+ → Connectors** control to enable **Trip Planning** if it is not active.

Try: **“Using Trip Planning, list the trips I can access and show me the itinerary of one of them.”**

**Compatibility note:** The Trip Planner backend implements an OAuth-protected remote MCP server. A full end-to-end Claude account connection has **not yet been recorded as verified** in this repository. If authorization or tool discovery fails, tell the trip organizer; do not enter API keys or change security settings to bypass it.

## Option B: ChatGPT

**Availability matters:** As of October 2026, full custom MCP support in ChatGPT is documented for Business and Enterprise/Edu workspaces, subject to admin permissions. Pro may have more limited read/fetch support. **If your ChatGPT account does not show custom MCP setup, use Claude or the Trip Planner website instead.** Do not upgrade without checking that your workspace supports this feature.

1. Open [ChatGPT](https://chatgpt.com) **on the web**.
2. Go to **Plugins → + → Add custom MCP server** (if available).
3. Name it **Trip Planning**, paste the server URL above and configure **OAuth** authentication.
4. Review the connection warning; select **Create as a plugin**.
5. Install/connect the resulting plugin, sign in with your **own Trip Planner account**, and approve the permissions you want.
6. Start a new chat, type **@**, choose **Trip Planning**, and ask: **“List the trips I can access.”**

Initial ChatGPT sign-in and saved-trip retrieval have been verified for the project; that is not a guarantee of every tool or user account.

## Permissions and important limits

- **Read:** Let the assistant retrieve itineraries and research you can access.
- **Write:** May let the assistant change data **where your account is permitted**. Review proposed edits before confirming. **Shared editor mutations currently work via the website; collaborator MCP write parity is not yet complete.**
- **Search:** Separately permits metered external flight searches (and requires write consent). Leave it **off** unless you explicitly need live flight research.
- **No booking or payments:** Trip Planner does not buy tickets, make reservations or transfer money.

## Common problems

- **“I can't find Add custom MCP server” in ChatGPT:** Your plan or workspace may not allow it; use Claude or the website.
- **“I can't see my friend's trip”:** Ask for a signed-in invitation and accept it in your own account, then reconnect or refresh the assistant.
- **Sign-in or permissions fail:** Return to the Trip Planner account page and confirm your email. Disconnect/reconnect the assistant, and ask the organizer if the error persists. Do not share passwords or tokens.
- **Connection is temporarily unavailable:** The free hosted service can take time to wake after being idle. Retry after opening the Trip Planner website.

## Official help

- [ChatGPT: connecting custom MCP servers](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [Claude: custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

For technical setup and project-specific OAuth test history, see [account linking](account-linking.md).
