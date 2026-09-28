# Connecting Ember

Sending from the Ember web editor is optional. Bridge's **Send** page also lets
you choose files from this computer without an Ember account or web app.

For browser-based local sending, Ember sends designs *through* Ember Bridge.
Supported Brother Wi-Fi machines connect directly, with no dongle required.
Other machines can receive local transfers through Ember Link.
Because a web page can't silently reach an app on your computer, you authorize
the connection once. There are two ways to do it.

## Option 1: Approve the pop-up (easiest)

When Ember tries to connect, Ember Bridge shows a banner across the top of its
window:

> **https://v2.emberdesign.net** wants to connect to your embroidery machines.

The window comes to the front on its own so you won't miss it. Click
**Approve** to allow it (or **Deny** to reject it). That's it — Ember is
connected.

A couple of details:

- A pairing request expires after **2 minutes**. If it lapses, just start the
  connection again from Ember.
- Only one request can be waiting at a time.

## Option 2: Copy the pairing token

You can also connect by pasting a token into Ember:

1. In Ember Bridge, open **Settings**.
2. Expand **Advanced connection settings**. Under **Manual pairing token**, click **Show**, then **Copy** (it briefly reads
   **Copied!**).
3. Paste it into Ember's machine-connection settings.

Ember authenticates every request with this token, so you only need to do this
once per browser.

## Allowed web origins

Ember's official sites work out of the box — you don't need to configure
anything for **https://emberdesign.net** or **https://v2.emberdesign.net**.
Localhost and Ember Bridge's own window are always allowed too.

If you use Ember from a different address, add it under **Settings → Advanced connection settings → Allowed web origins**:

- Enter one origin per line, for example `https://ember.example`.
- Click **Save origins** (it briefly reads **Saved ✓**).
- Entering `*` on its own allows any website to connect — the pairing token is
  still required, but only do this if you understand the trade-off.

## Is this safe?

Yes. Ember Bridge only listens on your own computer (`127.0.0.1`) — nothing on
the wider internet can reach it — and every request must carry your pairing
token. Approving a connection (or pasting the token) is exactly what grants a
browser page permission to use your machines, and you can review activity any
time on the **Logs** page.

## Open Bridge from Ember

An Ember button can open `ember-bridge://connect`. Your browser may ask whether
to open Ember Bridge. The app must already be installed. Opening it does not
authorize access: approve the separate connection request in Bridge.

Ember Link cloud account setup is separate from pairing this computer with
Bridge. Cloud service is configured and controlled exclusively in the Ember web
app; Bridge never enables, disables, claims, or configures it. Cloud delivery does
not require Bridge to be installed or running.
