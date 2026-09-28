# Setting up a dongle

An **Ember Link** dongle adds WiFi to an embroidery machine that doesn't have
it. You set the dongle up once by plugging it into your computer over USB, tell
it which WiFi network to join, then move it to your machine. Bridge pairs the
dongle with this computer for local transfers; no account or web app is required.
This flow does not change cloud configuration or account ownership.

## Before you start

Have your **2.4 GHz** WiFi network name and password handy. The dongle's radio
can only join 2.4 GHz networks — it can't see or use 5 GHz-only networks. If
your router uses one name for both bands, that's fine.

## Step by step

1. **Plug the dongle into a USB port on this computer normally**, with its FAT32
   card installed. On Link 0.3.2-dev or later, wait for startup, then press and
   release BOOT twice quickly (within one second). It briefly blinks blue and
   reboots into USB setup; Bridge then detects it automatically. Open
   **Ember Link** in the sidebar. Do not hold BOOT while plugging in;
   that enters flash recovery. Unplugging ends the USB setup session.

2. **Check the dongle.** The main page shows Wi-Fi connection status, saved
   network and IP address, plus device settings, serial and firmware version.
   Screen and status-light preferences are under **Settings**.

3. **Configure Wi-Fi.** Click **Set up Wi-Fi** (or **Configure Wi-Fi** for a
   previously configured Link). On the separate Wi-Fi page, choose a network
   under **Available networks**. A lock (🔒) marks secured networks and the bars
   show signal strength. Click **Rescan**, or enter the network name by hand.
   Only 2.4 GHz networks appear. **Cancel** or **← Ember Link** returns to settings
   without changing Wi-Fi; any entered password is cleared. Network scanning
   only runs when you open this page or click Rescan.

4. **Connect.** Enter the **WiFi password** and a **Machine name** (for example
   "Sewing room Brother"), then click **Connect**. The dongle actually tries to
   join the network before anything is saved, so this can take up to ~30
   seconds. If the password is wrong you'll see *"…rejected the password — try
   again."* — just re-enter it.

5. **Done.** When it succeeds you'll see **Wi-Fi connected**: the dongle joined
   your network (with its assigned address), was automatically paired with this
   Bridge, and was added to your **Machines** page.

Now **unplug the dongle from your computer and plug it into your embroidery
machine.** It reconnects to your WiFi on its own and is ready to sew — no
further setup needed. Click **Go to machines**, select the dongle, then open
**Send** to send designs from your computer. To set up another
dongle, unplug this one and connect the next one in USB setup mode.

## If the machine asks to pair later

If a dongle-equipped machine ever reports that pairing is required, its pairing
window has closed. **Unplug and replug the dongle** (power-cycle it) and try
again within **5 minutes**.

## Firmware update (advanced)

While a dongle is connected over USB, a **Firmware update (advanced)** section
lets you update it:

1. Point the path field at a signed Ember Link image file
   (`ember-link.bin`).
2. Click **Update firmware** and watch the progress bar.

Keep the dongle plugged in and leave Ember Bridge open until it confirms the
dongle has restarted. Wi-Fi setup and scanning are disabled throughout the
update. Bridge waits up to about a minute for the same dongle to return in the
new boot slot with its startup health check confirmed. If that cannot be
confirmed, it asks you to reconnect, enable USB setup and check the firmware
version instead of reporting a successful update. If power is interrupted, the dongle
should retain its previous bootable firmware, but the update will need to be
started again.

The dongle only accepts images signed with the official Ember Link key, so it
will reject anything else. When it finishes, the dongle verifies the update,
reboots, and reappears after a few seconds. You normally won't need this unless
directed to update.

## Link settings

The USB setup page includes **Settings** on firmware that returns `info.display`.
Choose **Screen on** and **Normal** or **Upside down (180°)**, then **Save settings**.
Settings apply immediately and persist on the dongle across unplugging and firmware
updates. Turning the LCD off leaves its status LED and transfers working. Factory
reset restores screen defaults. Older firmware shows an update hint instead.

Bridge sends `set_display` over its serialized USB session, checks the selected
dongle's serial before writing, and verifies the returned preferences. Controls
are disabled during scanning, provisioning, firmware installation, and saves.
These settings neither enable cloud service nor change Wi-Fi/account configuration.
Physical Bridge checks on 2026-09-28 passed with Link 0.3.3-dev: rotation,
screen off/on, saved preferences after unplugging, and USB firmware installation.
Local transfer with the screen off and cloud transfer with it on also passed.
The separate web setup UI has not yet been physically tested.

### Status light (0.3.4-dev)

**Settings** also offers **Status light on**, independently of the LCD.
Click **Save settings** to persist it on Link. Off suppresses all LED
colors and blinks; re-enabling restores the current status. If the firmware does
not advertise `display.ledEnabled`, Bridge keeps screen controls available and
shows an update hint for the status light. Older clients that omit `ledEnabled`
do not change its saved value. Factory reset returns the light to on.

## Guided firmware updates

Use **Ember Link → Firmware** for automatic release discovery over USB, or
**Machines → Firmware** next to a saved Link for local Wi-Fi updates. Link
0.3.5-dev adds the compatibility reporting needed for guided local discovery.
Older images use **Advanced USB recovery** for a one-time bootstrap. See
[consumer update flows](consumer-updates.md).
